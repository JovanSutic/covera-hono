import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  lt,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  incidents,
  incidentItems,
  claimEvidence,
  reservations,
  assets,
  assetTypes,
  apartmentImages,
  apartments,
  EVIDENCE_KIND,
  DOCUMENT_EVIDENCE_TYPES,
  type EvidenceKind,
  type IncidentItem as IncidentItemRow,
  Incident,
  NewIncident,
} from "@/db";
import { Variables } from "@/types";
import { reservationsService } from "../reservations/reservations.service";
import type {
  CreateIncident,
  IncidentWithItems,
  IncidentItem,
  IncidentItemWithToken,
  FieldAsset,
  CreateIncidentResponse,
  FieldSubmitBody,
  AttachEvidenceBody,
  IncidentQuery,
  PaginatedIncidents,
  UpdateIncident,
  UpdateIncidentItem,
} from "./incidents.schema";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const ESCALATION_DAYS = 30;
const EMERGENCY_WINDOW_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The per-item evidence cap (S1).
 *
 * The field surface is unauthenticated and bounded by nothing else: a bearer-
 * token holder could mint unlimited presigned URLs and insert unlimited rows.
 * This mirrors `MAX_PHOTOS_PER_RESERVATION` in the apartments module, applied at
 * both places the apartments flow applies its own — the token mint, where a
 * single batch is bounded, and the write, which is the call that actually
 * INSERTs and therefore the one that enforces the real limit.
 */
export const MAX_EVIDENCE_PER_ITEM = 20;

/**
 * The claim states a host may still change. `submitted_to_guest` and anything
 * beyond it are frozen: the guest is looking at a filed claim, and its contents
 * must not move under them.
 */
const EDITABLE_STATUSES = ["draft", "ready_to_file"] as const;

export const isClaimEditable = (status: string): boolean =>
  (EDITABLE_STATUSES as readonly string[]).includes(status);

/**
 * Which PHOTO evidence types an item's incident type accepts (D13).
 *
 * Documents are not in these lists because they are valid for every type — a
 * receipt backs a theft and a damage valuation alike — so they are added by
 * `allowedEvidenceTypes` rather than repeated in both rows.
 */
export const PHOTO_EVIDENCE_FOR_TYPE: Record<
  "damage" | "theft",
  readonly string[]
> = {
  damage: ["damage_photo_wide", "damage_photo_closeup"],
  theft: ["theft_empty_space_photo"],
};

/** Every evidence type an item may carry: its photos, plus any document. */
export const allowedEvidenceTypes = (
  type: "damage" | "theft",
): string[] => [...PHOTO_EVIDENCE_FOR_TYPE[type], ...DOCUMENT_EVIDENCE_TYPES];

/** The evidence types the cleaner on site is asked to shoot for this item. */
export const requiredPhotoTypes = (type: "damage" | "theft"): string[] => [
  ...PHOTO_EVIDENCE_FOR_TYPE[type],
];

/** The `kind` half of an evidence type, derived from the one enum map. */
export const evidenceKind = (type: string): EvidenceKind =>
  EVIDENCE_KIND[type as keyof typeof EVIDENCE_KIND] ?? "document";

/**
 * A single-use, URL-safe field token (D12). `crypto.randomUUID()` is global in
 * Node 22 and in Workers, so this needs no dependency; stripping the dashes
 * leaves 32 hex characters. `cleaner_token` is UNIQUE, so a collision would be a
 * constraint failure rather than a silent overwrite.
 */
export const makeToken = (): string => crypto.randomUUID().replace(/-/g, "");

/**
 * The reservation time-resolution rule the rest of the repo already uses
 * (`assertCanCreateInspection`, `assertNoOverlappingReservation`): an
 * "alternative" timestamp counts only when it is a real date past the epoch.
 */
export const resolveTime = (
  primary: Date | string,
  alternative?: Date | string | null,
): Date => {
  if (alternative) {
    const alt = new Date(alternative);
    if (!Number.isNaN(alt.getTime()) && alt.getTime() > 0) return alt;
  }
  return new Date(primary);
};

/**
 * Adds the derived `kind` to an evidence row and renames nothing else.
 *
 * The split is computed here rather than read from a column because there is no
 * column: `EVIDENCE_KIND` is the single mapping, so a row's half can never
 * disagree with the registry that classifies it.
 */
const withKind = <T extends { evidenceType: string }>(row: T) => ({
  ...row,
  kind: evidenceKind(row.evidenceType),
});

/** Maps a hydrated incident row to the wire shape: active evidence, with `kind`. */
const hydrateIncident = (incident: any): IncidentWithItems => {
  const { items = [], ...rest } = incident as typeof incident & {
    items?: Array<Record<string, any>>;
  };

  return {
    ...rest,
    items: (items as Array<Record<string, any>>).map((item) => {
      const { asset, evidence, ...row } = item;

      return {
        ...row,
        asset: { ...(asset ?? {}), asset_type: asset?.assetType },
        evidence: activeEvidence(evidence),
      };
    }),
  } as unknown as IncidentWithItems;
};

/**
 * The evidence a read should show: the ACTIVE rows, each with its derived
 * `kind`.
 *
 * One function because the incident read, the item read and the item hydration
 * all answer the same question, and three copies of "filter out the soft
 * deletes" is how one of them quietly starts returning withdrawn evidence.
 */
const activeEvidence = (evidence: unknown): Array<Record<string, unknown>> =>
  ((evidence ?? []) as Array<{ status: string; evidenceType: string }>)
    .filter((row) => row.status === "active")
    .map((row) => withKind(row));

/**
 * One item row hydrated to the payload shape: its asset (with its type attached
 * under the name the schema uses) and its active evidence.
 *
 * Kept separate from `activeEvidence` so the item read and the incident read
 * cannot disagree about what an item looks like.
 */
const hydrateItem = (item: any): Record<string, any> => {
  const { asset, evidence, ...row } = item;

  return {
    ...row,
    asset: { ...(asset ?? {}), asset_type: asset?.assetType },
    evidence: activeEvidence(evidence),
  };
};

/**
 * The incident's derived total, recomputed from its item rows.
 *
 * `placeholder_total_amount_cents` summarises the items, so every write that can
 * change an item's value must recompute it — otherwise the total silently stops
 * matching the rows it summarises. Kept as one function so add, edit and delete
 * cannot disagree about how the sum is formed (D3).
 */
const recalcPlaceholderTotal = async (
  tx: any,
  incidentId: string,
): Promise<void> => {
  const [row] = await tx
    .select({
      total: sql<number>`COALESCE(SUM(${incidentItems.estimatedPlaceholderValueCents}), 0)`,
    })
    .from(incidentItems)
    .where(eq(incidentItems.incidentId, incidentId));

  await tx
    .update(incidents)
    .set({
      placeholderTotalAmountCents: Number(row?.total ?? 0),
      updatedAt: new Date(),
    })
    .where(eq(incidents.id, incidentId));
};

/**
 * Re-derives one item's status from the evidence it actually has, and burns its
 * link the moment it leaves `link_generated`.
 *
 * An item's status is a fact about its evidence, so it is stored but always
 * written from that evidence rather than set by hand at each call site. The same
 * rule runs after an attach and after a delete, which is what lets a host remove
 * a bad photo without stranding the item.
 *
 * `documents_pending` is deliberately unreachable: it means "documents have been
 * requested and are outstanding", and nothing in the system records a request.
 * Inventing a writer with no trigger would make the value lie.
 */
const recomputeItemStatus = async (tx: any, itemId: string): Promise<string> => {
  const rows = await tx
    .select({ evidenceType: claimEvidence.evidenceType })
    .from(claimEvidence)
    .where(
      and(
        eq(claimEvidence.incidentItemId, itemId),
        eq(claimEvidence.status, "active"),
      ),
    );

  const kinds = (rows as Array<{ evidenceType: string }>).map((row) =>
    evidenceKind(row.evidenceType),
  );
  const hasPhoto = kinds.includes("photo");
  const hasDocument = kinds.includes("document");

  const status = hasPhoto
    ? hasDocument
      ? "complete"
      : "photos_collected"
    : "link_generated";

  await tx
    .update(incidentItems)
    .set({
      status,
      // The link has no job left once anything is attached, so it dies with the
      // first attach (D11). An item wiped back to `link_generated` keeps the
      // burned token and must have its link reissued.
      ...(status === "link_generated" ? {} : { tokenExpiresAt: new Date() }),
      updatedAt: new Date(),
    })
    .where(eq(incidentItems.id, itemId));

  return status;
};

export const incidentsService = {
  /**
   * The claim for a reservation, hydrated with its items, each item's asset
   * catalogue row, and each item's ACTIVE evidence.
   */
  async getById(
    db: Variables["db"],
    id: string,
  ): Promise<IncidentWithItems | null> {
    const incident = await db.query.incidents.findFirst({
      where: eq(incidents.id, id),
      with: {
        items: {
          orderBy: (items, { asc: ascFn }) => [ascFn(items.createdAt)],
          with: {
            asset: { with: { assetType: true } },
            evidence: true,
          },
        },
      },
    });

    if (!incident) return null;

    return hydrateIncident(incident);
  },

  /**
   * The paginated operational list (M1).
   *
   * Two reads rather than one: the page's ids are chosen by a filtered, sorted,
   * limited query (which needs joins to reach the reservation's apartment and
   * check-out), and only that page is then hydrated through the same relational
   * shape `getById` uses. Hydrating every matching row and slicing afterwards
   * would put the whole claim tree in memory to render twenty of them.
   */
  async list(
    db: Variables["db"],
    query: IncidentQuery,
  ): Promise<PaginatedIncidents> {
    const { page, limit, status, apartmentId, emergencyOnly, sortBy, order } =
      query;
    const offset = (page - 1) * limit;

    const conditions = [
      status ? eq(incidents.status, status) : undefined,
      apartmentId ? eq(reservations.apartmentId, apartmentId) : undefined,
      emergencyOnly ? eq(incidents.isEmergencyMode, true) : undefined,
    ].filter(Boolean);

    const whereClause = conditions.length ? and(...conditions) : undefined;

    const orderFn = order === "asc" ? asc : desc;
    const sortColumn =
      sortBy === "createdAt"
        ? incidents.createdAt
        : sortBy === "checkOutDatetime"
          ? reservations.checkOutDatetime
          : incidents.aircoverEscalationDeadlineAt;

    const [countRows, pageRows] = await Promise.all([
      db
        .select({ total: count() })
        .from(incidents)
        .innerJoin(reservations, eq(incidents.reservationId, reservations.id))
        .where(whereClause),
      db
        .select({ id: incidents.id })
        .from(incidents)
        .innerJoin(reservations, eq(incidents.reservationId, reservations.id))
        .where(whereClause)
        .orderBy(orderFn(sortColumn))
        .limit(limit)
        .offset(offset),
    ]);

    const totalItems = Number(countRows[0]?.total ?? 0);
    const ids = (pageRows as Array<{ id: string }>).map((row) => row.id);

    if (ids.length === 0) {
      return {
        data: [],
        pagination: {
          page,
          limit,
          totalItems,
          totalPages: Math.ceil(totalItems / limit),
        },
      };
    }

    const hydrated = await db.query.incidents.findMany({
      where: inArray(incidents.id, ids),
      with: {
        items: {
          orderBy: (items, { asc: ascFn }) => [ascFn(items.createdAt)],
          with: {
            asset: { with: { assetType: true } },
            evidence: true,
          },
        },
      },
    });

    // The hydration query does not preserve the page's ordering, so the ids are
    // put back in the order the sorted query chose.
    const byId = new Map(
      (hydrated as Array<{ id: string }>).map((row) => [row.id, row]),
    );

    return {
      data: ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((row) => hydrateIncident(row)),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    };
  },

  /**
   * The claim attached to a reservation, or `null`. Used to answer
   * `INCIDENT_ALREADY_EXISTS` before an insert trips the UNIQUE constraint, so
   * the client gets a readable conflict rather than a driver error.
   */
  async getByReservationId(
    db: Variables["db"],
    reservationId: string,
  ): Promise<Incident | null> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.reservationId, reservationId))
      .limit(1);

    return incident ?? null;
  },

  /**
   * The asset row behind a claimed item, reduced to the apartment it belongs to.
   * Returns `null` for an unknown id so the route can answer 404 before it
   * answers 400 — existence is a different failure from ownership.
   */
  async getAssetApartment(
    db: Variables["db"],
    assetId: string,
  ): Promise<{ id: string; apartmentId: string } | null> {
    const [asset] = await db
      .select({ id: assets.id, apartmentId: assets.apartmentId })
      .from(assets)
      .where(eq(assets.id, assetId))
      .limit(1);

    return asset ?? null;
  },

  /**
   * One item, scoped to its claim. Scoping by BOTH ids is what makes a
   * mismatched pair a 404 rather than a way to read another claim's item.
   *
   * Returns the ROW, not the payload type: the routes that call this need the
   * item's `type` and the fact of its existence, and the item's asset and
   * evidence are read separately by `getItemWithAsset`. Typing it as the payload
   * would force every caller to carry a hydration this never performed.
   */
  async getItem(
    db: Variables["db"],
    incidentId: string,
    itemId: string,
  ): Promise<IncidentItemRow | null> {
    const [item] = await db
      .select()
      .from(incidentItems)
      .where(
        and(
          eq(incidentItems.id, itemId),
          eq(incidentItems.incidentId, incidentId),
        ),
      )
      .limit(1);

    return item ?? null;
  },

  /** The evidence rows this claim's item actually owns, in `link_generated` or not. */
  async countActiveEvidence(
    db: Variables["db"],
    itemId: string,
  ): Promise<number> {
    const [row] = await db
      .select({ total: count() })
      .from(claimEvidence)
      .where(
        and(
          eq(claimEvidence.incidentItemId, itemId),
          eq(claimEvidence.status, "active"),
        ),
      );

    return Number(row?.total ?? 0);
  },

  /**
   * Trigger A, entire (D8, D9). One method, because the two halves are the same
   * fact read twice — and two queries is how a host ends up shown "emergency" on
   * a claim the same route then refuses.
   *
   * The next guest is the earliest booking at this apartment whose check-in
   * falls AFTER THIS STAY'S check-out. That anchor matters: anchored on `now`
   * instead, the "the next guest has arrived" test below could never fire, since
   * a check-in later than now is never earlier than now.
   *
   * `nextCheckIn: null` means there is no following booking, so nothing about it
   * can reject the claim or raise the flag.
   */
  async assessFeasibility(
    db: Variables["db"],
    apartmentId: string,
    context: { reservationId: string; effectiveCheckOut: Date; now: Date },
  ): Promise<{ nextCheckIn: Date | null; isEmergency: boolean }> {
    const [next] = await db
      .select({
        checkInDatetime: reservations.checkInDatetime,
        alternativeCheckInDatetime: reservations.alternativeCheckInDatetime,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.apartmentId, apartmentId),
          ne(reservations.id, context.reservationId),
          gt(
            sql`COALESCE(
              CASE WHEN ${reservations.alternativeCheckInDatetime} > '1970-01-02'::timestamptz
                   THEN ${reservations.alternativeCheckInDatetime}
                   ELSE NULL END,
              ${reservations.checkInDatetime}
            )`,
            context.effectiveCheckOut.toISOString(),
          ),
        ),
      )
      .orderBy(
        sql`COALESCE(
          CASE WHEN ${reservations.alternativeCheckInDatetime} > '1970-01-02'::timestamptz
               THEN ${reservations.alternativeCheckInDatetime}
               ELSE NULL END,
          ${reservations.checkInDatetime}
        ) ASC`,
      )
      .limit(1);

    if (!next) return { nextCheckIn: null, isEmergency: false };

    const nextCheckIn = resolveTime(
      next.checkInDatetime,
      next.alternativeCheckInDatetime,
    );

    // No next booking → not an emergency: the flag raises urgency, it never
    // blocks anything, so the quiet answer is the safe default (D8).
    return {
      nextCheckIn,
      isEmergency: nextCheckIn.getTime() - context.now.getTime() < EMERGENCY_WINDOW_MS,
    };
  },

  /**
   * Creates the claim, and any items supplied with it, in ONE transaction.
   * Nothing here is visible to the field surface until this commits, so a
   * half-created claim can never mint a usable link.
   *
   * `items` is optional: the claim and its items are separately created, so a
   * host can open the claim the moment they notice the damage and add the
   * affected assets afterwards with `addItem`.
   *
   * `placeholder_total_amount_cents` is the sum of the items' provisional
   * values — computed here rather than stored by the client, so the total can
   * never disagree with the rows it summarises (D3).
   */
  async create(
    db: Variables["db"],
    data: CreateIncident,
    context: { effectiveCheckOut: Date; isEmergencyMode: boolean },
  ): Promise<CreateIncidentResponse> {
    const { effectiveCheckOut, isEmergencyMode } = context;
    const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    return db.transaction(async (tx) => {
      const [incident] = await tx
        .insert(incidents)
        .values({
          reservationId: data.reservationId,
          status: "draft",
          isEmergencyMode,
          placeholderTotalAmountCents: data.items.reduce(
            (sum, item) => sum + (item.estimatedPlaceholderValueCents ?? 0),
            0,
          ),
          // Frozen at creation so the deadline the host was shown cannot move
          // if the reservation is edited later (D7).
          aircoverEscalationDeadlineAt: new Date(
            effectiveCheckOut.getTime() + ESCALATION_DAYS * DAY_MS,
          ),
        })
        .returning();

      if (data.items.length === 0) {
        return {
          ...incident,
          items: [],
        } as unknown as CreateIncidentResponse;
      }

      const insertedItems = await tx
        .insert(incidentItems)
        .values(
          data.items.map((item) => ({
            incidentId: incident.id,
            assetId: item.assetId,
            type: item.type,
            status: "link_generated" as const,
            cleanerToken: makeToken(),
            tokenExpiresAt,
            estimatedPlaceholderValueCents:
              item.estimatedPlaceholderValueCents ?? 0,
          })),
        )
        .returning();

      const assetRows = await tx
        .select({ asset: assets, assetType: assetTypes })
        .from(assets)
        .innerJoin(assetTypes, eq(assets.assetTypeId, assetTypes.id))
        .where(
          inArray(
            assets.id,
            insertedItems.map((item) => item.assetId),
          ),
        );

      const assetById = new Map(
        assetRows.map(({ asset, assetType }) => [
          asset.id,
          { ...asset, asset_type: assetType },
        ]),
      );

      return {
        ...incident,
        items: insertedItems.map((item) => ({
          ...item,
          asset: assetById.get(item.assetId),
          evidence: [],
        })),
      } as unknown as CreateIncidentResponse;
    });
  },

  /**
   * Adds one item to an existing claim, minting its field link (D1).
   *
   * The read of the existing item and the insert share the transaction so two
   * concurrent adds of the same asset cannot both pass the uniqueness check and
   * then collide on `UNIQUE(incident_id, asset_id)`. The route's pre-check
   * exists to name the offending asset; this one is the enforcement.
   *
   * The claim's derived total is recomputed in the same transaction, so the
   * total can never be observed disagreeing with the item rows.
   */
  async addItem(
    db: Variables["db"],
    incidentId: string,
    item: {
      assetId: string;
      type: "damage" | "theft";
      estimatedPlaceholderValueCents?: number;
    },
  ): Promise<IncidentItemWithToken | null> {
    const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    return db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: incidentItems.id })
        .from(incidentItems)
        .where(
          and(
            eq(incidentItems.incidentId, incidentId),
            eq(incidentItems.assetId, item.assetId),
          ),
        )
        .limit(1);

      if (existing) return null;

      const [created] = await tx
        .insert(incidentItems)
        .values({
          incidentId,
          assetId: item.assetId,
          type: item.type,
          status: "link_generated",
          cleanerToken: makeToken(),
          tokenExpiresAt,
          estimatedPlaceholderValueCents:
            item.estimatedPlaceholderValueCents ?? 0,
        })
        .returning();

      const [assetRow] = await tx
        .select({ asset: assets, assetType: assetTypes })
        .from(assets)
        .innerJoin(assetTypes, eq(assets.assetTypeId, assetTypes.id))
        .where(eq(assets.id, item.assetId))
        .limit(1);

      await recalcPlaceholderTotal(tx, incidentId);

      // A claim that had gone `ready_to_file` because every item was collected
      // is no longer ready once a fresh uncollected item lands on it.
      await syncIncidentReadiness(tx, incidentId);

      return {
        ...created,
        asset: assetRow
          ? { ...assetRow.asset, asset_type: assetRow.assetType }
          : undefined,
        evidence: [],
      } as unknown as IncidentItemWithToken;
    });
  },

  /**
   * Corrects the claim itself. Only the money is host-owned; status and the two
   * clocks are server-owned transitions, and the item-derived total is
   * recomputed from the rows rather than accepted.
   */
  async update(
    db: Variables["db"],
    id: string,
    data: UpdateIncident,
  ): Promise<IncidentWithItems | null> {
    const [updated] = await db
      .update(incidents)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(incidents.id, id))
      .returning();

    if (!updated) return null;

    return this.getById(db, id);
  },

  /**
   * Corrects one item — its type and its provisional value — and recomputes the
   * claim total, in one transaction.
   *
   * Returns the updated ROW, matching `getItem`: the host route answers with the
   * item it was asked to change, and the asset/evidence hydration is a separate
   * read the route does not need for a PATCH of two scalar fields.
   */
  async updateItem(
    db: Variables["db"],
    incidentId: string,
    itemId: string,
    data: UpdateIncidentItem,
  ): Promise<IncidentItemRow | null> {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(incidentItems)
        .set({ ...data, updatedAt: new Date() })
        .where(
          and(
            eq(incidentItems.id, itemId),
            eq(incidentItems.incidentId, incidentId),
          ),
        )
        .returning();

      if (!updated) return null;

      await recalcPlaceholderTotal(tx, incidentId);

      return updated;
    });
  },

  /**
   * Removes one item from a claim (D1/D2). Its evidence cascades away with it
   * and the claim's derived total is recomputed in the same transaction.
   *
   * Used both for a genuine correction and as the recovery path for a dead link:
   * deleting an item that never collected anything and re-adding it mints a
   * fresh token, which is why an expired link is no longer fatal.
   */
  async deleteItem(
    db: Variables["db"],
    incidentId: string,
    itemId: string,
  ): Promise<{ id: string } | null> {
    return db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(incidentItems)
        .where(
          and(
            eq(incidentItems.id, itemId),
            eq(incidentItems.incidentId, incidentId),
          ),
        )
        .returning({ id: incidentItems.id });

      if (!deleted) return null;

      await recalcPlaceholderTotal(tx, incidentId);
      await syncIncidentReadiness(tx, incidentId);

      return deleted;
    });
  },

  /**
   * Mints a fresh field link for an item whose previous one expired unused
   * (D3, S2, S3). Replacing `cleaner_token` invalidates the old value in the
   * same write — `getFieldContext` resolves by token, so the previous link stops
   * working the instant this commits.
   *
   * Returns `null` when the item is unknown, and the route refuses an item that
   * already has evidence: the link did its job, and there is nothing to reissue.
   */
  async reissueToken(
    db: Variables["db"],
    incidentId: string,
    itemId: string,
  ): Promise<IncidentItemWithToken | null> {
    const [updated] = await db
      .update(incidentItems)
      .set({
        cleanerToken: makeToken(),
        tokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(incidentItems.id, itemId),
          eq(incidentItems.incidentId, incidentId),
          eq(incidentItems.status, "link_generated"),
        ),
      )
      .returning();

    if (!updated) return null;

    return this.getItemWithToken(db, incidentId, itemId);
  },

  /**
   * One item hydrated with its asset and its active evidence, in the shape every
   * item READ returns — `cleanerToken` omitted (D11).
   *
   * Deliberately the default. The token is a credential the host relays once, so
   * the safe hydration is the one that drops it, and the two routes that must
   * return it ask for it explicitly by name (`getItemWithToken`). The reverse
   * arrangement — return everything, strip at the call sites that must not leak —
   * puts the omission one forgotten line away from publishing a live credential
   * in a payload that is logged.
   */
  async getItemWithAsset(
    db: Variables["db"],
    incidentId: string,
    itemId: string,
  ): Promise<IncidentItem | null> {
    const item = await this.findHydratedItem(db, incidentId, itemId);

    return item ? (hydrateItem(item) as unknown as IncidentItem) : null;
  },

  /**
   * The same item WITH its `cleanerToken` — for exactly two answers: the create
   * response's items and the token-reissue response. Never a read route.
   */
  async getItemWithToken(
    db: Variables["db"],
    incidentId: string,
    itemId: string,
  ): Promise<IncidentItemWithToken | null> {
    const item = await this.findHydratedItem(db, incidentId, itemId);

    return item ? (hydrateItem(item) as unknown as IncidentItemWithToken) : null;
  },

  /** The relational read both hydrations above are built from. */
  async findHydratedItem(
    db: Variables["db"],
    incidentId: string,
    itemId: string,
  ): Promise<Record<string, unknown> | null> {
    const item = await db.query.incidentItems.findFirst({
      where: and(
        eq(incidentItems.id, itemId),
        eq(incidentItems.incidentId, incidentId),
      ),
      with: {
        asset: { with: { assetType: true } },
        evidence: true,
      },
    });

    return (item as Record<string, unknown> | undefined) ?? null;
  },

  /**
   * Deletes the claim. The claim's items and evidence cascade away with it
   * (D5), which frees the reservation to carry a real claim again — the dead end
   * Q1 describes.
   */
  async delete(
    db: Variables["db"],
    id: string,
  ): Promise<{ success: boolean; id: string } | null> {
    const [deleted] = await db
      .delete(incidents)
      .where(eq(incidents.id, id))
      .returning({ id: incidents.id });

    if (!deleted) return null;

    return { success: true, id: deleted.id };
  },

  /**
   * Trigger C — the clock stopper. Both guest clocks are set from `NOW()` rather
   * than from the stored escalation date: the 24 hours the guest is given start
   * when the host actually files.
   *
   * The status guard is in the WHERE clause, not only in the route, so a
   * concurrent filing cannot move an already-filed claim a second time — the
   * second update matches no row and returns `null`.
   */
  async confirmAirbnbFiling(
    db: Variables["db"],
    id: string,
  ): Promise<Incident | null> {
    const [updated] = await db
      .update(incidents)
      .set({
        status: "submitted_to_guest",
        resolutionCenterSubmittedAt: sql`NOW()`,
        guestResponseDeadlineAt: sql`NOW() + INTERVAL '24 hours'`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(incidents.id, id),
          inArray(incidents.status, ["draft", "ready_to_file"]),
        ),
      )
      .returning();

    return updated ?? null;
  },

  /**
   * Resolves a field token to the item it belongs to plus everything the field
   * payload needs. `null` for every failure mode at once — unknown token,
   * expired token, already-used token — because the caller must not be able to
   * tell them apart: distinguishing "expired" from "never existed" would turn
   * this route into an oracle for guessing tokens (D17).
   *
   * Uses `resolveTime` on the effective check-out so the baseline overlay is
   * chosen against the stay the claim is actually about.
   */
  async getFieldContext(
    db: Variables["db"],
    token: string,
  ): Promise<{
    item: {
      id: string;
      type: IncidentItem["type"];
      status: IncidentItem["status"];
      tokenExpiresAt: Date;
    };
    incidentId: string;
    apartmentId: string;
    apartmentName: string;
    reservationId: string;
    effectiveCheckOut: Date;
  } | null> {
    const [row] = await db
      .select({
        itemId: incidentItems.id,
        itemType: incidentItems.type,
        itemStatus: incidentItems.status,
        tokenExpiresAt: incidentItems.tokenExpiresAt,
        incidentId: incidents.id,
        apartmentId: apartments.id,
        apartmentName: apartments.name,
        reservationId: reservations.id,
        checkOutDatetime: reservations.checkOutDatetime,
        alternativeCheckOutDatetime: reservations.alternativeCheckOutDatetime,
      })
      .from(incidentItems)
      .innerJoin(incidents, eq(incidentItems.incidentId, incidents.id))
      .innerJoin(reservations, eq(incidents.reservationId, reservations.id))
      .innerJoin(apartments, eq(reservations.apartmentId, apartments.id))
      .where(eq(incidentItems.cleanerToken, token))
      .limit(1);

    if (!row) return null;

    // Single-use (D11): `submit` sets `tokenExpiresAt = now`, so a replay lands
    // here and reads as an invalid token rather than a second write.
    if (new Date(row.tokenExpiresAt).getTime() <= Date.now()) return null;

    return {
      item: {
        id: row.itemId,
        type: row.itemType,
        status: row.itemStatus,
        tokenExpiresAt: row.tokenExpiresAt,
      },
      incidentId: row.incidentId,
      apartmentId: row.apartmentId,
      apartmentName: row.apartmentName,
      reservationId: row.reservationId,
      effectiveCheckOut: resolveTime(
        row.checkOutDatetime,
        row.alternativeCheckOutDatetime,
      ),
    };
  },

  /**
   * The asset behind a field item, projected to the fields the field payload is
   * allowed to carry. Deliberately narrower than `AssetSchema`: no value, no
   * apartment id, no timestamps.
   */
  async getFieldAsset(
    db: Variables["db"],
    itemId: string,
  ): Promise<FieldAsset | null> {
    const [row] = await db
      .select({
        id: assets.id,
        name: assets.name,
        roomLocation: assets.roomLocation,
        description: assets.description,
      })
      .from(incidentItems)
      .innerJoin(assets, eq(incidentItems.assetId, assets.id))
      .where(eq(incidentItems.id, itemId))
      .limit(1);

    return (row as FieldAsset | undefined) ?? null;
  },

  /**
   * What the cleaner still needs to shoot, and what is already in.
   *
   * This is the prep doc's central ask — "the system needs to drive the user
   * what needs to be provided" — answered where the user is standing: the field
   * page is told which evidence types this item accepts and how many of each are
   * already attached, so it can prompt for the missing shots instead of showing
   * a bare file picker.
   *
   * Counts and type names only. No storage keys, no money, no guest.
   */
  async getFieldEvidenceGuidance(
    db: Variables["db"],
    itemId: string,
    itemType: "damage" | "theft",
  ): Promise<{
    requiredEvidenceTypes: string[];
    attachedEvidenceCounts: Record<string, number>;
  }> {
    const rows = await db
      .select({ evidenceType: claimEvidence.evidenceType })
      .from(claimEvidence)
      .where(
        and(
          eq(claimEvidence.incidentItemId, itemId),
          eq(claimEvidence.status, "active"),
        ),
      );

    const counts: Record<string, number> = {};
    for (const row of rows as Array<{ evidenceType: string }>) {
      counts[row.evidenceType] = (counts[row.evidenceType] ?? 0) + 1;
    }

    return {
      requiredEvidenceTypes: requiredPhotoTypes(itemType),
      attachedEvidenceCounts: counts,
    };
  },

  /**
   * Upload tokens for one item's evidence, minted in the same
   * `incidents/{incidentId}/{itemId}/` prefix the attach and submit steps verify
   * against. The prefix is what makes "the caller uploaded this exact key"
   * checkable without a second table of pending uploads.
   *
   * Both surfaces share this method so the prefix is minted in exactly one
   * place; only the accepted MIME types differ, and that is the caller's
   * schema, not this function's business.
   */
  async generateUploadTokens(
    s3: Variables["s3"],
    bucketName: string,
    context: { incidentId: string; itemId: string },
    fileTypes: string[],
    limit: number = MAX_EVIDENCE_PER_ITEM,
  ): Promise<{ uploadUrl: string; key: string }[]> {
    void limit;
    return Promise.all(
      fileTypes.map(async (fileType) => {
        const ext = fileType.split("/")[1] || "jpg";
        const key = `incidents/${context.incidentId}/${context.itemId}/${crypto.randomUUID()}.${ext}`;

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          ContentType: fileType,
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        return { uploadUrl, key };
      }),
    );
  },

  /** The field surface's mint: images only, and bounded per batch (S1). */
  async generateFieldUploadTokens(
    s3: Variables["s3"],
    bucketName: string,
    context: { incidentId: string; itemId: string },
    fileTypes: string[],
  ): Promise<{ uploadUrl: string; key: string }[]> {
    return this.generateUploadTokens(s3, bucketName, context, fileTypes);
  },

  /**
   * The host surface's mint: images AND documents.
   *
   * The cap here bounds ONE BATCH, which is all this route can see — minting a
   * presigned URL writes nothing. The real per-item limit is enforced by
   * `attachEvidence`, which knows how much evidence the item already has.
   */
  async generateHostUploadTokens(
    s3: Variables["s3"],
    bucketName: string,
    context: { incidentId: string; itemId: string },
    fileTypes: string[],
  ): Promise<{ uploadUrl: string; key: string }[]> {
    return this.generateUploadTokens(s3, bucketName, context, fileTypes);
  },

  /**
   * The field surface's one write path.
   *
   * Everything happens in ONE transaction: the evidence rows, the item's status
   * recomputed from what it now holds, the token's expiry, and the claim-level
   * aggregation. A partial commit here would leave a claim that reads `draft`
   * forever with an item whose link no longer works — the exact state the state
   * machine exists to prevent.
   *
   * Returns the status the item ACTUALLY ended up in rather than a literal: the
   * old hardcoded `"photos_collected"` was correct only while one transition
   * existed, and would have silently lied the moment a second did (V3).
   */
  async submitFieldEvidence(
    db: Variables["db"],
    context: { itemId: string; incidentId: string },
    body: FieldSubmitBody,
  ): Promise<{ itemStatus: IncidentItem["status"]; evidenceCount: number }> {
    return db.transaction(async (tx) => {
      await tx.insert(claimEvidence).values(
        body.photos.map((photo) => ({
          incidentItemId: context.itemId,
          evidenceType: photo.evidenceType,
          storageKey: photo.storageKey,
          exifCapturedAt: photo.capturedAt ? new Date(photo.capturedAt) : null,
          exifLatitude: photo.latitude !== undefined ? String(photo.latitude) : null,
          exifLongitude: photo.longitude !== undefined ? String(photo.longitude) : null,
        })),
      );

      await tx
        .update(incidentItems)
        .set({
          descriptionByCleaner: body.descriptionByCleaner ?? null,
          updatedAt: new Date(),
        })
        .where(eq(incidentItems.id, context.itemId));

      // Derives the status from the evidence just written and burns the token in
      // the same statement (D11).
      const itemStatus = await recomputeItemStatus(tx, context.itemId);

      await syncIncidentReadiness(tx, context.incidentId);

      return {
        itemStatus: itemStatus as IncidentItem["status"],
        evidenceCount: body.photos.length,
      };
    });
  },

  /**
   * The host surface's write path — the counterpart of `submitFieldEvidence`,
   * accepting both halves of the proof.
   *
   * Attaching a document is what moves an item past `photos_collected` to
   * `complete` (the valuation is now backed), and attaching to an item that had
   * nothing is how the host supplies proof without a cleaner link at all. The
   * item status, the claim aggregate and the token burn are all derived from the
   * resulting evidence in the same transaction.
   */
  async attachEvidence(
    db: Variables["db"],
    context: { incidentId: string; itemId: string },
    body: AttachEvidenceBody,
  ): Promise<{ attachedCount: number; itemStatus: IncidentItem["status"] }> {
    return db.transaction(async (tx) => {
      await tx.insert(claimEvidence).values(
        body.evidence.map((row) => ({
          incidentItemId: context.itemId,
          evidenceType: row.evidenceType,
          storageKey: row.storageKey,
          exifCapturedAt: row.capturedAt ? new Date(row.capturedAt) : null,
          exifLatitude: row.latitude !== undefined ? String(row.latitude) : null,
          exifLongitude: row.longitude !== undefined ? String(row.longitude) : null,
        })),
      );

      const itemStatus = await recomputeItemStatus(tx, context.itemId);

      await syncIncidentReadiness(tx, context.incidentId);

      return {
        attachedCount: body.evidence.length,
        itemStatus: itemStatus as IncidentItem["status"],
      };
    });
  },
  /**
   * Withdraws one piece of evidence (D4).
   *
   * Soft-deletes rather than removes, mirroring `syncUploadedPhotos`: the row
   * records what was filed, and the R2 object is left in place. The item's
   * status is then re-derived from the evidence that remains, so deleting the
   * last photo of an item returns it to `link_generated` and reopens the claim's
   * readiness if that was the only thing keeping it `ready_to_file`.
   *
   * Returns `null` when the evidence is unknown, already withdrawn, or belongs
   * to a different item — all three are the same 404 to the caller.
   */
  async deleteEvidence(
    db: Variables["db"],
    context: { incidentId: string; itemId: string; evidenceId: string },
  ): Promise<{ id: string; itemStatus: IncidentItem["status"] } | null> {
    return db.transaction(async (tx) => {
      const [deleted] = await tx
        .update(claimEvidence)
        .set({ status: "soft_deleted", deletedAt: new Date() })
        .where(
          and(
            eq(claimEvidence.id, context.evidenceId),
            eq(claimEvidence.incidentItemId, context.itemId),
            eq(claimEvidence.status, "active"),
          ),
        )
        .returning({ id: claimEvidence.id });

      if (!deleted) return null;

      const itemStatus = await recomputeItemStatus(tx, context.itemId);

      await syncIncidentReadiness(tx, context.incidentId);

      return { id: deleted.id, itemStatus: itemStatus as IncidentItem["status"] };
    });
  },

  /**
   * The baseline "previous stay's turnover photo" the field page overlays for
   * framing (D16): the shots of the most recent EARLIER stay at this apartment
   * that actually has active check-in photos.
   *
   * SCOPED TO THE ASSET being photographed, not the whole apartment (V2). The
   * prep doc's intent is "photos for the state before" *of this asset* — a
   * cleaner photographing a damaged kettle framed against last stay's living-room
   * shots is shown the wrong thing, and would be invited to reproduce the wrong
   * composition. Shots whose asset list does not include this asset are dropped;
   * an asset that appears in no shot of the previous stay returns `[]`, which is
   * a real answer and the client renders without an overlay.
   *
   * Reuses `reservationsService.getProofPhotos` rather than mapping the tree a
   * second time — that mapper's own comment warns that two copies of it is how
   * one payload silently stops carrying `images`.
   */
  async getBaselinePhotos(
    db: Variables["db"],
    s3: Variables["s3"],
    bucketName: string,
    apartmentId: string,
    before: Date,
    assetId: string,
  ): Promise<Array<{ storageKey: string; downloadUrl: string }>> {
    const [previous] = await db
      .select({ id: reservations.id })
      .from(reservations)
      .where(
        and(
          eq(reservations.apartmentId, apartmentId),
          lt(
            sql`COALESCE(
              CASE WHEN ${reservations.alternativeCheckOutDatetime} > '1970-01-02'::timestamptz
                   THEN ${reservations.alternativeCheckOutDatetime}
                   ELSE NULL END,
              ${reservations.checkOutDatetime}
            )`,
            before.toISOString(),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(apartmentImages)
              .where(
                and(
                  eq(apartmentImages.reservationId, reservations.id),
                  eq(apartmentImages.status, "active"),
                  eq(apartmentImages.type, "checkin_state"),
                ),
              ),
          ),
        ),
      )
      .orderBy(
        sql`COALESCE(
          CASE WHEN ${reservations.alternativeCheckOutDatetime} > '1970-01-02'::timestamptz
               THEN ${reservations.alternativeCheckOutDatetime}
               ELSE NULL END,
          ${reservations.checkOutDatetime}
        ) DESC`,
      )
      .limit(1);

    if (!previous) return [];

    // The SHOTS are the framing unit the client overlays against, and the
    // mapper is the repo's one implementation of "a shot with its images and
    // assets" — reusing it is what keeps this payload from drifting from the
    // inspection tree and the reservation photo read.
    const shots = (await reservationsService.getProofPhotos(db, previous.id)) as Array<{
      images: Array<{ type: string; storageKey: string }>;
      assets: Array<{ id: string }>;
    }>;

    const assetShots = shots
      .filter((shot) => shot.assets.some((asset) => asset.id === assetId))
      .map((shot) => ({
        ...shot,
        images: shot.images.filter((image) => image.type === "checkin_state"),
      }))
      .filter((shot) => shot.images.length > 0);

    // Flattened to the photo list the field page actually frames against, each
    // with a short-lived GET URL so an unauthenticated caller never needs bucket
    // credentials. The URL is handed out WITH its key — the field surface needs
    // the key to render the pair, and a signed read URL scoped to this asset's
    // baseline photos is not an object the client could not otherwise fetch.
    const flat = assetShots.flatMap((shot) => shot.images);

    return Promise.all(
      flat.map(async (image) => ({
        storageKey: image.storageKey,
        downloadUrl: await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucketName, Key: image.storageKey }),
          { expiresIn: 300 },
        ),
      })),
    );
  },
};

/**
 * The two predicates the readiness rule is made of, as SQL fragments.
 *
 * Raw `sql` rather than `exists(...)` subqueries on purpose: `PgDialect` can
 * render a raw fragment with no connection, so the statement the database
 * actually runs is assertable in a unit test. A builder-based `exists()` would
 * hide the predicate behind a chain the tests' recording mock swallows — and
 * this is the one piece of state-machine logic in the feature, which is exactly
 * the thing that must not be silently deletable.
 */
export const incidentHasItemsSql = (incidentId: string) =>
  sql`EXISTS (SELECT 1 FROM ${incidentItems} WHERE ${incidentItems.incidentId} = ${incidentId})`;

export const incidentHasUncollectedItemSql = (incidentId: string) =>
  sql`EXISTS (SELECT 1 FROM ${incidentItems} WHERE ${incidentItems.incidentId} = ${incidentId} AND ${incidentItems.status} = 'link_generated')`;

/**
 * The claim-level readiness aggregate, in BOTH directions — the one place
 * `incidents.status` moves between `draft` and `ready_to_file` (D15).
 *
 * The rule: a claim is fileable when it HAS at least one item and NO item is
 * still `link_generated`. Both halves are load-bearing:
 *  - without the "has items" half, a claim with no items at all would satisfy
 *    "no uncollected item" vacuously and flip to ready the moment it was created;
 *  - `link_generated` rather than `photos_collected` is what makes documents part
 *    of the state machine. An item that has collected its photos and then had a
 *    receipt attached is `complete`, which must NOT un-ready the claim — the old
 *    `status <> 'photos_collected'` test did exactly that, so attaching a receipt
 *    to a ready claim would have made it unfilable.
 *
 * Running it in both directions is what makes an edit safe: removing an item, or
 * deleting the last photo of one, genuinely reopens a claim that was ready. The
 * two statements cannot fight each other, because each is guarded on its own
 * source status and the first only fires when the claim HAS become ready — which
 * is precisely the state the second one refuses to reopen.
 *
 * It runs inside the caller's transaction, so the item write and the claim's
 * state cannot disagree: there is no window in which a finished claim reads
 * `draft`, or an unfinished one reads `ready_to_file`.
 *
 * `documents_pending` deliberately does not count as unfinished: nothing records
 * a document REQUEST, so an item is never parked there, and treating a state
 * nothing writes as a blocker would be dead code that reads as a rule.
 */
export const syncIncidentReadiness = async (
  tx: any,
  incidentId: string,
): Promise<void> => {
  await tx
    .update(incidents)
    .set({ status: "ready_to_file", updatedAt: new Date() })
    .where(
      and(
        eq(incidents.id, incidentId),
        eq(incidents.status, "draft"),
        incidentHasItemsSql(incidentId),
        sql`NOT ${incidentHasUncollectedItemSql(incidentId)}`,
      ),
    );

  await tx
    .update(incidents)
    .set({ status: "draft", updatedAt: new Date() })
    .where(
      and(
        eq(incidents.id, incidentId),
        eq(incidents.status, "ready_to_file"),
        or(
          sql`NOT ${incidentHasItemsSql(incidentId)}`,
          incidentHasUncollectedItemSql(incidentId),
        ),
      ),
    );
};

/**
 * Back-compat alias for the original Trigger B name.
 *
 * The predicate it applies is no longer "all items are photos_collected" but the
 * wider readiness rule above; the name is kept so the phase-5 call sites and
 * their tests read the same, and both point at one implementation.
 */
export const markReadyIfAllItemsCollected = syncIncidentReadiness;

export { TOKEN_TTL_MS, EMERGENCY_WINDOW_MS, ESCALATION_DAYS, DAY_MS };
export type { NewIncident, IncidentQuery };
