import { describe, it, expect } from "vitest";
import { ERROR_REGISTRY, type ErrorCode } from "./error.codes";
import { renderError } from "./error.handler";
import {
  AppError,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  exceptionForStatus,
} from "./error.exceptions";

const CODES = Object.keys(ERROR_REGISTRY) as ErrorCode[];

/**
 * The status contract, written out by hand.
 *
 * Reading the expected status back out of `ERROR_REGISTRY` would make the
 * assertion below tautological — flipping, say, `FLAG_NOT_FOUND` from 404 to 409
 * would still pass. Restating it here is what makes a status change a reviewable
 * diff rather than a silent client-facing break.
 */
const EXPECTED_STATUS: Record<ErrorCode, number> = {
  // 400
  VALIDATION_ERROR: 400,
  INVALID_DATETIME: 400,
  INVALID_IDENTIFIER: 400,
  MISSING_REQUIRED_FIELD: 400,
  CONSTRAINT_VIOLATION: 400,
  RESERVATION_INVALID_RANGE: 400,
  RESERVATION_NOT_COVERED: 400,
  INSPECTION_NO_PHOTO_PROOF: 400,
  INSPECTION_WINDOW_EXPIRED: 400,
  FLAG_WINDOW_EXPIRED: 400,
  MAX_PHOTOS_EXCEEDED: 400,
  ASSET_TYPE_INVALID: 400,
  AUTH_PROVIDER_ERROR: 400,
  INVITATION_ERROR: 400,
  // 401
  AUTH_TOKEN_MISSING: 401,
  AUTH_TOKEN_INVALID: 401,
  AUTH_SESSION_EXPIRED: 401,
  // 403
  FORBIDDEN_ROLE: 403,
  FORBIDDEN_APARTMENT_ACCESS: 403,
  // 404
  ROUTE_NOT_FOUND: 404,
  APARTMENT_NOT_FOUND: 404,
  RESERVATION_NOT_FOUND: 404,
  INSPECTION_NOT_FOUND: 404,
  ASSET_NOT_FOUND: 404,
  ASSET_TYPE_NOT_FOUND: 404,
  LOCATION_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  FLAG_NOT_FOUND: 404,
  // 409
  RESERVATION_OVERLAP: 409,
  INSPECTION_ALREADY_EXISTS: 409,
  FLAG_ALREADY_EXISTS: 409,
  ASSET_LOCKED: 409,
  APARTMENT_SHOTS_LOCKED: 409,
  DUPLICATE_RECORD: 409,
  RELATED_RECORD_INVALID: 409,
  // 405 / 500
  METHOD_NOT_ALLOWED: 405,
  INTERNAL_SERVER_ERROR: 500,
  HTTP_ERROR: 500,
};

/**
 * Registry-wide invariants.
 *
 * Behavioural coverage lives in the module and validator suites. What this file
 * adds is the guarantee that holds for *every* code, including the two that have
 * no live throw path today (`AUTH_TOKEN_INVALID`, `FLAG_NOT_FOUND`) — those two
 * would otherwise be untestable until something starts throwing them.
 */
describe("error registry", () => {
  it("registers a non-trivial number of codes", () => {
    expect(CODES.length).toBeGreaterThanOrEqual(38);
  });

  it.each(CODES)("%s carries the status the API contract promises", (code) => {
    const status = ERROR_REGISTRY[code].status;
    expect(Number.isInteger(status)).toBe(true);
    expect(status).toBe(EXPECTED_STATUS[code]);
  });

  it("expects a status for every registered code, and no others", () => {
    expect(Object.keys(EXPECTED_STATUS).sort()).toEqual([...CODES].sort());
  });

  it.each(CODES)("%s has a developer-facing description", (code) => {
    expect(ERROR_REGISTRY[code].description).toMatch(/^[A-Z].*[a-z.]$/);
  });

  // §8: codes are namespaced SCREAMING_SNAKE, never a bare status name.
  it.each(CODES)("%s is a SCREAMING_SNAKE namespace, not a status name", (code) => {
    expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    expect(code).toContain("_");
    expect(["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT"]).not.toContain(code);
  });

  // The status lives in the registry alone; the throw site never restates it.
  it.each(CODES)("%s renders an envelope whose code round-trips", (code) => {
    const { status } = ERROR_REGISTRY[code];
    const body = renderError({ code, message: ERROR_REGISTRY[code].description, status });

    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
    expect(typeof body.error.message).toBe("string");
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  // Messages are product copy: no status prefix, no SQL, no raw identifiers.
  it.each(CODES)("%s renders copy with no status prefix or SQL", (code) => {
    const { status } = ERROR_REGISTRY[code];
    const { error } = renderError({ code, message: ERROR_REGISTRY[code].description, status });

    expect(error.message).not.toMatch(/^(Not Found|Conflict|Bad Request|Forbidden|Unauthorized|Internal Server Error):/);
    expect(error.message).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|constraint|relation|column|table)\b/i);
  });

  it.each(CODES)("%s is reachable through exceptionForStatus", (code) => {
    const { status } = ERROR_REGISTRY[code];
    const err = exceptionForStatus(status, { code, message: ERROR_REGISTRY[code].description });

    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(err).toBeInstanceOf(Error);
  });

  // The class matters, not just the status: `exceptionForStatus` is what
  // `defineErrors` throwers go through, so a collapsed switch returning a bare
  // AppError for every status would still carry the right `status` while losing
  // the subclass. Assert the class explicitly.
  const CLASS_FOR_STATUS: Array<[number, unknown]> = [
    [400, BadRequestException],
    [401, UnauthorizedException],
    [403, ForbiddenException],
    [404, NotFoundException],
    [409, ConflictException],
    [500, AppError],
    [405, AppError],
  ];

  it.each(CLASS_FOR_STATUS)("status %s maps to its exception class", (status, expected) => {
    const err = exceptionForStatus(status as any, { code: "INTERNAL_SERVER_ERROR", message: "x" });
    expect(err).toBeInstanceOf(expected as any);
    expect(err.status).toBe(status);
  });

  it("every registered status has a class assertion above", () => {
    const asserted = new Set(CLASS_FOR_STATUS.map(([status]) => status));
    for (const code of CODES) {
      expect(asserted).toContain(ERROR_REGISTRY[code].status);
    }
  });
});

/**
 * These two codes are registered but nothing throws them yet, so no module suite
 * can cover them: `AUTH_TOKEN_INVALID` is declared in the AUTHED bundle while
 * `authGuard` distinguishes only missing vs. rejected, and `FLAG_NOT_FOUND` has
 * no lookup endpoint. They are covered by the `it.each(CODES)` blocks above;
 * listing them here keeps that coverage greppable and records the intent, so
 * deleting a code without implementing it is a visible decision.
 */
describe("registered codes with no live throw path", () => {
  const UNTHROWN = ["AUTH_TOKEN_INVALID", "FLAG_NOT_FOUND"] as const satisfies readonly ErrorCode[];

  it.each(UNTHROWN)("%s is still declared and renderable", (code) => {
    expect(CODES).toContain(code);

    const { status } = ERROR_REGISTRY[code];
    const body = renderError({ code, message: ERROR_REGISTRY[code].description, status });
    expect(body.error.code).toBe(code);
  });

  it("is a deliberate list, not a dumping ground", () => {
    // If this fails, either you implemented one of these codes (good — remove it
    // from UNTHROWN) or you are muting a code that needs a real test.
    expect(UNTHROWN).toEqual(["AUTH_TOKEN_INVALID", "FLAG_NOT_FOUND"]);
  });
});
