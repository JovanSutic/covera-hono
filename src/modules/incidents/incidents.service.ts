import { and, eq, exists, gt, inArray, lt, ne, notExists, sql } from "drizzle-orm";
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
  Incident,
  NewIncident,
} from "@/db";
import { Variables } from "@/types";
import { reservationsService } from "../reservations/reservations.service";
import type {
  CreateIncident,
  IncidentWithItems,
  IncidentItem,
  FieldAsset,
  CreateIncidentResponse,
  FieldSubmitBody,
} from "./incidents.schema";

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const ESCALATION_DAYS = 30;
const EMERGENCY_WINDOW_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

export const incidentsService = {
  /**
   * The claim for a reservation, hydrated with its items, each item's asset
   * catalogue row, and each item's evidence.
   */
  async getById(
    db: Variables["db"],
    id: string,
  ): Promise<IncidentWithItems | null> {
    const incident = await db.query.incidents.findFirst({
      where: eq(incidents.id, id),
      with: {
        items: {
          orderBy: (items, { asc }) => [asc(items.createdAt)],
          with: {
            asset: { with: { assetType: true } },
            evidence: true,
          },
        },
      },
    });

    if (!incident) return null;

    const { items = [], ...rest } = incident as typeof incident & {
      items?: Array<Record<string, any>>;
    };

    return {
      ...rest,
      items: items.map(({ asset, ...item }) => ({
        ...item,
        asset: { ...asset, asset_type: asset.assetType },
        evidence: item.evidence ?? [],
      })),
    } as unknown as IncidentWithItems;
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
   * Creates the claim, its items and each item's field token in ONE
   * transaction. Nothing here is visible to the field surface until this
   * commits, so a half-created claim can never mint a usable link.
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
   * Upload tokens for one item's evidence, minted in the same
   * `incidents/{incidentId}/{itemId}/` prefix the submit step verifies against.
   * The prefix is what makes "the cleaner uploaded this exact key" checkable
   * without a second table of pending uploads.
   */
  async generateFieldUploadTokens(
    s3: Variables["s3"],
    bucketName: string,
    context: { incidentId: string; itemId: string },
    fileTypes: string[],
  ): Promise<{ uploadUrl: string; key: string }[]> {
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

  /**
   * The one write path on the field surface, and the only place Trigger B runs.
   *
   * Everything happens in ONE transaction: the evidence rows, the item's move to
   * `photos_collected`, the token's expiry, and the claim-level aggregation. A
   * partial commit here would leave a claim that reads `draft` forever with an
   * item whose link no longer works — the exact state the state machine exists
   * to prevent.
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
          status: "photos_collected",
          descriptionByCleaner: body.descriptionByCleaner ?? null,
          // Single-use: burning the token here is what makes a replay a 404
          // rather than a second write (D11).
          tokenExpiresAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(incidentItems.id, context.itemId));

      // Trigger B, inside the same transaction (D15).
      await markReadyIfAllItemsCollected(tx, context.incidentId);

      return { itemStatus: "photos_collected", evidenceCount: body.photos.length };
    });
  },

  /**
   * The baseline "previous stay's turnover photo" the field page overlays for
   * framing (D16): the shots of the most recent EARLIER stay at this apartment
   * that actually has active check-in photos.
   *
   * Reuses `reservationsService.getProofPhotos` rather than mapping the tree a
   * second time — that mapper's own comment warns that two copies of it is how
   * one payload silently stops carrying `images`. `[]` is a real answer (this is
   * the apartment's first stay) and the client renders without an overlay.
   */
  async getBaselinePhotos(
    db: Variables["db"],
    s3: Variables["s3"],
    bucketName: string,
    apartmentId: string,
    before: Date,
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
    }>;

    const checkinShots = shots
      .map((shot) => ({
        ...shot,
        images: shot.images.filter((image) => image.type === "checkin_state"),
      }))
      .filter((shot) => shot.images.length > 0);

    // Flattened to the photo list the field page actually frames against, each
    // with a short-lived GET URL so an unauthenticated caller never needs bucket
    // credentials. Keys are only ever handed out alongside the URL that reads
    // them, so the field surface exposes no object the client cannot fetch.
    const flat = checkinShots.flatMap((shot) => shot.images);

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
 * Trigger B — the ONLY place `ready_to_file` is written (D15).
 *
 * `AND status = 'draft'` makes it idempotent and stops a second submit from
 * resurrecting an already-filed claim; `NOT EXISTS` is what makes it an
 * aggregate over the siblings rather than a per-item flag. It runs inside the
 * caller's transaction, so the item write and the claim's state cannot disagree:
 * there is no window in which a finished claim still reads `draft`.
 */
export const markReadyIfAllItemsCollected = async (
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
        notExists(
          tx
            .select({ one: sql`1` })
            .from(incidentItems)
            .where(
              and(
                eq(incidentItems.incidentId, incidentId),
                ne(incidentItems.status, "photos_collected"),
              ),
            ),
        ),
      ),
    );
};

export { TOKEN_TTL_MS, EMERGENCY_WINDOW_MS, ESCALATION_DAYS, DAY_MS };
export type { NewIncident };
