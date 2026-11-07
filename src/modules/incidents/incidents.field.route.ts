import { createModuleApp } from "@/core/utils/module-app";
import {
  getFieldIngestRoute,
  requestFieldUploadTokensRoute,
  submitFieldEvidenceRoute,
} from "./incidents.field.contract";
import { incidentsService } from "./incidents.service";
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

/** Which evidence types a given incident type accepts (D13). */
const ALLOWED_EVIDENCE: Record<"damage" | "theft", readonly string[]> = {
  damage: ["damage_photo_wide", "damage_photo_closeup"],
  theft: ["theft_empty_space_photo"],
};

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

  const baselinePhotos = await incidentsService.getBaselinePhotos(
    db,
    c.get("s3"),
    c.get("r2BucketName"),
    context.apartmentId,
    context.effectiveCheckOut,
  );

  return c.json(
    {
      incidentType: context.item.type,
      itemStatus: context.item.status,
      asset,
      apartmentName: context.apartmentName,
      // `[]` is a real answer (first-ever stay) and the client renders without
      // an overlay. Keys only — the field surface never sees a signed URL it
      // did not ask for, and the client fetches through the same presign flow.
      baselinePhotos,

      tokenExpiresAt: context.item.tokenExpiresAt.toISOString(),
    },
    200,
  );
});

app.openapi(requestFieldUploadTokensRoute, async (c) => {
  const { context } = await requireFieldContext(c);

  const s3 = c.get("s3");
  const bucketName = c.get("r2BucketName");
  const { photos } = c.req.valid("json");

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
  // close-ups is exactly what this feature exists to prevent (D13).
  const allowed = ALLOWED_EVIDENCE[context.item.type];

  for (const photo of body.photos) {
    if (!allowed.includes(photo.evidenceType)) {
      throw incidentErrors.evidenceTypeMismatch({
        incidentType: context.item.type,
        allowed: [...allowed],
      });
    }

    // Each key must be one this item's own upload-token route minted. The prefix
    // is the only thing that ties a confirmed key back to the link that requested
    // it, and without this check an unauthenticated caller could point the claim
    // at any object in the bucket.
    const expectedPrefix = `incidents/${context.incidentId}/${context.item.id}/`;

    if (!photo.storageKey.startsWith(expectedPrefix)) {
      throw incidentErrors.evidenceTypeMismatch({
        incidentType: context.item.type,
        allowed: [...allowed],
      });
    }
  }

  const result = await incidentsService.submitFieldEvidence(
    db,
    { itemId: context.item.id, incidentId: context.incidentId },
    body,
  );

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
