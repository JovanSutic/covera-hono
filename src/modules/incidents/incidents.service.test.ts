import { describe, it, expect, vi, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { DOCUMENT_EVIDENCE_TYPES, EVIDENCE_KIND } from "@/db";
import {
  incidentsService,
  markReadyIfAllItemsCollected,
  syncIncidentReadiness,
  incidentHasItemsSql,
  incidentHasUncollectedItemSql,
  makeToken,
  resolveTime,
  evidenceKind,
  allowedEvidenceTypes,
  requiredPhotoTypes,
  isClaimEditable,
  MAX_EVIDENCE_PER_ITEM,
  TOKEN_TTL_MS,
  EMERGENCY_WINDOW_MS,
} from "./incidents.service";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://upload.example/presigned"),
}));

const INCIDENT_ID = "880e8400-e29b-41d4-a716-446655440000";
const ITEM_ID = "aa0e8400-e29b-41d4-a716-446655440000";
const EVIDENCE_ID = "bb0e8400-e29b-41d4-a716-446655440000";
const ASSET_ID = "990e8400-e29b-41d4-a716-446655440000";

type Op = "select" | "insert" | "update" | "delete";
type Recorded = { op: Op; values?: unknown; set?: unknown };

/**
 * A `tx` that records every operation and answers each terminal from a queue.
 *
 * WHAT THIS DOES NOT VERIFY: Drizzle's builder swallows the predicate, so a
 * dropped `status = 'draft'` guard or an inverted `NOT EXISTS` would still look
 * green here. The predicates themselves are pinned by the assertions on the
 * RENDERED SQL below, which is the closest a unit test gets without a database.
 * What this harness is for is the branch logic above them.
 *
 * The queues are POSITIONAL, because that is how the writes are ordered: one
 * `selects` entry per awaited SELECT (including one terminated by `.limit()`),
 * one `mutates` entry per INSERT/UPDATE/DELETE terminal. A method that gains or
 * loses a query therefore fails loudly here instead of silently reading the
 * wrong answer from the wrong call.
 */
const fakeTx = (plan: { selects?: unknown[][]; mutates?: unknown[][] } = {}) => {
  const calls: Recorded[] = [];
  const selects = [...(plan.selects ?? [])];
  const mutates = [...(plan.mutates ?? [])];

  const next = (op: Op, record: Recorded) => {
    if (op !== "select") {
      const rows = mutates.shift() ?? [];

      // Postgres echoes the STORED row back from RETURNING, so a single-row
      // insert's queued fixture is overlaid with what was actually written —
      // which is how the freshly minted `cleanerToken` reaches the caller. The
      // fixture supplies only what the database generates (id, timestamps).
      if (
        op === "insert" &&
        record.values !== undefined &&
        !Array.isArray(record.values) &&
        Array.isArray(rows)
      ) {
        return rows.map((row) => ({ ...(row as object), ...(record.values as object) }));
      }

      return rows;
    }

    return selects.shift() ?? [];
  };

  const chain = (op: Op): any => {
    const record: Recorded = { op };
    calls.push(record);

    const self: any = {
      values: (v: unknown) => {
        record.values = v;
        return self;
      },
      set: (v: unknown) => {
        record.set = v;
        return self;
      },
      from: () => self,
      where: () => self,
      innerJoin: () => self,
      orderBy: () => self,
      offset: () => self,
      limit: () => Promise.resolve(next("select", record)),
      returning: () => Promise.resolve(next(op, record)),
      then: (res: any, rej: any) => Promise.resolve(next(op, record)).then(res, rej),
    };

    return self;
  };

  const tx: any = {
    select: () => chain("select"),
    insert: () => chain("insert"),
    update: () => chain("update"),
    delete: () => chain("delete"),
  };

  return { tx, calls };
};

const fakeDb = (plan: { selects?: unknown[][]; mutates?: unknown[][] } = {}) => {
  const { tx, calls } = fakeTx(plan);
  let transactions = 0;

  const db: any = {
    transaction: async (cb: (t: unknown) => Promise<unknown>) => {
      transactions++;
      return cb(tx);
    },
  };

  return {
    db,
    calls,
    get transactions() {
      return transactions;
    },
    ops: (op: Op) => calls.filter((call) => call.op === op),
  };
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

/**
 * The photo/document split. It is DERIVED from the one enum map rather than
 * stored beside it, so an evidence row's half can never disagree with the
 * registry that classifies it — which is why it is worth pinning here.
 */
describe("evidence classification", () => {
  it("derives `kind` from the one enum map", () => {
    expect(evidenceKind("damage_photo_wide")).toBe("photo");
    expect(evidenceKind("original_purchase_receipt")).toBe("document");
    expect(evidenceKind("police_report")).toBe("document");
  });

  it("names every document type and no photo", () => {
    expect([...DOCUMENT_EVIDENCE_TYPES].sort()).toEqual([
      "handyman_invoice",
      "original_purchase_receipt",
      "police_report",
      "replacement_retail_quote",
    ]);
  });

  it("classifies every registered type, so a new enum member cannot slip through", () => {
    for (const type of Object.keys(EVIDENCE_KIND)) {
      expect(["photo", "document"]).toContain(evidenceKind(type));
    }
  });

  /**
   * Documents belong to BOTH incident types — a receipt backs a theft and a
   * damage valuation alike — which is why they are added once here rather than
   * repeated in each type's photo row.
   */
  it("accepts both photo halves plus every document, per incident type", () => {
    expect(allowedEvidenceTypes("damage")).toEqual([
      "damage_photo_wide",
      "damage_photo_closeup",
      ...DOCUMENT_EVIDENCE_TYPES,
    ]);
    expect(allowedEvidenceTypes("theft")).toEqual([
      "theft_empty_space_photo",
      ...DOCUMENT_EVIDENCE_TYPES,
    ]);
  });

  /**
   * The cleaner is asked for PHOTOS only. Documents are the host's to supply,
   * and never something a cleaner is sent back to the apartment for — which is
   * D6's whole reason for the two surfaces having different accepted types.
   */
  it("asks the cleaner for photos only, never documents", () => {
    expect(requiredPhotoTypes("damage")).toEqual([
      "damage_photo_wide",
      "damage_photo_closeup",
    ]);
    expect(requiredPhotoTypes("theft")).toEqual(["theft_empty_space_photo"]);

    for (const type of DOCUMENT_EVIDENCE_TYPES) {
      expect(requiredPhotoTypes("damage")).not.toContain(type);
    }
  });
});

/**
 * The claim states a host may still change. A filed claim is frozen: the guest
 * is looking at it, and its contents must not move under them.
 */
describe("isClaimEditable", () => {
  it("allows a claim that has not been filed", () => {
    expect(isClaimEditable("draft")).toBe(true);
    expect(isClaimEditable("ready_to_file")).toBe(true);
  });

  it("freezes a claim from the moment it reaches the guest", () => {
    for (const status of [
      "submitted_to_guest",
      "escalated_to_aircover",
      "resolved",
      "unfeasible",
    ]) {
      expect(isClaimEditable(status)).toBe(false);
    }
  });
});

/**
 * The readiness predicate, asserted against the SQL Drizzle ACTUALLY RENDERS.
 *
 * Every mock in this file swallows the predicate it is handed, so without this
 * the `status = 'draft'` guard could be deleted and the suite would stay green.
 * `PgDialect` needs no connection, so the real statement can be read back — and
 * that is precisely why the service builds these as raw `sql` fragments rather
 * than `exists()` builders, whose chain a recording mock would hide.
 */
describe("readiness predicate shape", () => {
  const render = (fragment: unknown) =>
    new PgDialect().sqlToQuery(fragment as never).sql;

  it("requires the claim to have at least one item", () => {
    const rendered = render(incidentHasItemsSql(INCIDENT_ID));

    // Without this half, a claim with no items satisfies "no uncollected item"
    // vacuously and flips to ready the moment it is created.
    expect(rendered).toContain("EXISTS (SELECT 1 FROM");
    expect(rendered).toContain(`"incident_items"."incident_id"`);
    // Existence only — no status test in this half.
    expect(rendered).not.toContain("link_generated");
  });

  it("treats only `link_generated` as uncollected", () => {
    const rendered = render(incidentHasUncollectedItemSql(INCIDENT_ID));

    expect(rendered).toContain(`"incident_items"."status" = 'link_generated'`);
    // The old rule was `status <> 'photos_collected'`, which counted `complete`
    // as unfinished — so attaching a receipt to a ready claim unfiled it.
    expect(rendered).not.toContain("<> 'photos_collected'");
  });

  it("never deletes anything", () => {
    const rendered = render(incidentHasUncollectedItemSql(INCIDENT_ID));

    expect(rendered).not.toContain("DELETE");
  });

  /**
   * The rule the state machine encodes, stated as a table so a change to it is a
   * visible diff: the claim aggregates only when it HAS at least one item and NO
   * item is still `link_generated`.
   */
  const cases = [
    { items: ["photos_collected"], ready: true },
    { items: ["photos_collected", "photos_collected"], ready: true },
    { items: ["complete"], ready: true },
    { items: ["photos_collected", "complete"], ready: true },
    { items: ["photos_collected", "link_generated"], ready: false },
    { items: ["link_generated"], ready: false },
    { items: [], ready: false },
  ];

  it.each(cases)("aggregates=$ready for items $items", ({ items, ready }) => {
    // The predicate's meaning, evaluated in JS so the table is readable.
    const aggregates = items.length > 0 && !items.includes("link_generated");

    expect(aggregates).toBe(ready);
  });
});

describe("markReadyIfAllItemsCollected (Trigger B)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("writes ready_to_file first", async () => {
    const { tx, calls } = fakeTx({ mutates: [[], []] });

    await markReadyIfAllItemsCollected(tx, INCIDENT_ID);

    const updates = calls.filter((call) => call.op === "update");
    expect(updates[0]!.set).toMatchObject({ status: "ready_to_file" });
  });

  /**
   * Both directions, and only ever against `incidents`. The second one — back to
   * `draft` — is what makes an edit safe: removing an item, or deleting the last
   * photo of one, genuinely reopens a claim that was ready. Without it a claim
   * that lost its evidence could never be filed correctly again.
   */
  it("runs in both directions, once each", async () => {
    const { tx, calls } = fakeTx({ mutates: [[], []] });

    await syncIncidentReadiness(tx, INCIDENT_ID);

    const updates = calls.filter((call) => call.op === "update");
    expect(updates.map((u) => (u.set as { status: string }).status)).toEqual([
      "ready_to_file",
      "draft",
    ]);
    // Two statements, never one per item: the item rows are the caller's write.
    expect(updates).toHaveLength(2);
  });

  it("is idempotent: a no-match update is not an error", async () => {
    const { tx } = fakeTx({ mutates: [[], []] });

    await expect(
      markReadyIfAllItemsCollected(tx, INCIDENT_ID),
    ).resolves.toBeUndefined();
  });
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

  const context = { itemId: ITEM_ID, incidentId: INCIDENT_ID };

  /** One photo on the item: inserted, then re-derived as `photos_collected`. */
  const onePhoto = () =>
    fakeDb({
      selects: [[{ evidenceType: "damage_photo_wide" }]],
      // insert, the cleaner's description, the derived status, then the two
      // readiness statements.
      mutates: [[], [], [], [], []],
    });

  /**
   * Everything in one transaction: evidence, the item's status, the token burn
   * and the claim-level aggregation. A partial commit would leave a claim
   * reading `draft` forever against an item whose link no longer works.
   */
  it("runs the whole write in one transaction", async () => {
    const f = onePhoto();

    const result = await incidentsService.submitFieldEvidence(f.db, context, body);

    expect(f.transactions).toBe(1);
    expect(result).toEqual({ itemStatus: "photos_collected", evidenceCount: 1 });
    expect(f.ops("insert")).toHaveLength(1);
    expect(f.ops("update")).toHaveLength(4);
  });

  it("writes the EXIF fields and the cleaner's description", async () => {
    const f = onePhoto();

    await incidentsService.submitFieldEvidence(f.db, context, body);

    expect(f.ops("insert")[0]!.values).toEqual([
      expect.objectContaining({
        incidentItemId: ITEM_ID,
        evidenceType: "damage_photo_wide",
        exifCapturedAt: new Date("2026-11-07T09:30:00.000Z"),
        // Decimal columns take strings, not floats.
        exifLatitude: "44.8125",
        exifLongitude: "20.4612",
      }),
    ]);
    expect(f.ops("update")[0]!.set).toMatchObject({
      descriptionByCleaner: "cracked screen",
    });
  });

  /**
   * D11's single-use rule at the only place it can be enforced: the token is
   * burned by the same write that consumes it, so a replay cannot reach here.
   */
  it("burns the token in the same write that consumes it", async () => {
    const f = onePhoto();
    const before = Date.now();

    await incidentsService.submitFieldEvidence(f.db, context, body);

    const statusUpdate = f.ops("update")[1]!.set as {
      status: string;
      tokenExpiresAt: Date;
    };

    expect(statusUpdate.status).toBe("photos_collected");
    expect(statusUpdate.tokenExpiresAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(statusUpdate.tokenExpiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 1000,
    );
  });

  /**
   * V3: the route used to answer a hardcoded `"photos_collected"`, correct only
   * while one transition existed. The status is derived from the evidence
   * written and reported as it actually came out — here a photo plus a document,
   * which is `complete`.
   */
  it("reports the status the item actually ended up in", async () => {
    const f = fakeDb({
      selects: [
        [
          { evidenceType: "damage_photo_wide" },
          { evidenceType: "original_purchase_receipt" },
        ],
      ],
      mutates: [[], [], [], [], []],
    });

    const result = await incidentsService.submitFieldEvidence(f.db, context, body);

    expect(result.itemStatus).toBe("complete");
  });
});

/**
 * D6/D4: the host's write path — the first place the DOCUMENT half of
 * `evidence_file_type` is reachable at all, and the counterpart of the field
 * submit above.
 */
describe("attachEvidence", () => {
  const context = { incidentId: INCIDENT_ID, itemId: ITEM_ID };

  it("writes a document with no EXIF and reports what was attached", async () => {
    const f = fakeDb({
      selects: [[{ evidenceType: "original_purchase_receipt" }]],
      mutates: [[], [], [], []],
    });

    const result = await incidentsService.attachEvidence(f.db, context, {
      evidence: [
        {
          evidenceType: "original_purchase_receipt",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/receipt.pdf`,
        },
      ],
    });

    expect(result.attachedCount).toBe(1);
    expect(f.ops("insert")[0]!.values).toEqual([
      expect.objectContaining({
        incidentItemId: ITEM_ID,
        evidenceType: "original_purchase_receipt",
        exifCapturedAt: null,
        exifLatitude: null,
        exifLongitude: null,
      }),
    ]);
  });

  it("carries a photo's EXIF through", async () => {
    const f = fakeDb({
      selects: [[{ evidenceType: "damage_photo_wide" }]],
      mutates: [[], [], [], []],
    });

    await incidentsService.attachEvidence(f.db, context, {
      evidence: [
        {
          evidenceType: "damage_photo_wide",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/a.jpg`,
          capturedAt: "2026-11-07T09:30:00.000Z",
          latitude: 44.8125,
          longitude: 20.4612,
        },
      ],
    });

    expect(f.ops("insert")[0]!.values).toEqual([
      expect.objectContaining({
        exifCapturedAt: new Date("2026-11-07T09:30:00.000Z"),
        exifLatitude: "44.8125",
        exifLongitude: "20.4612",
      }),
    ]);
  });

  it("attaches a whole batch in one insert", async () => {
    const f = fakeDb({
      selects: [
        [
          { evidenceType: "damage_photo_wide" },
          { evidenceType: "handyman_invoice" },
        ],
      ],
      mutates: [[], [], [], []],
    });

    const result = await incidentsService.attachEvidence(f.db, context, {
      evidence: [
        {
          evidenceType: "damage_photo_wide",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/a.jpg`,
        },
        {
          evidenceType: "handyman_invoice",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/b.pdf`,
        },
      ],
    });

    expect(result.attachedCount).toBe(2);
    expect(f.ops("insert")).toHaveLength(1);
  });

  /**
   * The payoff of the rework. A receipt attached to an item that had already
   * collected its photos makes that item `complete` — and because readiness now
   * tests `link_generated` rather than "not photos_collected", the claim stays
   * fileable. Under the old predicate this very attach made the claim unfilable.
   */
  it("advances a photographed item to complete without un-readying the claim", async () => {
    const f = fakeDb({
      // The recompute reads the item's ACTIVE evidence, so an item that already
      // had its photos reports both rows after this attach.
      selects: [
        [
          { evidenceType: "damage_photo_wide" },
          { evidenceType: "original_purchase_receipt" },
        ],
      ],
      mutates: [[], [], [], []],
    });

    const result = await incidentsService.attachEvidence(f.db, context, {
      evidence: [
        {
          evidenceType: "original_purchase_receipt",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/receipt.pdf`,
        },
      ],
    });

    expect(result.itemStatus).toBe("complete");
    // The description never applies here, unlike the field submit: attach has no
    // cleaner text. Insert + derived status + both readiness statements.
    expect(f.ops("update")).toHaveLength(3);
  });

  /**
   * A document with no photo leaves the item uncollected: the cleaner's shots
   * are the required evidence, and a receipt does not stand in for them. The
   * link is deliberately NOT burned, because the host can still send the
   * cleaner — which is why `recomputeItemStatus` only stamps `tokenExpiresAt`
   * when the item has left `link_generated`.
   */
  it("leaves a document-only item uncollected, with its link intact", async () => {
    const f = fakeDb({
      selects: [[{ evidenceType: "police_report" }]],
      mutates: [[], [], [], []],
    });

    const result = await incidentsService.attachEvidence(f.db, context, {
      evidence: [
        {
          evidenceType: "police_report",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/report.pdf`,
        },
      ],
    });

    expect(result.itemStatus).toBe("link_generated");
    const statusUpdate = f.ops("update")[0]!.set as { tokenExpiresAt?: Date };
    expect(statusUpdate.tokenExpiresAt).toBeUndefined();
  });
});

/**
 * D4: photos were write-once and undeletable, so a mistaken upload was permanent.
 * The delete is soft — the row records what was filed — and the item's status is
 * re-derived from what remains.
 */
describe("deleteEvidence", () => {
  const context = {
    incidentId: INCIDENT_ID,
    itemId: ITEM_ID,
    evidenceId: EVIDENCE_ID,
  };

  it("soft-deletes rather than removing the row, and re-derives the status", async () => {
    // Nothing left on the item, so it returns to `link_generated`.
    const f = fakeDb({
      selects: [[]],
      mutates: [[{ id: EVIDENCE_ID }], [], [], []],
    });

    const result = await incidentsService.deleteEvidence(f.db, context);

    expect(result).toEqual({ id: EVIDENCE_ID, itemStatus: "link_generated" });

    const withdrawn = f.ops("update")[0]!.set as {
      status: string;
      deletedAt: Date;
    };
    expect(withdrawn.status).toBe("soft_deleted");
    expect(withdrawn.deletedAt).toBeInstanceOf(Date);

    // Never a DELETE: the record of what was filed survives, and the R2 object
    // is left in place.
    expect(f.ops("delete")).toHaveLength(0);
  });

  it("returns null when the evidence is unknown or already withdrawn", async () => {
    const f = fakeDb({ mutates: [[]] });

    await expect(
      incidentsService.deleteEvidence(f.db, context),
    ).resolves.toBeNull();
    // Nothing was withdrawn, so there is no status to re-derive and no readiness
    // to re-check: only the failed soft-delete ran.
    expect(f.ops("update")).toHaveLength(1);
  });

  it("keeps an item at photos_collected while a photo remains", async () => {
    const f = fakeDb({
      selects: [[{ evidenceType: "damage_photo_wide" }]],
      mutates: [[{ id: EVIDENCE_ID }], [], [], []],
    });

    const result = await incidentsService.deleteEvidence(f.db, context);

    expect(result).toEqual({
      id: EVIDENCE_ID,
      itemStatus: "photos_collected",
    });
  });
});

/**
 * D1/D2: the item write paths that make a claim and its items separately managed
 * rather than one atomic blob created all at once.
 */
describe("item writes", () => {
  const created = {
    id: ITEM_ID,
    incidentId: INCIDENT_ID,
    assetId: ASSET_ID,
    type: "damage",
    status: "link_generated",
    cleanerToken: "minted",
    tokenExpiresAt: new Date(),
    estimatedPlaceholderValueCents: 5000,
    descriptionByCleaner: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const assetRow = {
    asset: {
      id: ASSET_ID,
      name: 'Samsung 55" TV',
      apartmentId: "660e8400-e29b-41d4-a716-446655440000",
      assetTypeId: "770e8400-e29b-41d4-a716-446655440000",
    },
    assetType: {
      id: "770e8400-e29b-41d4-a716-446655440000",
      name: "Electronics",
    },
  };

  it("adds an item with a fresh token and recomputes the claim total", async () => {
    const f = fakeDb({
      // The duplicate check finds nothing, then the asset read, then the sum.
      selects: [[], [assetRow], [{ total: 5000 }]],
      mutates: [[created], [], [], []],
    });

    const item = await incidentsService.addItem(f.db, INCIDENT_ID, {
      assetId: ASSET_ID,
      type: "damage",
      estimatedPlaceholderValueCents: 5000,
    });

    expect(item!.cleanerToken).toMatch(/^[0-9a-f]{32}$/);
    expect(item!.asset).toMatchObject({
      id: ASSET_ID,
      asset_type: assetRow.assetType,
    });
    // A brand-new item has collected nothing yet.
    expect(item!.evidence).toEqual([]);

    expect(f.ops("insert")[0]!.values).toMatchObject({
      incidentId: INCIDENT_ID,
      assetId: ASSET_ID,
      type: "damage",
      status: "link_generated",
      estimatedPlaceholderValueCents: 5000,
    });

    // The claim's derived total is recomputed in the same transaction, and the
    // claim is re-checked for readiness: a fresh uncollected item un-readies a
    // claim that had been ready.
    const updates = f.ops("update");
    expect(
      updates.some((u) => "placeholderTotalAmountCents" in (u.set as object)),
    ).toBe(true);
    expect(updates).toHaveLength(3);
  });

  it("refuses a duplicate asset without inserting", async () => {
    const f = fakeDb({ selects: [[{ id: "existing-item" }]] });

    const item = await incidentsService.addItem(f.db, INCIDENT_ID, {
      assetId: ASSET_ID,
      type: "damage",
    });

    expect(item).toBeNull();
    expect(f.ops("insert")).toHaveLength(0);
  });

  it("corrects one item's type and value, recomputing the total", async () => {
    const updated = {
      ...created,
      type: "theft",
      estimatedPlaceholderValueCents: 7000,
    };
    const f = fakeDb({ selects: [[{ total: 7000 }]], mutates: [[updated], []] });

    const row = await incidentsService.updateItem(f.db, INCIDENT_ID, ITEM_ID, {
      type: "theft",
      estimatedPlaceholderValueCents: 7000,
    });

    expect(row).toMatchObject({ type: "theft" });
    expect(f.ops("update")[0]!.set).toMatchObject({ type: "theft" });
    expect(f.ops("update")[1]!.set as object).toHaveProperty(
      "placeholderTotalAmountCents",
    );
  });

  it("returns null for an item that is not on this claim", async () => {
    const f = fakeDb({ mutates: [[]] });

    const row = await incidentsService.updateItem(f.db, INCIDENT_ID, ITEM_ID, {
      type: "theft",
    });

    expect(row).toBeNull();
    // Nothing was updated, so there is no total to recompute.
    expect(f.ops("update")).toHaveLength(1);
  });

  it("deletes an item and recomputes the claim total", async () => {
    const f = fakeDb({
      selects: [[{ total: 0 }]],
      mutates: [[{ id: ITEM_ID }], [], [], []],
    });

    const deleted = await incidentsService.deleteItem(f.db, INCIDENT_ID, ITEM_ID);

    expect(deleted).toEqual({ id: ITEM_ID });
    expect(f.ops("delete")).toHaveLength(1);
    expect(
      f.ops("update").some((u) => "placeholderTotalAmountCents" in (u.set as object)),
    ).toBe(true);
  });

  it("returns null when the item is not on this claim", async () => {
    const f = fakeDb({ mutates: [[]] });

    await expect(
      incidentsService.deleteItem(f.db, INCIDENT_ID, ITEM_ID),
    ).resolves.toBeNull();
    expect(f.ops("update")).toHaveLength(0);
  });
});

/**
 * D3, the audit's most severe finding: the field token is single-use and
 * time-limited, and nothing could mint another — so a claim whose cleaner was
 * slow could never collect its evidence. This is the recovery path.
 */
describe("reissueToken", () => {
  const reissueDb = (rows: unknown[], hydrated: unknown) => {
    const captured: { set?: unknown; where?: unknown } = {};
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

    const db: any = {
      update: () => chain,
      query: { incidentItems: { findFirst: async () => hydrated } },
    };

    return { db, captured };
  };

  it("replaces the token and extends the expiry in one write", async () => {
    const { db, captured } = reissueDb(
      [{ id: ITEM_ID }],
      { id: ITEM_ID, cleanerToken: "fresh", asset: null, evidence: [] },
    );
    const before = Date.now();

    const item = await incidentsService.reissueToken(db, INCIDENT_ID, ITEM_ID);

    // One of the only two payloads allowed to carry the token (D11).
    expect(item!.cleanerToken).toBe("fresh");
    expect(item!.evidence).toEqual([]);

    const set = captured.set as { cleanerToken: string; tokenExpiresAt: Date };
    // A NEW value, which is what invalidates the old link the moment it commits:
    // `getFieldContext` resolves the item by token.
    expect(set.cleanerToken).toMatch(/^[0-9a-f]{32}$/);
    expect(set.tokenExpiresAt.getTime()).toBeGreaterThanOrEqual(
      before + TOKEN_TTL_MS - 1000,
    );
  });

  /**
   * Only legal while the item is still `link_generated` — the guard is in the
   * WHERE clause, so an item that has already collected evidence matches no row
   * and this returns null. The route turns that into INCIDENT_ITEM_LOCKED.
   */
  it("returns null when the item is unknown or has already collected evidence", async () => {
    const { db } = reissueDb([], null);

    await expect(
      incidentsService.reissueToken(db, INCIDENT_ID, ITEM_ID),
    ).resolves.toBeNull();
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
    // Both clocks come from NOW(), not from the stored escalation date: the 24
    // hours the guest is given start when the host actually files.
    expect(captured.set.resolutionCenterSubmittedAt).toBeDefined();
    expect(captured.set.guestResponseDeadlineAt).toBeDefined();
  });

  /**
   * The status guard lives in the WHERE clause, not only in the route, so a
   * concurrent filing cannot move an already-filed claim a second time. The
   * second update matches no row and returns `null`, which the route reports as
   * INCIDENT_ALREADY_FILED.
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
      dbWithNext([{ checkInDatetime: soon, alternativeCheckInDatetime: null }]),
      "660e8400-e29b-41d4-a716-446655440000",
      context,
    );

    expect(result.nextCheckIn!.toISOString()).toBe(soon.toISOString());
    expect(result.isEmergency).toBe(true);
  });

  it("does not flag emergency when the next guest is further out", async () => {
    const later = new Date(context.now.getTime() + 2 * EMERGENCY_WINDOW_MS);
    const result = await incidentsService.assessFeasibility(
      dbWithNext([{ checkInDatetime: later, alternativeCheckInDatetime: null }]),
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

  /**
   * S1: the unauthenticated field surface is bounded by nothing else, so this cap
   * is the only thing between a bearer token and unbounded rows. It mirrors
   * `MAX_PHOTOS_PER_RESERVATION` in the apartments module.
   */
  it("caps an item's evidence at the same number as a reservation's photos", () => {
    expect(MAX_EVIDENCE_PER_ITEM).toBe(20);
  });
});
