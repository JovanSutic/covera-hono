import { createModuleApp } from "@/core/utils/module-app";
import {
  getFieldIngestRoute,
  requestFieldUploadTokensRoute,
  submitFieldEvidenceRoute,
} from "./incidents.field.contract";
import {
  incidentsService,
  requiredPhotoTypes,
  MAX_EVIDENCE_PER_ITEM,
} from "./incidents.service";
import { incidentErrors } from "./incidents.errors";

/*
 * The tokenized field surface. Mounted at `/field/ingest`.
 *
 * NO GUARD IS MOUNTED ON ANY ROUTE IN THIS FILE, and that is the design, not an
 * omission (D17): the token in the path is the credential. Every handler below
 * therefore resolves a `FieldContext | null` first and throws
 * `FIELD_TOKEN_INVALID` — a 404 — for every way a token can fail, so a caller
 * cannot tell "expired" from "already used" from "never existed" (D11).
 */

const app = createModuleApp();

/**
 * Resolves the token once per request and 404s on any failure. Extracted so the
 * routes cannot drift into answering differently for the same dead link.
 */
async function requireFieldContext(c: any) {
  const db = c.get("db");
  const { token } = c.req.valid("param");

  const context = await incidentsService.getFieldContext(db, token);

  if (!context) {
    throw incidentErrors.fieldTokenInvalid({ token });
  }

  return { db, context };
}

app.openapi(getFieldIngestRoute, async (c) => {
  const { db, context } = await requireFieldContext(c);

  const asset = await incidentsService.getFieldAsset(db, context.item.id);

  if (!asset) {
    // The item exists but its asset does not — only reachable if the asset row
    // was removed out from under the claim. Same 404: the link is unusable.
    throw incidentErrors.fieldTokenInvalid({ token: context.item.id });
  }

  // The baseline is scoped to the asset being photographed, not the apartment
  // (V2): "the photos of the state before" means this asset's state, and
  // framing a damaged kettle against last stay's living-room shots would invite
  // the cleaner to reproduce the wrong composition.
  const baselinePhotos = await incidentsService.getBaselinePhotos(
    db,
    c.get("s3"),
    c.get("r2BucketName"),
    context.apartmentId,
    context.effectiveCheckOut,
    asset.id,
  );

  // The prep doc's central ask — "the system needs to drive the user what needs
  // to be provided" — answered where the user is standing: which evidence types
  // this item accepts, and how many of each are already attached.
  const guidance = await incidentsService.getFieldEvidenceGuidance(
    db,
    context.item.id,
    context.item.type,
  );

  return c.json(
    {
      incidentType: context.item.type,
      itemStatus: context.item.status,
      asset,
      apartmentName: context.apartmentName,
      // `[]` is a real answer (this asset is in no shot of the previous stay)
      // and the client renders without an overlay.
      baselinePhotos,
      requiredEvidenceTypes: guidance.requiredEvidenceTypes,
      attachedEvidenceCounts: guidance.attachedEvidenceCounts,
      tokenExpiresAt: context.item.tokenExpiresAt.toISOString(),
    },
    200,
  );
});

app.openapi(requestFieldUploadTokensRoute, async (c) => {
  const { db, context } = await requireFieldContext(c);

  const s3 = c.get("s3");
  const bucketName = c.get("r2BucketName");
  const { photos } = c.req.valid("json");

  // The field surface is unauthenticated and has no other bound (S1). Minting a
  // presigned URL writes nothing, so one batch is all this route can bound here;
  // the per-item limit is enforced at the submit, which is the call that INSERTs.
  if (photos.length > MAX_EVIDENCE_PER_ITEM) {
    throw incidentErrors.maxEvidenceExceeded({
      limit: MAX_EVIDENCE_PER_ITEM,
      submitted: photos.length,
    });
  }

  // The same cap, counted against what the item already holds: without this the
  // batch bound alone would be trivially bypassed by calling this route once per
  // photo, and the submit could then insert unbounded rows.
  const existingCount = await incidentsService.countActiveEvidence(
    db,
    context.item.id,
  );

  if (existingCount + photos.length > MAX_EVIDENCE_PER_ITEM) {
    throw incidentErrors.maxEvidenceExceeded({
      limit: MAX_EVIDENCE_PER_ITEM,
      submitted: existingCount + photos.length,
    });
  }

  const tokens = await incidentsService.generateFieldUploadTokens(
    s3,
    bucketName,
    { incidentId: context.incidentId, itemId: context.item.id },
    photos.map((photo: { fileType: string }) => photo.fileType),
  );

  return c.json({ tokens }, 200);
});

app.openapi(submitFieldEvidenceRoute, async (c) => {
  const { db, context } = await requireFieldContext(c);

  const body = c.req.valid("json");

  // The pairing the database cannot express: a theft claim filed with damage
  // close-ups is exactly what this feature exists to prevent (D13). Documents
  // are NOT accepted here — the cleaner shoots what they can see; receipts and
  // invoices are the host's to attach — which is exactly what
  // `requiredPhotoTypes` returns.
  const allowed = requiredPhotoTypes(context.item.type);

  for (const photo of body.photos) {
    if (!allowed.includes(photo.evidenceType)) {
      throw incidentErrors.evidenceTypeMismatch({
        incidentType: context.item.type,
        allowed,
      });
    }

    // Each key must be one this item's own upload-token route minted. The prefix
    // is the only thing that ties a confirmed key back to the link that requested
    // it, and without this check an unauthenticated caller could point the claim
    // at any object in the bucket.
    const expectedPrefix = `incidents/${context.incidentId}/${context.item.id}/`;

    if (!photo.storageKey.startsWith(expectedPrefix)) {
      throw incidentErrors.evidenceKeyInvalid({ storageKey: photo.storageKey });
    }
  }

  // The real per-item limit, at the only call that writes (S1).
  const existingCount = await incidentsService.countActiveEvidence(
    db,
    context.item.id,
  );

  if (existingCount + body.photos.length > MAX_EVIDENCE_PER_ITEM) {
    throw incidentErrors.maxEvidenceExceeded({
      limit: MAX_EVIDENCE_PER_ITEM,
      submitted: existingCount + body.photos.length,
    });
  }

  const result = await incidentsService.submitFieldEvidence(
    db,
    { itemId: context.item.id, incidentId: context.incidentId },
    body,
  );

  // `result.itemStatus`, never a literal: the old hardcoded "photos_collected"
  // was true only while one transition existed, and lied the moment the status
  // became derivable from the evidence (V3).
  return c.json(
    {
      success: true,
      itemStatus: result.itemStatus,
      evidenceCount: result.evidenceCount,
    },
    200,
  );
});

export default app;
