import { describe, it, expect, afterEach } from "vitest";
import { mapPersistenceError } from "./error.mapper";
import { toErrorResponse } from "./error.handler";

/** DrizzleQueryError(query, params, cause) — cause is the driver error. */
class FakeDrizzleQueryError extends Error {
  constructor(public query: string, public params: any[], public cause?: Error) {
    super(`Failed query: ${query}\nparams: ${params}`);
  }
}
/** postgres-js PostgresError carries `code` (SQLSTATE) and `constraint_name`. */
class FakePostgresError extends Error {
  constructor(public code: string, public constraint_name?: string, message = "driver message") {
    super(message);
  }
}

const wrapped = (code: string, constraint_name?: string) =>
  new FakeDrizzleQueryError("insert ...", [], new FakePostgresError(code, constraint_name));

describe("mapPersistenceError", () => {
  const prev = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it("maps 23505 + users_email_unique through the constraint override", () => {
    const r = mapPersistenceError(wrapped("23505", "users_email_unique"))!;
    expect(r.status).toBe(409);
    expect(r.code).toBe("DUPLICATE_RECORD");
    expect(r.message).toBe("A user with this email address already exists.");
  });

  it("maps 23503 + assets_asset_type_id_asset_types_id_fk to an actionable 400", () => {
    const r = mapPersistenceError(wrapped("23503", "assets_asset_type_id_asset_types_id_fk"))!;
    expect(r.status).toBe(400);
    expect(r.code).toBe("ASSET_TYPE_INVALID");
    expect(r.message).toContain("GET /assets/types");
  });

  it("falls through to the SQLSTATE default for an unmapped foreign key", () => {
    const r = mapPersistenceError(wrapped("23503", "some_unmapped_fk"))!;
    expect(r.status).toBe(409);
    expect(r.code).toBe("RELATED_RECORD_INVALID");
    expect(r.message).toBe("A referenced record does not exist or is still in use.");
  });

  it("maps 23502 to a 400 MISSING_REQUIRED_FIELD", () => {
    const r = mapPersistenceError(wrapped("23502"))!;
    expect(r.status).toBe(400);
    expect(r.code).toBe("MISSING_REQUIRED_FIELD");
  });

  it("maps 22P02 to a 400 INVALID_IDENTIFIER", () => {
    const r = mapPersistenceError(wrapped("22P02"))!;
    expect(r.status).toBe(400);
    expect(r.code).toBe("INVALID_IDENTIFIER");
  });

  it("maps 23514 to a 400 CONSTRAINT_VIOLATION", () => {
    const r = mapPersistenceError(wrapped("23514", "reservations_dates_check"))!;
    expect(r.status).toBe(400);
    expect(r.code).toBe("CONSTRAINT_VIOLATION");
    expect(r.message).toBe("The submitted values violate a data rule.");
  });

  it.each(["22007", "22008"])("maps %s to a 400 INVALID_DATETIME", (sqlstate) => {
    const r = mapPersistenceError(wrapped(sqlstate))!;
    expect(r.status).toBe(400);
    expect(r.code).toBe("INVALID_DATETIME");
  });

  it("maps an unwrapped PostgresError — the walker must not require the wrapper", () => {
    const r = mapPersistenceError(new FakePostgresError("23505", "users_email_unique"))!;
    expect(r.status).toBe(409);
    expect(r.code).toBe("DUPLICATE_RECORD");
  });

  it("finds a SQLSTATE three levels deep under cause", () => {
    const deep = new Error("outer", {
      cause: new Error("middle", { cause: new FakePostgresError("23502") }),
    });
    const r = mapPersistenceError(deep)!;
    expect(r.status).toBe(400);
    expect(r.code).toBe("MISSING_REQUIRED_FIELD");
  });

  it.each([null, "str", {}, 42])("returns null for a non-Error throw (%s)", (thrown) => {
    expect(mapPersistenceError(thrown)).toBeNull();
  });

  it("keeps the raw driver text only under meta.driver", () => {
    const r = mapPersistenceError(wrapped("23505", "users_email_unique"))!;
    expect(r.meta.driver).toBe("driver message");
    expect(r.message).not.toMatch(/driver message|duplicate key|users_email_unique/);
  });
});

describe("persistence branch through toErrorResponse", () => {
  const prev = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it("renders the override message and carries the driver text in meta", () => {
    const { status, body } = toErrorResponse(wrapped("23505", "users_email_unique"));
    expect(status).toBe(409);
    expect(body.error.code).toBe("DUPLICATE_RECORD");
    expect(body.error.message).toBe("A user with this email address already exists.");
    expect((body.error as any).meta?.driver).toBe("driver message");
    expect((body.error as any).meta?.origin).toBe("PERSISTENCE");
    // The driver text must survive nowhere but meta.driver.
    expect(JSON.stringify({ ...body.error, meta: undefined })).not.toContain("driver message");
  });

  it.each([null, "str", {}])("does not crash on a non-Error throw (%s)", (thrown) => {
    const { status, body } = toErrorResponse(thrown);
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("omits meta entirely in production", () => {
    process.env.NODE_ENV = "production";
    const { body } = toErrorResponse(wrapped("23505", "users_email_unique"));
    expect("meta" in body.error).toBe(false);
    expect(body.error.message).toBe("A user with this email address already exists.");
  });
});
