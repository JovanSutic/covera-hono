import { createModuleApp } from "@/core/utils/module-app";
import {
  addIncidentItemRoute,
  attachEvidenceRoute,
  confirmAirbnbFilingRoute,
  createIncidentRoute,
  deleteEvidenceRoute,
  deleteIncidentItemRoute,
  deleteIncidentRoute,
  getIncidentRoute,
  listIncidentsRoute,
  reissueItemTokenRoute,
  requestEvidenceUploadTokensRoute,
  updateIncidentItemRoute,
  updateIncidentRoute,
} from "./incidents.contract";
import {
  incidentsService,
  isClaimEditable,
  allowedEvidenceTypes,
  MAX_EVIDENCE_PER_ITEM,
  type IncidentQuery,
} from "./incidents.service";
import { incidentErrors } from "./incidents.errors";
import { reservationsService } from "../reservations/reservations.service";
import { assertApartmentOwnership } from "@/core/utils/db-validator";
import { DOCUMENT_EVIDENCE_TYPES } from "@/db";

const app = createModuleApp();

const FILE_WINDOW_DAYS = 14;

/** `alternative ?? primary`, with the epoch guard the repo uses everywhere. */
const effectiveTime = (
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
 * Resolves one claim and asserts the caller may read it — the shared front half
 * of every id-scoped route. Extracted rather than duplicated because they must
 * fail identically: a divergence here would make the filing route answer 403
 * where the read answers 404, and the client cannot tell those apart.
 *
 * Ownership is asserted through the reservation's apartment rather than by
 * `apartmentGuard`, which resolves an unknown id through the apartments table
 * first and would report APARTMENT_NOT_FOUND for a claim that does not exist
 * (D21, mirroring reservations.route.ts D5).
 */
async function resolveOwnedIncident(c: any, id: string) {
  const db = c.get("db");
  const user = c.get("user");

  if (!user) {
    throw incidentErrors.unauthenticated();
  }

  const incident = await incidentsService.getById(db, id);

  if (!incident) {
    throw incidentErrors.notFound({ id });
  }

  const reservation = await reservationsService.getById(db, incident.reservationId);

  if (!reservation) {
    throw incidentErrors.notFound({ id });
  }

  await assertApartmentOwnership(db, reservation.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  return { db, incident };
}

/**
 * The mutation gate: resolve, then refuse anything on a filed claim.
 *
 * Without this a host could re-value an item, attach a receipt or delete the
 * claim itself after the guest had already been shown it — the claim's contents
 * would move under the person reviewing them (D2).
 */
async function resolveEditableIncident(c: any, id: string) {
  const resolved = await resolveOwnedIncident(c, id);

  if (!isClaimEditable(resolved.incident.status)) {
    throw incidentErrors.notEditable({ status: resolved.incident.status });
  }

  return resolved;
}

/**
 * Resolves one item inside an editable claim — the shared front half of every
 * item-scoped and evidence-scoped route.
 *
 * The item is looked up by `(incidentId, itemId)` together, so an item id from
 * another claim is a 404 rather than a way to reach across claims.
 */
async function requireItem(c: any, incidentId: string, itemId: string) {
  const { db, incident } = await resolveEditableIncident(c, incidentId);

  const item = await incidentsService.getItem(db, incidentId, itemId);

  if (!item) {
    throw incidentErrors.itemNotFound({ itemId });
  }

  return { db, incident, item };
}

/**
 * The in-batch prefix rule shared by both write paths.
 *
 * A storage key is the only thing tying a confirmed upload back to the link or
 * the route that requested it, so an unchecked key would let a caller point a
 * claim at any object in the bucket — including one another apartment uploaded.
 */
const assertKeyBelongsTo = (
  storageKey: string,
  incidentId: string,
  itemId: string,
): boolean => storageKey.startsWith(`incidents/${incidentId}/${itemId}/`);

/**
 * Every storage key in a batch is minted under this item's own prefix, and no
 * key appears twice in the same batch.
 *
 * The duplicate test is not cosmetic: `claim_evidence.storage_key` is UNIQUE, so
 * a batch naming the same key twice would fail at the constraint with a driver
 * error rather than a readable one — and the caller would have no way to tell
 * which of its rows was the problem.
 *
 * Returns the offending key, or `null` when the batch is sane, so the caller
 * decides which error to throw rather than this helper knowing about routes.
 */
const findBadKey = (
  keys: string[],
  incidentId: string,
  itemId: string,
): string | null => {
  const seen = new Set<string>();

  for (const key of keys) {
    if (!assertKeyBelongsTo(key, incidentId, itemId) || seen.has(key)) {
      return key;
    }
    seen.add(key);
  }

  return null;
};

app.openapi(createIncidentRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const user = c.get("user");

  if (!user) {
    throw incidentErrors.unauthenticated();
  }

  // The reservation first: it carries the apartment ownership is asserted
  // against, and it is the row both windows are computed from.
  const reservation = await reservationsService.getById(db, body.reservationId);

  if (!reservation) {
    throw incidentErrors.reservationNotFound({ id: body.reservationId });
  }

  await assertApartmentOwnership(db, reservation.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  const effectiveCheckOut = effectiveTime(
    reservation.checkOutDatetime,
    reservation.alternativeCheckOutDatetime,
  );
  const now = new Date();

  // Trigger A, clause 1 (D9): Airbnb's filing limit, measured from this stay's
  // effective check-out.
  if (now > new Date(effectiveCheckOut.getTime() + FILE_WINDOW_DAYS * 24 * 60 * 60 * 1000)) {
    throw incidentErrors.windowExpired({
      reason: "checkout",
      deadline: effectiveCheckOut.toISOString(),
    });
  }

  // Trigger A, clause 2 and the emergency flag come out of ONE call, so the
  // two can never disagree about which guest is next or when they arrive. The
  // next guest's arrival is the deadline: while they are still ahead the claim
  // is open, and once they have arrived the turnover is over.
  const feasibility = await incidentsService.assessFeasibility(
    db,
    reservation.apartmentId,
    {
      reservationId: reservation.id,
      effectiveCheckOut,
      now,
    },
  );

  if (feasibility.nextCheckIn && now > feasibility.nextCheckIn) {
    throw incidentErrors.windowExpired({
      reason: "checkin",
      deadline: feasibility.nextCheckIn.toISOString(),
    });
  }

  const existing = await incidentsService.getByReservationId(db, body.reservationId);

  if (existing) {
    throw incidentErrors.alreadyExists({ reservationId: body.reservationId });
  }

  // Every claimed asset must belong to the apartment the stay was in. Checked
  // before the insert so the client gets the offending asset named, rather than
  // a constraint failure.
  for (const item of body.items) {
    const asset = await incidentsService.getAssetApartment(db, item.assetId);

    if (!asset) {
      throw incidentErrors.assetNotFound({ id: item.assetId });
    }

    if (asset.apartmentId !== reservation.apartmentId) {
      throw incidentErrors.assetNotInApartment({ assetId: item.assetId });
    }
  }

  // A repeated asset in one batch is the same conflict `POST /items` refuses, so
  // it is refused with the same code rather than left to the UNIQUE constraint.
  const assetIds = body.items.map((item: { assetId: string }) => item.assetId);
  const repeated = assetIds.find(
    (assetId: string, index: number) => assetIds.indexOf(assetId) !== index,
  );

  if (repeated) {
    throw incidentErrors.itemExists({ assetId: repeated });
  }

  const created = await incidentsService.create(db, body, {
    effectiveCheckOut,
    isEmergencyMode: feasibility.isEmergency,
  });

  return c.json(created, 201);
});

app.openapi(listIncidentsRoute, async (c) => {
  const db = c.get("db");
  const user = c.get("user");
  const query = c.req.valid("query") as IncidentQuery;

  if (!user) {
    throw incidentErrors.unauthenticated();
  }

  // Ownership is asserted BEFORE the query runs, against the apartment the list
  // is scoped to. The query is required to name one, so there is no unscoped
  // variant of this route that could leak another host's claims.
  await assertApartmentOwnership(db, query.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  const page = await incidentsService.list(db, query);

  return c.json(page, 200);
});

app.openapi(getIncidentRoute, async (c) => {
  const { id } = c.req.valid("param");

  const { incident } = await resolveOwnedIncident(c, id);

  return c.json(incident, 200);
});

app.openapi(updateIncidentRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const { db } = await resolveEditableIncident(c, id);

  const updated = await incidentsService.update(db, id, body);

  if (!updated) {
    throw incidentErrors.notFound({ id });
  }

  return c.json(updated, 200);
});

app.openapi(deleteIncidentRoute, async (c) => {
  const { id } = c.req.valid("param");

  const { db } = await resolveEditableIncident(c, id);

  const deleted = await incidentsService.delete(db, id);

  if (!deleted) {
    throw incidentErrors.notFound({ id });
  }

  return c.json(deleted, 200);
});

app.openapi(addIncidentItemRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const { db, incident } = await resolveEditableIncident(c, id);

  // The asset is validated against THIS claim's apartment, not merely against
  // existing: an asset from a different apartment would put a different flat's
  // furniture on this guest's claim.
  const asset = await incidentsService.getAssetApartment(db, body.assetId);

  if (!asset) {
    throw incidentErrors.assetNotFound({ id: body.assetId });
  }

  const reservation = await reservationsService.getById(db, incident.reservationId);

  if (!reservation) {
    throw incidentErrors.notFound({ id });
  }

  if (asset.apartmentId !== reservation.apartmentId) {
    throw incidentErrors.assetNotInApartment({ assetId: body.assetId });
  }

  const created = await incidentsService.addItem(db, id, body);

  if (!created) {
    throw incidentErrors.itemExists({ assetId: body.assetId });
  }

  return c.json(created, 201);
});

app.openapi(updateIncidentItemRoute, async (c) => {
  const { id, itemId } = c.req.valid("param");
  const body = c.req.valid("json");

  const { db } = await requireItem(c, id, itemId);

  // Re-typing an item that already has evidence would leave evidence that no
  // longer answers the question it was collected for: the field surface
  // validated what the cleaner submitted against the type the item had. The
  // check is here rather than in the service because it needs the evidence
  // count, which this route can read; the update itself stays a plain write.
  if (body.type) {
    const activeCount = await incidentsService.countActiveEvidence(db, itemId);

    if (activeCount > 0) {
      throw incidentErrors.itemLocked({ itemId });
    }
  }

  const updated = await incidentsService.updateItem(db, id, itemId, body);

  if (!updated) {
    throw incidentErrors.itemNotFound({ itemId });
  }

  // Re-read rather than answering with the bare row: the response schema is the
  // same item shape every other item read returns, so a client can hold one
  // parser. The re-read is inside no transaction of its own, which is fine —
  // this is a read of what the write above just committed.
  const hydrated = await incidentsService.getItemWithAsset(db, id, itemId);

  return c.json(hydrated!, 200);
});

app.openapi(deleteIncidentItemRoute, async (c) => {
  const { id, itemId } = c.req.valid("param");

  const { db } = await requireItem(c, id, itemId);

  const deleted = await incidentsService.deleteItem(db, id, itemId);

  if (!deleted) {
    throw incidentErrors.itemNotFound({ itemId });
  }

  return c.json({ success: true, id: deleted.id }, 200);
});

app.openapi(requestEvidenceUploadTokensRoute, async (c) => {
  const { id, itemId } = c.req.valid("param");
  const { files } = c.req.valid("json");

  const { db } = await requireItem(c, id, itemId);

  // One batch is all this route can see — minting a presigned URL writes
  // nothing — so the batch is what is bounded here, mirroring the apartments
  // module. The real per-item limit is enforced by the attach.
  if (files.length > MAX_EVIDENCE_PER_ITEM) {
    throw incidentErrors.maxEvidenceExceeded({
      limit: MAX_EVIDENCE_PER_ITEM,
      submitted: files.length,
    });
  }

  const tokens = await incidentsService.generateHostUploadTokens(
    c.get("s3"),
    c.get("r2BucketName"),
    { incidentId: id, itemId },
    files.map((file: { fileType: string }) => file.fileType),
  );

  return c.json({ tokens }, 200);
});

app.openapi(attachEvidenceRoute, async (c) => {
  const { id, itemId } = c.req.valid("param");
  const body = c.req.valid("json");

  const { db, item } = await requireItem(c, id, itemId);

  // The item's own type decides which photos it accepts (D13); documents are
  // accepted for every type, because a receipt backs a theft and a damage
  // valuation alike.
  const allowed = allowedEvidenceTypes(item.type);

  for (const row of body.evidence) {
    if (!allowed.includes(row.evidenceType)) {
      throw incidentErrors.evidenceTypeMismatch({
        incidentType: item.type,
        allowed,
      });
    }

    // A document with a capture time or coordinates is a category error — a PDF
    // receipt has neither — so it is refused rather than stored as three
    // meaningless nulls (EVIDENCE_METADATA_INVALID).
    if (
      DOCUMENT_EVIDENCE_TYPES.includes(row.evidenceType as never) &&
      (row.capturedAt !== undefined ||
        row.latitude !== undefined ||
        row.longitude !== undefined)
    ) {
      throw incidentErrors.evidenceMetadataInvalid({
        evidenceType: row.evidenceType,
      });
    }
  }

  const badKey = findBadKey(
    body.evidence.map((row: { storageKey: string }) => row.storageKey),
    id,
    itemId,
  );

  if (badKey) {
    throw incidentErrors.evidenceKeyInvalid({ storageKey: badKey });
  }
  // The cap is enforced against what the item ALREADY holds, not against the
  // batch size: the batch bound at the mint is a courtesy, and the mint writes
  // nothing, so a caller could mint one token at a time and attach forever (S1).
  const existingCount = await incidentsService.countActiveEvidence(db, itemId);

  if (existingCount + body.evidence.length > MAX_EVIDENCE_PER_ITEM) {
    throw incidentErrors.maxEvidenceExceeded({
      limit: MAX_EVIDENCE_PER_ITEM,
      submitted: existingCount + body.evidence.length,
    });
  }

  const result = await incidentsService.attachEvidence(
    db,
    { incidentId: id, itemId },
    body,
  );

  const attached = await incidentsService.getItemWithAsset(db, id, itemId);

  return c.json(
    {
      success: true as const,
      attachedCount: result.attachedCount,
      item: attached!,
    },
    201,
  );
});

app.openapi(deleteEvidenceRoute, async (c) => {
  const { id, itemId, evidenceId } = c.req.valid("param");

  const { db } = await requireItem(c, id, itemId);

  const removed = await incidentsService.deleteEvidence(db, {
    incidentId: id,
    itemId,
    evidenceId,
  });

  if (!removed) {
    throw incidentErrors.evidenceNotFound({ evidenceId });
  }

  return c.json({ success: true, id: removed.id }, 200);
});

app.openapi(reissueItemTokenRoute, async (c) => {
  const { id, itemId } = c.req.valid("param");

  const { db } = await requireItem(c, id, itemId);

  const activeCount = await incidentsService.countActiveEvidence(db, itemId);

  // Only an item that never collected anything needs a link. An item with
  // evidence already has what the link was for, and minting another would hand
  // out a second way to write to the same item.
  if (activeCount > 0) {
    throw incidentErrors.itemAlreadyCollected({ itemId });
  }

  const reissued = await incidentsService.reissueToken(db, id, itemId);

  if (!reissued) {
    throw incidentErrors.itemNotFound({ itemId });
  }

  return c.json(reissued, 200);
});

app.openapi(confirmAirbnbFilingRoute, async (c) => {
  const { id } = c.req.valid("param");

  const { db, incident } = await resolveOwnedIncident(c, id);

  if (incident.status === "submitted_to_guest") {
    throw incidentErrors.alreadyFiled({ id });
  }

  if (incident.status !== "ready_to_file") {
    throw incidentErrors.notReady({ status: incident.status });
  }

  const filed = await incidentsService.confirmAirbnbFiling(db, id);

  if (!filed) {
    // Lost a race with a concurrent filing: the row moved out of the
    // filable set between the read above and this update.
    throw incidentErrors.alreadyFiled({ id });
  }

  return c.json(filed, 200);
});

export default app;
