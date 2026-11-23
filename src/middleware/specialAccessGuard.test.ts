import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { validationHook, renderError, toErrorResponse } from "@/core/errors/error.handler";
import { specialAccessGuard, type AccessBind } from "./specialAccessGuard";
import { App } from "@/types";

const { mockResolveByToken, mockResolveApartmentOwner, mockGetByAuthId } = vi.hoisted(
  () => ({
    mockResolveByToken: vi.fn(),
    mockResolveApartmentOwner: vi.fn(),
    mockGetByAuthId: vi.fn(),
  }),
);

vi.mock("../modules/special_access/special_access.service", () => ({
  specialAccessService: {
    resolveByToken: mockResolveByToken,
    resolveApartmentOwner: mockResolveApartmentOwner,
  },
}));

vi.mock("../modules/users/users.service", () => ({
  usersService: { getByAuthId: mockGetByAuthId },
}));

const APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440000";
const OTHER_RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440001";
const OWNER = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  authId: "550e8400-e29b-41d4-a716-446655440000",
  role: "host",
  status: "confirmed",
};

/**
 * A real app rather than a stub: the guard's whole job is ordering (does the
 * token path bypass the session path, does a bad token avoid reading the target),
 * and that ordering is only observable when Hono's actual dispatch runs.
 */
const buildApp = (opts: {
  scope: "inspection_proof" | "damage_evidence";
  bind: AccessBind;
  roles?: ("admin" | "host" | "guest")[];
}) => {
  const app = new OpenAPIHono<App>({ defaultHook: validationHook });
  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err);
    return c.json(body, status);
  });
  app.notFound((c) =>
    c.json(renderError({ code: "ROUTE_NOT_FOUND", message: "no route", status: 404 }), 404),
  );
  app.use("*", async (c, next) => {
    c.set("db", {} as never);
    // `authGuard` reads the session through `supabase.auth.getUser`, so the stub
    // has to answer that call — a bare `{}` here would 500 the session path and
    // hide the behaviour these tests exist to pin.
    c.set("supabase", {
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: OWNER.id } }, error: null }),
      },
    } as never);
    await next();
  });

  const route = createRoute({
    method: "post",
    path: "/things/{id}",
    middleware: [specialAccessGuard(opts)] as const,
    request: {
      params: z.object({ id: z.string() }),
      ...(opts.bind.kind === "reservationBody"
        ? {
            body: {
              content: {
                "application/json": { schema: z.object({ reservationId: z.string() }) },
              },
            },
          }
        : {}),
    },
    responses: {
      200: {
        description: "ok",
        content: { "application/json": { schema: z.object({ who: z.string() }) } },
      },
    },
  });

  app.openapi(route, (c) => c.json({ who: c.get("user")?.id ?? "none" }, 200));

  return app;
};

const call = (app: any, query = "", body?: unknown) =>
  app.request(`/things/${RESERVATION_ID}${query}`, {
    method: "POST",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(query.includes("jwt") ? { Authorization: "Bearer tok" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetByAuthId.mockResolvedValue({ ...OWNER, role: "admin", status: "confirmed" });
});

describe("specialAccessGuard — the session path is unchanged", () => {
  it("passes through authGuard+rolesGuard when no accessId is supplied", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });

    const res = await app.request(`/things/${RESERVATION_ID}`, {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });

    expect(res.status).toBe(200);
    expect(mockResolveByToken).not.toHaveBeenCalled();
  });

  it("still answers 401 when there is no token and no session", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });

    const res = await app.request(`/things/${RESERVATION_ID}`, { method: "POST" });

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_TOKEN_MISSING");
  });

  it("still answers 403 FORBIDDEN_ROLE for a role the route does not accept", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["host"],
    });
    mockGetByAuthId.mockResolvedValue({ ...OWNER, role: "guest", status: "confirmed" });

    const res = await app.request(`/things/${RESERVATION_ID}`, {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
  });
});

describe("specialAccessGuard — the token path", () => {
  const grant = {
    scope: "inspection_proof",
    apartmentId: APARTMENT_ID,
    reservationId: RESERVATION_ID,
  };

  it("admits a valid token on a matching target and impersonates the owner", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });
    mockResolveByToken.mockResolvedValue(grant);
    mockResolveApartmentOwner.mockResolvedValue(OWNER);

    const res = await call(app, "?accessId=good");

    expect(res.status).toBe(200);
    expect((await res.json()).who).toBe(OWNER.id);
  });

  it("403s an unknown or expired token", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });
    mockResolveByToken.mockResolvedValue(null);

    const res = await call(app, "?accessId=dead");

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SPECIAL_ACCESS_INVALID");
  });

  it("validates the token BEFORE reading the target", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });
    mockResolveByToken.mockResolvedValue(null);

    await call(app, "?accessId=dead");

    // The owner lookup is the only other read the guard can make; a bad token
    // must not reach it.
    expect(mockResolveApartmentOwner).not.toHaveBeenCalled();
  });

  it("does NOT fall back to the session when the token is bad", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });
    mockResolveByToken.mockResolvedValue(null);

    const res = await app.request(`/things/${RESERVATION_ID}?accessId=dead`, {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SPECIAL_ACCESS_INVALID");
    expect(mockGetByAuthId).not.toHaveBeenCalled();
  });

  it("403s a token whose scope is not this route's", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });
    mockResolveByToken.mockResolvedValue({ ...grant, scope: "damage_evidence" });

    const res = await call(app, "?accessId=good");

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SPECIAL_ACCESS_SCOPE_MISMATCH");
  });

  it("403s a valid token aimed at ANOTHER reservation in the same apartment", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });
    mockResolveByToken.mockResolvedValue({ ...grant, reservationId: OTHER_RESERVATION_ID });

    const res = await call(app, "?accessId=good");

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SPECIAL_ACCESS_SCOPE_MISMATCH");
  });

  it("binds an apartment-scoped route by the grant's apartment", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "apartmentParam", param: "id" },
      roles: ["admin", "host"],
    });
    mockResolveByToken.mockResolvedValue({
      scope: "inspection_proof",
      apartmentId: RESERVATION_ID, // the path param in this harness
      reservationId: RESERVATION_ID,
    });
    mockResolveApartmentOwner.mockResolvedValue(OWNER);

    const res = await call(app, "?accessId=good");

    expect(res.status).toBe(200);
  });

  it("binds a body-carried reservation and admits a match", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationBody", field: "reservationId" },
      roles: ["host"],
    });
    mockResolveByToken.mockResolvedValue(grant);
    mockResolveApartmentOwner.mockResolvedValue(OWNER);

    const res = await call(app, "?accessId=good", { reservationId: RESERVATION_ID });

    expect(res.status).toBe(200);
  });

  it("binds a body-carried reservation and 403s a different one", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationBody", field: "reservationId" },
      roles: ["host"],
    });
    mockResolveByToken.mockResolvedValue(grant);

    const res = await call(app, "?accessId=good", { reservationId: OTHER_RESERVATION_ID });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SPECIAL_ACCESS_SCOPE_MISMATCH");
  });

  it("lets a malformed body reach the validator rather than 403ing it", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationBody", field: "reservationId" },
      roles: ["host"],
    });
    mockResolveByToken.mockResolvedValue(grant);
    mockResolveApartmentOwner.mockResolvedValue(OWNER);

    const res = await app.request(`/things/${RESERVATION_ID}?accessId=good`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });

    // A 400 about the input, not a 403 about the link: the caller is sent to the
    // thing that is actually wrong.
    expect(res.status).toBe(400);
  });

  it("treats a grant whose apartment has no resolvable owner as a dead link", async () => {
    const app = buildApp({
      scope: "inspection_proof",
      bind: { kind: "reservationParam", param: "id" },
      roles: ["admin", "host"],
    });
    mockResolveByToken.mockResolvedValue(grant);
    mockResolveApartmentOwner.mockResolvedValue(null);

    const res = await call(app, "?accessId=good");

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SPECIAL_ACCESS_INVALID");
  });
});
