import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { toErrorResponse } from "@/core/errors/error.handler";
import { expectError } from "@/core/utils/assert-error";
import { App } from "@/types";
import app from "../index";

/**
 * These three middlewares only run outside `NODE_ENV=test` (see `index.ts`), so
 * nothing else in the suite ever exercises them. A missing binding is an
 * operator error, not a client error — the client must see a generic 500 with a
 * code, and the name of the missing variable must stay in `meta`.
 */
vi.mock("@/db/client", () => ({ createDb: vi.fn(() => ({ mocked: true })) }));
vi.mock("@/lib/supabase", () => ({ createSupabaseAdmin: vi.fn(() => ({ mocked: true })) }));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return { ...actual, S3Client: vi.fn(() => ({ mocked: true })) };
});

import { dbMiddleware } from "./db";
import { supabaseMiddleware } from "./supabase";
import { s3Middleware } from "./s3";

/** Wires a middleware the way `index.ts` does, so `onError` builds the envelope. */
const appWith = (middleware: any) => {
  const app = new OpenAPIHono<App>();
  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err);
    return c.json(body, status);
  });
  app.use("*", middleware);
  app.get("/probe", (c) => c.json({ ok: true }));
  return app;
};

describe("bootstrap middleware configuration errors", () => {
  // `vitest.setup.ts` provides DATABASE_URL for the rest of the suite, and these
  // middlewares read `env(c)`, which falls through to process.env on Node.
  const saved: Record<string, string | undefined> = {};
  const clearAll = () => {
    for (const key of [
      "DATABASE_URL",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "R2_ENDPOINT_URL",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ]) {
      saved[key] ??= process.env[key];
      delete process.env[key];
    }
  };

  beforeEach(clearAll);
  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const cases: Array<[string, any, string]> = [
    ["dbMiddleware", dbMiddleware, "DATABASE_URL"],
    ["supabaseMiddleware", supabaseMiddleware, "SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY"],
    ["s3Middleware", s3Middleware, "R2_ENDPOINT_URL|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY"],
  ];

  it.each(cases)("%s returns 500 HTTP_ERROR when its bindings are absent", async (name, middleware, missing) => {
    const res = await appWith(middleware).request("/probe");

    const body = await expectError(res, 500, "HTTP_ERROR",
      /not correctly configured and cannot serve requests/);
    expect(body.error.meta.missing).toBe(missing);
    expect(body.error.meta.origin).toBe("BOOTSTRAP");
  });

  it("keeps the missing-variable name out of the client-facing message", async () => {
    const res = await appWith(dbMiddleware).request("/probe");
    const body = await expectError(res, 500, "HTTP_ERROR");
    expect(body.error.message).not.toMatch(/DATABASE_URL/);
    // The operator still gets the detail, just not on the wire.
    expect(body.error.meta.missing).toBe("DATABASE_URL");
  });
});

describe("framework-level handling", () => {
  it("renders ROUTE_NOT_FOUND for an unknown route on the real app", async () => {
    // Imported, not rebuilt: a copy of index.ts's notFound handler would keep
    // passing after production's changed.
    await expectError(await app.request("/definitely-not-a-route"), 404, "ROUTE_NOT_FOUND",
      /Route GET \/definitely-not-a-route does not exist\./);
  });

  // The remaining two cases assert `toErrorResponse` directly. That function is
  // the actual unit — routing an HTTPException through a throwaway app would
  // only re-test Hono's router, not this branch.
  it("maps a bare 405 HTTPException to METHOD_NOT_ALLOWED", async () => {
    const { status, body } = toErrorResponse(
      new HTTPException(405, { message: "Method Not Allowed" }),
    );

    expect(status).toBe(405);
    expect(body.error.code).toBe("METHOD_NOT_ALLOWED");
    expect(body.error.meta?.origin).toBe("FRAMEWORK");
  });

  it("maps any other bare HTTPException to HTTP_ERROR", async () => {
    const { status, body } = toErrorResponse(
      new HTTPException(418, { message: "I am a teapot" }),
    );

    expect(status).toBe(418);
    expect(body.error.code).toBe("HTTP_ERROR");
    expect(body.error.meta?.origin).toBe("FRAMEWORK");
  });

  it("honours an HTTPException that carries its own Response", async () => {
    const res = new Response("custom", { status: 402 });
    const { status, body } = toErrorResponse(
      new HTTPException(402, { res, message: "Payment required" }),
    );

    expect(status).toBe(402);
    expect(body.error.code).toBe("HTTP_ERROR");
  });
});
