import { describe, it, expect, afterEach } from "vitest";
import { z } from "@hono/zod-openapi";
import { formatValidationError, renderError, toErrorResponse } from "./error.handler";
import { ConflictException, NotFoundException } from "./error.exceptions";

/** Mimics Drizzle's wrapping: DrizzleQueryError.cause === PostgresError. */
class FakeDrizzleQueryError extends Error {
  constructor(public query: string, public params: any[], public cause?: Error) {
    super(`Failed query: ${query}`);
  }
}
class FakePostgresError extends Error {
  code = "23505";
  constraint_name = "asset_types_code_unique";
  constructor() {
    super('duplicate key value violates unique constraint "asset_types_code_unique"');
  }
}

describe("renderError", () => {
  it("omits details when the array is empty", () => {
    const b = renderError({ code: "ASSET_NOT_FOUND", message: "Asset does not exist.", status: 404, details: [] });
    expect("details" in b.error).toBe(false);
  });

  it("omits meta in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const b = renderError({ code: "ASSET_NOT_FOUND", message: "Asset does not exist.", status: 404, meta: { origin: "DOMAIN" } });
    expect("meta" in b.error).toBe(false);
    process.env.NODE_ENV = prev;
  });

  it("always sets success to false", () => {
    expect(renderError({ code: "INTERNAL_SERVER_ERROR", message: "x", status: 500 }).success).toBe(false);
  });
});

describe("formatValidationError", () => {
  const parse = (schema: z.ZodType<unknown>, value: unknown, target: string) => {
    const r = schema.safeParse(value);
    if (r.success) throw new Error("expected a validation failure");
    return formatValidationError({ success: false, error: r.error, target: target as any });
  };

  it("qualifies fields with the request path and uses human sentences", () => {
    const schema = z.object({ password: z.string().min(8), guestCount: z.number().min(1) });
    const { status, body } = parse(schema, { password: "x", guestCount: 0 }, "json");

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("The request failed validation (2 problems).");
    expect(body.error.details?.map((d) => d.field).sort()).toEqual(["body.guestCount", "body.password"]);
    expect(body.error.details?.find((d) => d.field === "body.password")?.message)
      .toBe("Request body: password must be at least 8 characters long.");
  });

  it("never forwards raw Zod text", () => {
    const schema = z.object({ mode: z.enum(["a", "b"]) });
    const { body } = parse(schema, { mode: "z" }, "json");
    const msg = body.error.details![0]!.message;
    expect(msg).toMatch(/must be one of: a, b\./);
    expect(msg).not.toMatch(/Invalid|expected/i);
  });

  it("prefixes by target", () => {
    const schema = z.object({ limit: z.coerce.number().max(100) });
    const { body } = parse(schema, { limit: 500 }, "query");
    expect(body.error.details![0]!.field).toBe("query.limit");
  });

  it("keeps an author-written custom message", () => {
    const schema = z.string().refine(() => false, { message: "Check-out must be after check-in." });
    const { body } = parse(schema, "anything", "json");
    expect(body.error.details![0]!.message).toBe("Check-out must be after check-in.");
  });
});

describe("toErrorResponse", () => {
  it("renders an AppError verbatim, with no status prefix", () => {
    const err = new ConflictException({
      code: "RESERVATION_OVERLAP",
      message: "This apartment already has a reservation overlapping 12-15 Oct.",
    });
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(409);
    expect(body.error.message).toBe("This apartment already has a reservation overlapping 12-15 Oct.");
    expect(body.error.message).not.toMatch(/^Conflict:/);
  });

  it("carries details through", () => {
    const err = new NotFoundException({
      code: "ASSET_NOT_FOUND",
      message: "Asset does not exist.",
      details: [{ field: "param.id", message: "Asset does not exist." }],
    });
    expect(toErrorResponse(err).body.error.details).toHaveLength(1);
  });

  it("unwraps DrizzleQueryError -> PostgresError and hides driver text", () => {
    const wrapped = new FakeDrizzleQueryError("insert ...", [], new FakePostgresError());
    const { status, body } = toErrorResponse(wrapped);
    expect(status).toBe(409);
    expect(body.error.code).toBe("DUPLICATE_RECORD");
    expect(body.error.message).toBe("A record with these values already exists.");
    expect(body.error.message).not.toMatch(/duplicate key|asset_types_code_unique/);
    expect((body.error as any).meta?.constraint).toBe("asset_types_code_unique");
  });

  it("maps unknown SQLSTATEs to 500", () => {
    const e: any = new Error("weird");
    e.code = "XX000";
    const { status, body } = toErrorResponse(e);
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("never leaks an unexpected error's message", () => {
    const { status, body } = toErrorResponse(new Error("kaboom: relation \"users\" does not exist"));
    expect(status).toBe(500);
    expect(body.error.message).not.toMatch(/kaboom|users/);
  });

  it("handles a thrown non-Error", () => {
    const { status, body } = toErrorResponse("just a string");
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});