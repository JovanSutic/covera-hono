import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { specialAccessService, HOUR_MS } from "./special_access.service";

const APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440000";
const ITEM_ID = "880e8400-e29b-41d4-a716-446655440000";

/**
 * Chainable stand-in for the Drizzle query builder. Every method returns the same
 * object, and the whole chain is thenable, so a service call that ends in
 * `.limit(1)` and one that ends in `.returning()` both resolve to `rows`.
 */
const chainDb = (rows: unknown[]) => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => chain,
    innerJoin: () => chain,
    insert: () => chain,
    values: () => chain,
    update: () => chain,
    set: () => chain,
    returning: () => chain,
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  };
  return chain as any;
};

/** Captures every `where` clause passed to the builder, for a predicate assertion. */
const capturingDb = (rows: unknown[]) => {
  const wheres: unknown[] = [];
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: (clause: unknown) => {
      wheres.push(clause);
      return chain;
    },
    limit: () => chain,
    then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
  };
  return { db: chain as any, wheres };
};

const LIVE_ROW = {
  id: "id-1",
  accessId: "tok",
  scope: "inspection_proof",
  apartmentId: APARTMENT_ID,
  reservationId: RESERVATION_ID,
  incidentItemId: null,
  expiresAt: new Date(Date.now() + HOUR_MS),
  revokedAt: null,
  usedAt: null,
  createdBy: "u-1",
  createdAt: new Date(),
};

beforeEach(() => vi.clearAllMocks());

describe("resolveByToken", () => {
  it("returns the grant for a live token", async () => {
    const db = chainDb([LIVE_ROW]);
    const result = await specialAccessService.resolveByToken(db, "tok");

    expect(result?.id).toBe("id-1");
  });

  it("returns null when no row matches", async () => {
    const db = chainDb([]);
    expect(await specialAccessService.resolveByToken(db, "tok")).toBeNull();
  });

  it("returns null for an expired grant even though the row exists", async () => {
    // The DB filters revocation but not expiry, so this is the branch that makes
    // a stale window a dead link rather than a readable row.
    const db = chainDb([{ ...LIVE_ROW, expiresAt: new Date(Date.now() - 1000) }]);
    expect(await specialAccessService.resolveByToken(db, "tok")).toBeNull();
  });

  it("filters revoked grants in the SQL predicate, not in JS", async () => {
    const { db, wheres } = capturingDb([]);
    await specialAccessService.resolveByToken(db, "tok");

    expect(wheres.length).toBe(1);
    // Rendered through the real dialect: `String(where)` would print `[object
    // Object]` and pass vacuously.
    const sql = new PgDialect().sqlToQuery((wheres[0] as any).getSQL()).sql;
    expect(sql).toContain('"special_access"."revoked_at" is null');
  });
});

describe("findByToken", () => {
  it("returns an expired-and-revoked grant, because management needs to see it", async () => {
    // D15: revoking an already-dead grant must still be idempotent, so this
    // lookup deliberately does NOT filter on expiry or revocation.
    const db = chainDb([
      { ...LIVE_ROW, expiresAt: new Date(Date.now() - 1000), revokedAt: new Date() },
    ]);

    const result = await specialAccessService.findByToken(db, "tok");

    expect(result).not.toBeNull();
  });
});

describe("revokeById", () => {
  it('reports "revoked" when the update matched a row', async () => {
    const db = chainDb([{ id: "id-1" }]);
    expect(await specialAccessService.revokeById(db, "id-1")).toBe("revoked");
  });

  it('reports "already" when the conditional update matched nothing', async () => {
    // The `IS NULL` on `revoked_at` is what makes a second revoke a no-op rather
    // than a second timestamp, so this empty result drives the idempotent 200.
    const db = chainDb([]);
    expect(await specialAccessService.revokeById(db, "id-1")).toBe("already");
  });
});

describe("create", () => {
  it("sets expiry from expiresInHours, measured from now", async () => {
    const values: unknown[] = [];
    const chain: any = {
      insert: () => chain,
      values: (v: unknown) => {
        values.push(v);
        return chain;
      },
      returning: () => chain,
      then: (res: any, rej: any) => Promise.resolve([LIVE_ROW]).then(res, rej),
    };

    const before = Date.now();

    await specialAccessService.create(
      chain,
      { scope: "inspection_proof", expiresInHours: 2 } as never,
      { apartmentId: APARTMENT_ID, reservationId: RESERVATION_ID, incidentItemId: null },
      "u-1",
    );

    const expiry = (values[0] as { expiresAt: Date }).expiresAt.getTime();
    // Two hours, within the tolerance of the call itself.
    expect(expiry).toBeGreaterThanOrEqual(before + 2 * HOUR_MS);
    expect(expiry).toBeLessThan(before + 2 * HOUR_MS + 5_000);
  });

  it("stores the subject it was given, not one re-derived from the input", async () => {
    const values: unknown[] = [];
    const chain: any = {
      insert: () => chain,
      values: (v: unknown) => {
        values.push(v);
        return chain;
      },
      returning: () => chain,
      then: (res: any, rej: any) => Promise.resolve([LIVE_ROW]).then(res, rej),
    };

    await specialAccessService.create(
      chain,
      { scope: "inspection_proof", expiresInHours: 12 } as never,
      { apartmentId: APARTMENT_ID, reservationId: RESERVATION_ID, incidentItemId: null },
      "u-1",
    );

    expect(values[0]).toMatchObject({
      scope: "inspection_proof",
      apartmentId: APARTMENT_ID,
      reservationId: RESERVATION_ID,
      incidentItemId: null,
      createdBy: "u-1",
    });
  });

  it("mints a 32-character hex token", async () => {
    const values: unknown[] = [];
    const chain: any = {
      insert: () => chain,
      values: (v: unknown) => {
        values.push(v);
        return chain;
      },
      returning: () => chain,
      then: (res: any, rej: any) => Promise.resolve([LIVE_ROW]).then(res, rej),
    };

    await specialAccessService.create(
      chain,
      { scope: "inspection_proof", expiresInHours: 12 } as never,
      { apartmentId: APARTMENT_ID, reservationId: RESERVATION_ID, incidentItemId: null },
      null,
    );

    expect((values[0] as { accessId: string }).accessId).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("resolveSubjectApartment", () => {
  it("resolves a reservation to its apartment in one query", async () => {
    const db = chainDb([{ apartmentId: APARTMENT_ID, reservationId: RESERVATION_ID }]);

    const result = await specialAccessService.resolveSubjectApartment(db, {
      reservationId: RESERVATION_ID,
    });

    expect(result).toEqual({
      apartmentId: APARTMENT_ID,
      reservationId: RESERVATION_ID,
      incidentItemId: null,
    });
  });

  it("resolves a claim item to its apartment through the claim", async () => {
    const db = chainDb([
      { apartmentId: APARTMENT_ID, reservationId: RESERVATION_ID, incidentItemId: ITEM_ID },
    ]);

    const result = await specialAccessService.resolveSubjectApartment(db, {
      incidentItemId: ITEM_ID,
    });

    expect(result).toEqual({
      apartmentId: APARTMENT_ID,
      reservationId: RESERVATION_ID,
      incidentItemId: ITEM_ID,
    });
  });

  it("returns null for an unknown reservation", async () => {
    const db = chainDb([]);
    expect(
      await specialAccessService.resolveSubjectApartment(db, { reservationId: RESERVATION_ID }),
    ).toBeNull();
  });
});
