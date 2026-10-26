import { describe, it, expect } from "vitest";
import {
  checkExistence,
  assertApartmentOwnership,
  assertNoOverlappingReservation,
  assertCanCreateInspection,
  assertCanCreateFlag,
  assertCanModifyAsset,
  assertCanModifyApartmentShots,
} from "./db-validator";
import { toErrorResponse } from "@/core/errors/error.handler";
import { expectError } from "./assert-error";
import {
  apartments,
  assetTypes,
  assets,
  inspections,
  locations,
  reservations,
  users,
} from "@/db";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_UUID = "11111111-1111-1111-1111-111111111111";

/**
 * Minimal stand-in for the Drizzle query builder. Every assertion in this module
 * ends at `.limit(1)`, so one chainable thenable covers all of them.
 *
 * WHAT THIS DOES NOT VERIFY: `from`/`where`/`join` swallow their arguments, so
 * the query itself is untested — a wrong table, a dropped status filter, or a
 * broken time predicate all still return the rows handed in here. These tests
 * pin the *branch logic and error contract*; the SQL predicates are covered by
 * `checkExistenceQueries` below (table selection) and otherwise remain a unit
 * boundary. Do not read a green run as proof the query is correct.
 */
const mockDb = (rows: unknown[]) => {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  };
  return { select: () => chain } as any;
};

/**
 * Records what `checkExistence` actually asked the database for, so a
 * copy-paste slip in `resourceRegistry` (pointing `users` at the `assets`
 * table, say) fails here instead of shipping.
 */
const recordingDb = (rows: unknown[]) => {
  const calls: { from?: unknown; where?: unknown } = {};
  const chain: any = {
    from: (table: unknown) => {
      calls.from = table;
      return chain;
    },
    where: (clause: unknown) => {
      calls.where = clause;
      return chain;
    },
    limit: () => Promise.resolve(rows),
  };
  return { db: { select: () => chain } as any, calls };
};

/**
 * Runs an assertion, converts whatever it throws through the real renderer, and
 * hands back a `Response` so `expectError` can assert the full wire envelope.
 */
const asResponse = async (fn: () => Promise<unknown>): Promise<Response> => {
  let thrown: unknown;
  let didThrow = false;
  try {
    await fn();
  } catch (e) {
    thrown = e;
    didThrow = true;
  }
  if (!didThrow) throw new Error("expected the assertion to throw, but it did not");

  const { status, body } = toErrorResponse(thrown);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

/** A record that satisfies every precondition of `assertCanCreateInspection`. */
const coveredReservation = (overrides: Record<string, unknown> = {}) => ({
  reservationId: VALID_UUID,
  hasPhotoProof: true,
  status: "COVERED",
  checkInDatetime: new Date().toISOString(),
  alternativeCheckInDatetime: null,
  existingInspectionId: null,
  ...overrides,
});

describe("checkExistence", () => {
  it("returns quietly when the row exists", async () => {
    await expect(checkExistence(mockDb([{ id: VALID_UUID }]), "assets", VALID_UUID)).resolves
      .toBeUndefined();
  });

  // Every entry in the resource registry maps to its own code and label, so a
  // copy-paste slip in that table would otherwise go unnoticed.
  const cases: Array<[Parameters<typeof checkExistence>[1], string, string]> = [
    ["users", "USER_NOT_FOUND", "User does not exist."],
    ["locations", "LOCATION_NOT_FOUND", "Location does not exist."],
    ["apartments", "APARTMENT_NOT_FOUND", "Apartment does not exist."],
    ["reservations", "RESERVATION_NOT_FOUND", "Reservation does not exist."],
    ["inspections", "INSPECTION_NOT_FOUND", "Inspection does not exist."],
    ["assets", "ASSET_NOT_FOUND", "Asset does not exist."],
    ["assetTypes", "ASSET_TYPE_NOT_FOUND", "Asset type does not exist."],
  ];

  it.each(cases)("maps resource '%s' to %s", async (resource, code, message) => {
    await expectError(await asResponse(() => checkExistence(mockDb([]), resource, VALID_UUID)),
      404, code, new RegExp(message.replace(".", "\\.")));
  });

  it("keeps the raw id in meta rather than the message", async () => {
    const res = await asResponse(() => checkExistence(mockDb([]), "assets", VALID_UUID));
    const body: any = await res.json();
    expect(body.error.meta.id).toBe(VALID_UUID);
    expect(body.error.message).not.toContain(VALID_UUID);
  });
});

describe("checkExistenceQueries", () => {
  // Identity comparison against the real schema objects: if `resourceRegistry`
  // ever points `users` at the `assets` table, this fails.
  const expected: Array<[Parameters<typeof checkExistence>[1], unknown]> = [
    ["users", users],
    ["locations", locations],
    ["apartments", apartments],
    ["reservations", reservations],
    ["inspections", inspections],
    ["assets", assets],
    ["assetTypes", assetTypes],
  ];

  it.each(expected)("%s queries its own table with a filter", async (resource, table) => {
    const { db, calls } = recordingDb([{ id: VALID_UUID }]);
    await checkExistence(db, resource, VALID_UUID);

    expect(calls.from).toBe(table);
    // A `.where()` was applied — i.e. the lookup is filtered by id, not a
    // bare SELECT that happens to return the first row.
    expect(calls.where).toBeDefined();
  });
});

describe("assertApartmentOwnership", () => {
  it("allows an admin through without querying", async () => {
    const db = { select: () => { throw new Error("should not query"); } } as any;
    await expect(
      assertApartmentOwnership(db, VALID_UUID, { userId: OTHER_UUID, role: "admin" }),
    ).resolves.toBeUndefined();
  });

  it("returns 403 FORBIDDEN_APARTMENT_ACCESS for a non-owner", async () => {
    await expectError(
      await asResponse(() =>
        assertApartmentOwnership(mockDb([{ owner: OTHER_UUID }]), VALID_UUID, {
          userId: VALID_UUID,
          role: "host",
        }),
      ),
      403, "FORBIDDEN_APARTMENT_ACCESS", /do not have access to this apartment/,
    );
  });

  it("returns 404 APARTMENT_NOT_FOUND when the apartment is missing", async () => {
    await expectError(
      await asResponse(() =>
        assertApartmentOwnership(mockDb([]), VALID_UUID, { userId: VALID_UUID, role: "host" }),
      ),
      404, "APARTMENT_NOT_FOUND",
    );
  });
});

describe("assertNoOverlappingReservation", () => {
  const range = (checkIn: string, checkOut: string) => ({
    apartmentId: VALID_UUID,
    checkInDatetime: checkIn,
    checkOutDatetime: checkOut,
  });

  it("returns 400 RESERVATION_INVALID_RANGE when check-out is not after check-in", async () => {
    const res = await asResponse(() =>
      assertNoOverlappingReservation(
        // Never reached: the range check precedes the query.
        { select: () => { throw new Error("should not query"); } } as any,
        range("2026-05-10T10:00:00.000Z", "2026-05-10T10:00:00.000Z"),
      ),
    );

    const body = await expectError(res, 400, "RESERVATION_INVALID_RANGE",
      /Check-out must be strictly after check-in/);

    expect(body.error.details[0].field).toBe("body.checkOutDatetime");
  });

  it("returns 409 RESERVATION_OVERLAP and names the conflicting reservation in meta", async () => {
    const res = await asResponse(() =>
      assertNoOverlappingReservation(
        mockDb([{ id: OTHER_UUID }]),
        range("2026-05-10T10:00:00.000Z", "2026-05-12T10:00:00.000Z"),
      ),
    );

    const body = await expectError(res, 409, "RESERVATION_OVERLAP",
      /overlapping the requested dates/);

    expect(body.error.meta.conflictingReservationId).toBe(OTHER_UUID);
    expect(body.error.message).not.toContain(OTHER_UUID);
  });

  it("passes when no reservation overlaps", async () => {
    await expect(
      assertNoOverlappingReservation(
        mockDb([]),
        range("2026-05-10T10:00:00.000Z", "2026-05-12T10:00:00.000Z"),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("assertCanCreateInspection", () => {
  it("passes for a covered reservation with photo proof inside the window", async () => {
    await expect(
      assertCanCreateInspection(mockDb([coveredReservation()]), VALID_UUID),
    ).resolves.toBeUndefined();
  });

  // Order is existence → uniqueness → state → photo proof → window. Each case
  // below satisfies every earlier precondition so exactly one rule can fire.
  it("returns 404 RESERVATION_NOT_FOUND for an unknown reservation", async () => {
    await expectError(
      await asResponse(() => assertCanCreateInspection(mockDb([]), VALID_UUID)),
      404, "RESERVATION_NOT_FOUND", /Reservation does not exist/,
    );
  });

  it("returns 409 INSPECTION_ALREADY_EXISTS when one is already attached", async () => {
    const res = await asResponse(() =>
      assertCanCreateInspection(
        mockDb([coveredReservation({ existingInspectionId: OTHER_UUID })]), VALID_UUID),
    );
    const body = await expectError(res, 409, "INSPECTION_ALREADY_EXISTS",
      /An inspection already exists for this reservation/);
    expect(body.error.meta.inspectionId).toBe(OTHER_UUID);
  });

  it("returns 400 RESERVATION_NOT_COVERED and echoes the status", async () => {
    await expectError(
      await asResponse(() =>
        assertCanCreateInspection(mockDb([coveredReservation({ status: "PENDING_PROOF" })]), VALID_UUID),
      ),
      400, "RESERVATION_NOT_COVERED", /currently 'PENDING_PROOF'/,
    );
  });

  it("returns 400 INSPECTION_NO_PHOTO_PROOF when proof is unsatisfied", async () => {
    await expectError(
      await asResponse(() =>
        assertCanCreateInspection(mockDb([coveredReservation({ hasPhotoProof: false })]), VALID_UUID),
      ),
      400, "INSPECTION_NO_PHOTO_PROOF", /photo proof is satisfied/,
    );
  });

  it("returns 400 INSPECTION_WINDOW_EXPIRED once the hour after check-in has passed", async () => {
    await expectError(
      await asResponse(() =>
        assertCanCreateInspection(
          mockDb([coveredReservation({
            checkInDatetime: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
          })]),
          VALID_UUID,
        ),
      ),
      400, "INSPECTION_WINDOW_EXPIRED", /inspection window has closed/,
    );
  });
});

describe("assertCanCreateFlag", () => {
  const flagRecord = (overrides: Record<string, unknown> = {}) => ({
    inspectionId: VALID_UUID,
    checkInDatetime: new Date().toISOString(),
    alternativeCheckInDatetime: null,
    existingFlagId: null,
    ...overrides,
  });

  it("passes for a fresh shot inside the window", async () => {
    await expect(
      assertCanCreateFlag(mockDb([flagRecord()]), { inspectionId: VALID_UUID, shotId: VALID_UUID }),
    ).resolves.toBeUndefined();
  });

  it("returns 404 INSPECTION_NOT_FOUND for an unknown inspection", async () => {
    await expectError(
      await asResponse(() =>
        assertCanCreateFlag(mockDb([]), { inspectionId: VALID_UUID, shotId: VALID_UUID }),
      ),
      404, "INSPECTION_NOT_FOUND", /Inspection does not exist/,
    );
  });

  it("returns 409 FLAG_ALREADY_EXISTS when one exists for the shot", async () => {
    const res = await asResponse(() =>
      assertCanCreateFlag(
        mockDb([flagRecord({ existingFlagId: OTHER_UUID })]),
        { inspectionId: VALID_UUID, shotId: VALID_UUID },
      ),
    );
    await expectError(res, 409, "FLAG_ALREADY_EXISTS",
      /already been submitted for this shot/);
  });

  it("returns 400 FLAG_WINDOW_EXPIRED past the submission window", async () => {
    await expectError(
      await asResponse(() =>
        assertCanCreateFlag(
          mockDb([flagRecord({
            checkInDatetime: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          })]),
          { inspectionId: VALID_UUID, shotId: VALID_UUID },
        ),
      ),
      400, "FLAG_WINDOW_EXPIRED", /Flags can only be submitted up to 12 hours/,
    );
  });
});

describe("lock assertions", () => {
  it("permits an asset that is not locked", async () => {
    await expect(assertCanModifyAsset(mockDb([]), VALID_UUID, "delete")).resolves.toBeUndefined();
  });

  it("returns 409 ASSET_LOCKED with the action phrased in the message", async () => {
    const res = await asResponse(() =>
      assertCanModifyAsset(mockDb([{ reservationId: OTHER_UUID, status: "COVERED" }]),
        VALID_UUID, "delete"));

    const body = await expectError(res, 409, "ASSET_LOCKED", /cannot be deleted because/);

    expect(body.error.meta.reservationId).toBe(OTHER_UUID);
    expect(body.error.message).not.toContain(VALID_UUID);
  });

  it("words ASSET_LOCKED as 'changed' for an update", async () => {
    await expectError(
      await asResponse(() =>
        assertCanModifyAsset(mockDb([{ reservationId: OTHER_UUID, status: "DISPUTED" }]),
          VALID_UUID, "update"),
      ),
      409, "ASSET_LOCKED", /cannot be changed because/,
    );
  });

  it("returns 409 APARTMENT_SHOTS_LOCKED when the apartment has an active reservation", async () => {
    const res = await asResponse(() =>
      assertCanModifyApartmentShots(mockDb([{ apartmentId: VALID_UUID, status: "COVERED" }]),
        VALID_UUID));

    const body = await expectError(res, 409, "APARTMENT_SHOTS_LOCKED",
      /upcoming or active reservation/);

    expect(body.error.meta.apartmentId).toBe(VALID_UUID);
    expect(body.error.message).not.toContain(VALID_UUID);
  });

  it("permits shots when no reservation locks the apartment", async () => {
    await expect(assertCanModifyApartmentShots(mockDb([]), VALID_UUID)).resolves.toBeUndefined();
  });
});
