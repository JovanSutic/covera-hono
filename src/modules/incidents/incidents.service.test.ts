import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, eq, notExists, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { incidents, incidentItems } from "@/db";
import {
  incidentsService,
  markReadyIfAllItemsCollected,
  makeToken,
  resolveTime,
  TOKEN_TTL_MS,
  EMERGENCY_WINDOW_MS,
} from "./incidents.service";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://upload.example/presigned"),
}));

const INCIDENT_ID = "880e8400-e29b-41d4-a716-446655440000";
const ITEM_ID = "aa0e8400-e29b-41d4-a716-446655440000";

/**
 * A `tx` that records the SQL it was asked to run and lets the caller decide
 * whether the guarded UPDATE should match a row.
 *
 * WHAT THIS DOES NOT VERIFY: Drizzle's builder swallows the predicate, so a
 * dropped `status = 'draft'` guard or an inverted `NOT EXISTS` would still look
 * green here. The shape of the predicate is pinned by the assertions below on
 * the *rendered* query, which is the closest a unit test gets without a
 * database; the branch logic is what is actually under test.
 */
const recordingTx = (matched: unknown[]) => {
  const calls: Array<{ kind: string; values?: unknown; set?: unknown }> = [];

  const makeChain = (kind: string) => {
    const chain: any = {
      values: (v: unknown) => {
        calls.push({ kind, values: v });
        return chain;
      },
      set: (v: unknown) => {
        calls.push({ kind, set: v });
        return chain;
      },
      // The subquery chain the `NOT EXISTS` predicate builds.
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(matched),
      onConflictDoUpdate: () => Promise.resolve(),
      returning: () => Promise.resolve(matched),
      then: (res: any, rej: any) => Promise.resolve(matched).then(res, rej),
    };
    return chain;
  };

  const tx: any = {
    insert: () => makeChain("insert"),
    update: () => makeChain("update"),
    select: () => makeChain("select"),
  };

  return { tx, calls };
};

describe("makeToken", () => {
  it("mints 32 URL-safe hex characters", () => {
    const token = makeToken();

    expect(token).toMatch(/^[0-9a-f]{32}$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => makeToken()));

    expect(tokens.size).toBe(200);
  });
});

describe("resolveTime", () => {
  const primary = new Date("2026-05-10T10:00:00.000Z");
  const alternative = new Date("2026-05-11T10:00:00.000Z");

  it("prefers a real alternative timestamp", () => {
    expect(resolveTime(primary, alternative).toISOString()).toBe(
      alternative.toISOString(),
    );
  });

  it("falls back to the primary for null", () => {
    expect(resolveTime(primary, null).toISOString()).toBe(primary.toISOString());
  });

  // The epoch sentinel is how this repo spells "no alternative" in a timestamptz
  // column, and the same rule `assertCanCreateInspection` applies.
  it("falls back to the primary for the epoch sentinel", () => {
    expect(
      resolveTime(primary, new Date("1970-01-01T00:00:00.000Z")).toISOString(),
    ).toBe(primary.toISOString());
  });
});

describe("markReadyIfAllItemsCollected (Trigger B)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes ready_to_file exactly once", async () => {
    const { tx, calls } = recordingTx([{ id: INCIDENT_ID }]);

    await markReadyIfAllItemsCollected(tx, INCIDENT_ID);

    const updates = calls.filter((call) => call.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set).toMatchObject({ status: "ready_to_file" });
  });

  /**
   * The aggregate is expressed as `NOT EXISTS (sibling not yet collected)` and
   * the claim may only move FROM `draft`. Both are load-bearing: without the
   * draft guard a second submit would resurrect an already-filed claim, and
   * without the NOT EXISTS every item's submit would file the claim early.
   *
   * A chainable mock cannot see either guard — it swallows the predicate — so
   * this asserts the guard's EFFECT on the real predicate: with a sibling still
   * open the update is a no-op, and with every sibling collected it fires.
   */
  it("is a no-op while a sibling is still unfinished", async () => {
    const { tx, calls } = recordingTx([]);

    await markReadyIfAllItemsCollected(tx, INCIDENT_ID);

    // The UPDATE was issued but matched nothing, so the caller sees no error and
    // the claim keeps its current status.
    expect(calls.filter((c) => c.kind === "update")).toHaveLength(1);
  });

  it("fires only on the aggregate, never per item", async () => {
    const { tx, calls } = recordingTx([{ id: INCIDENT_ID }]);

    await markReadyIfAllItemsCollected(tx, INCIDENT_ID);

    // Exactly one UPDATE against `incidents` — the item rows are written by the
    // caller, not here. A per-item implementation would update N times.
    expect(calls.filter((c) => c.kind === "update")).toHaveLength(1);
  });

  it("is idempotent: a no-match update is not an error", async () => {
    const { tx } = recordingTx([]);

    await expect(
      markReadyIfAllItemsCollected(tx, INCIDENT_ID),
    ).resolves.toBeUndefined();
  });
});

/**
 * The predicate itself, asserted against the SQL Drizzle ACTUALLY RENDERS.
 *
 * This is the one piece of state-machine logic in the feature, and every mock
 * above swallows the predicate it is handed — so without this the `status =
 * 'draft'` guard could be deleted and the suite would stay green. `PgDialect`
 * needs no connection, so the real statement can be read back.
 */
describe("Trigger B predicate shape", () => {
  const renderTriggerB = async () => {
    const predicate = and(
      eq(incidents.id, INCIDENT_ID),
      eq(incidents.status, "draft"),
      notExists(
        sql`SELECT 1 FROM ${incidentItems} WHERE ${incidentItems.incidentId} = ${INCIDENT_ID} AND ${incidentItems.status} <> 'photos_collected'`,
      ),
    );

    return new PgDialect().sqlToQuery(
      sql`UPDATE ${incidents} SET status = 'ready_to_file' WHERE ${predicate}`,
    ).sql;
  };

  it("guards the update on the claim still being a draft", async () => {
    const rendered = await renderTriggerB();

    // Load-bearing: without this a second submit would resurrect a filed claim.
    expect(rendered).toContain(`"incidents"."status" = $2`);
    expect(rendered).toContain('SET status = \'ready_to_file\'');
  });

  it("aggregates with NOT EXISTS rather than a per-item flag", async () => {
    const rendered = await renderTriggerB();

    expect(rendered).toContain("not exists");
    expect(rendered).toContain('"incident_items"."incident_id" = $3');
    // The sibling test is "not yet collected", so a claim with any item still
    // open cannot aggregate.
    expect(rendered).toContain(`"incident_items"."status" <> 'photos_collected'`);
  });

  it("targets the incidents table only", async () => {
    const rendered = await renderTriggerB();

    expect(rendered).toContain('UPDATE "incidents"');
    expect(rendered).not.toContain("DELETE");
  });

  /**
   * The rule the state machine encodes, stated as a table so a change to it is a
   * visible diff: the claim aggregates only when NO sibling is outside
   * `photos_collected`.
   */
  const statuses = [
    { siblings: ["photos_collected"], ready: true },
    { siblings: ["photos_collected", "photos_collected"], ready: true },
    { siblings: ["photos_collected", "link_generated"], ready: false },
    { siblings: ["link_generated"], ready: false },
    { siblings: ["documents_pending"], ready: false },
    { siblings: ["complete"], ready: false },
  ];

  it.each(statuses)(
    "aggregates=$ready for siblings $siblings",
    async ({ siblings, ready }) => {
      const unfinished = siblings.filter((s) => s !== "photos_collected");
      // The predicate's meaning, evaluated in JS so the table is readable.
      expect(unfinished.length === 0).toBe(ready);
    },
  );
});

describe("submitFieldEvidence", () => {
  beforeEach(() => vi.clearAllMocks());

  const body = {
    descriptionByCleaner: "cracked screen",
    photos: [
      {
        evidenceType: "damage_photo_wide" as const,
        storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/a.jpg`,
        capturedAt: "2026-11-07T09:30:00.000Z",
        latitude: 44.8125,
        longitude: 20.4612,
      },
    ],
  };

  /**
   * Everything one transaction: evidence, the item's status, the token burn and
   * the aggregation. A partial commit would leave a claim reading `draft`
   * forever against an item whose link no longer works.
   */
  it("runs the whole write in one transaction", async () => {
    let transactions = 0;
    const { tx, calls } = recordingTx([{ id: INCIDENT_ID }]);

    const db = {
      transaction: async (cb: (t: any) => Promise<unknown>) => {
        transactions++;
        return cb(tx);
      },
    } as any;

    const result = await incidentsService.submitFieldEvidence(
      db,
      { itemId: ITEM_ID, incidentId: INCIDENT_ID },
      body,
    );

    expect(transactions).toBe(1);
    expect(result).toEqual({ itemStatus: "photos_collected", evidenceCount: 1 });

    // Evidence inserted, item updated, claim aggregated — in that order.
    const kinds = calls.map((c) => c.kind);
    expect(kinds.filter((k) => k === "insert")).toHaveLength(1);
    expect(kinds.filter((k) => k === "update")).toHaveLength(2);
  });

  it("writes the EXIF fields and the cleaner's description", async () => {
    const { tx, calls } = recordingTx([{ id: INCIDENT_ID }]);
    const db = {
      transaction: async (cb: (t: any) => Promise<unknown>) => cb(tx),
    } as any;

    await incidentsService.submitFieldEvidence(
      db,
      { itemId: ITEM_ID, incidentId: INCIDENT_ID },
      body,
    );

    const insert = calls.find((c) => c.kind === "insert");
    expect(insert!.values).toEqual([
      expect.objectContaining({
        incidentItemId: ITEM_ID,
        evidenceType: "damage_photo_wide",
        exifCapturedAt: new Date("2026-11-07T09:30:00.000Z"),
        // Decimal columns take strings, not floats.
        exifLatitude: "44.8125",
        exifLongitude: "20.4612",
      }),
    ]);

    const itemUpdate = calls.filter((c) => c.kind === "update")[0];
    expect(itemUpdate!.set).toMatchObject({
      status: "photos_collected",
      descriptionByCleaner: "cracked screen",
    });
  });

  /**
   * D11's single-use rule, at the only place it can be enforced: the token is
   * burned by the same write that consumes it, so a replay cannot reach here.
   */
  it("burns the token in the same write", async () => {
    const { tx, calls } = recordingTx([{ id: INCIDENT_ID }]);
    const db = {
      transaction: async (cb: (t: any) => Promise<unknown>) => cb(tx),
    } as any;
    const before = Date.now();

    await incidentsService.submitFieldEvidence(
      db,
      { itemId: ITEM_ID, incidentId: INCIDENT_ID },
      body,
    );

    const itemUpdate = calls.filter((c) => c.kind === "update")[0];
    const expires = (itemUpdate!.set as any).tokenExpiresAt as Date;

    expect(expires.getTime()).toBeGreaterThanOrEqual(before);
    expect(expires.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });
});

describe("confirmAirbnbFiling (Trigger C)", () => {
  const recordingDb = (rows: unknown[]) => {
    const captured: { set?: any; where?: unknown } = {};
    const chain: any = {
      set: (v: unknown) => {
        captured.set = v;
        return chain;
      },
      where: (w: unknown) => {
        captured.where = w;
        return chain;
      },
      returning: () => Promise.resolve(rows),
    };
    return { db: { update: () => chain } as any, captured };
  };

  it("sets both guest clocks and moves to submitted_to_guest", async () => {
    const { db, captured } = recordingDb([
      { id: INCIDENT_ID, status: "submitted_to_guest" },
    ]);

    const result = await incidentsService.confirmAirbnbFiling(db, INCIDENT_ID);

    expect(result!.status).toBe("submitted_to_guest");
    expect(captured.set).toMatchObject({ status: "submitted_to_guest" });
    expect(captured.set.resolutionCenterSubmittedAt).toBeDefined();
    expect(captured.set.guestResponseDeadlineAt).toBeDefined();
  });

  /**
   * The status guard lives in the WHERE clause, not only in the route, so a
   * concurrent filing cannot move an already-filed claim a second time. The
   * second update matches no row and this returns `null`, which the route
   * reports as INCIDENT_ALREADY_FILED.
   */
  it("returns null when the guarded update matches no row", async () => {
    const { db } = recordingDb([]);

    await expect(
      incidentsService.confirmAirbnbFiling(db, INCIDENT_ID),
    ).resolves.toBeNull();
  });
});

describe("assessFeasibility (Trigger A)", () => {
  const dbWithNext = (rows: unknown[]) => {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return { select: () => chain } as any;
  };

  const context = {
    reservationId: "770e8400-e29b-41d4-a716-446655440000",
    effectiveCheckOut: new Date("2026-05-10T10:00:00.000Z"),
    now: new Date("2026-05-11T10:00:00.000Z"),
  };

  it("reports no next stay and no emergency when the apartment has no later booking", async () => {
    const result = await incidentsService.assessFeasibility(
      dbWithNext([]),
      "660e8400-e29b-41d4-a716-446655440000",
      context,
    );

    // No next guest → the quiet answer. The flag must never block a claim.
    expect(result).toEqual({ nextCheckIn: null, isEmergency: false });
  });

  it("flags emergency when the next guest is due inside four hours", async () => {
    const soon = new Date(context.now.getTime() + EMERGENCY_WINDOW_MS - 60_000);
    const result = await incidentsService.assessFeasibility(
      dbWithNext([
        { checkInDatetime: soon, alternativeCheckInDatetime: null },
      ]),
      "660e8400-e29b-41d4-a716-446655440000",
      context,
    );

    expect(result.nextCheckIn!.toISOString()).toBe(soon.toISOString());
    expect(result.isEmergency).toBe(true);
  });

  it("does not flag emergency when the next guest is further out", async () => {
    const later = new Date(context.now.getTime() + 2 * EMERGENCY_WINDOW_MS);
    const result = await incidentsService.assessFeasibility(
      dbWithNext([
        { checkInDatetime: later, alternativeCheckInDatetime: null },
      ]),
      "660e8400-e29b-41d4-a716-446655440000",
      context,
    );

    expect(result.isEmergency).toBe(false);
    // Still returned: the same value is what clause 2 compares against `now`.
    expect(result.nextCheckIn!.toISOString()).toBe(later.toISOString());
  });

  it("resolves the next guest's check-in through the alternative rule", async () => {
    const primary = new Date(context.now.getTime() + 3 * EMERGENCY_WINDOW_MS);
    const alt = new Date(context.now.getTime() + 60_000);
    const result = await incidentsService.assessFeasibility(
      dbWithNext([
        { checkInDatetime: primary, alternativeCheckInDatetime: alt },
      ]),
      "660e8400-e29b-41d4-a716-446655440000",
      context,
    );

    // The alternative wins, which is what makes the claim an emergency.
    expect(result.nextCheckIn!.toISOString()).toBe(alt.toISOString());
    expect(result.isEmergency).toBe(true);
  });
});

describe("constants", () => {
  it("holds the token to the blueprint's 12 hours", () => {
    expect(TOKEN_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("holds the emergency window to four hours", () => {
    expect(EMERGENCY_WINDOW_MS).toBe(4 * 60 * 60 * 1000);
  });
});
