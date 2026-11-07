import { createRoute } from "@hono/zod-openapi";
import {
  FieldIngestSchema,
  FieldTokenParamSchema,
  FieldSubmitBodySchema,
  FieldSubmitResponseSchema,
  FieldUploadTokensBodySchema,
} from "./incidents.schema";
import { UploadTokensResponseSchema } from "../apartments/apartments.schema";
import { errorResponses, VALIDATION } from "@/core/errors/error.responses";

/*
 * The field surface is UNAUTHENTICATED BY DESIGN (D17). Possession of the token
 * in the path is the entire credential — there is no Authorization header, no
 * session, and no guard on any route in this file.
 *
 * That is why no route here declares a 401 or a 403: `check-contracts.ts`
 * requires those statuses only when `authGuard`, `rolesGuard` or `apartmentGuard`
 * appears in `middleware`, and declaring one anyway would document a status this
 * surface cannot produce. An unusable token is a 404, not a 401, so the route
 * never confirms which tokens once existed (D18).
 */

const fieldReadErrors = errorResponses([
  ...VALIDATION,
  "FIELD_TOKEN_INVALID",
  "INTERNAL_SERVER_ERROR",
]);

const fieldUploadTokenErrors = errorResponses([
  ...VALIDATION,
  "FIELD_TOKEN_INVALID",
  "INTERNAL_SERVER_ERROR",
]);

const fieldSubmitErrors = errorResponses([
  ...VALIDATION,
  "FIELD_TOKEN_INVALID",
  "EVIDENCE_TYPE_MISMATCH",
  "INTERNAL_SERVER_ERROR",
]);

/**
 * What the cleaner needs to take the photos: which asset, the incident type that
 * decides which shots to take, the apartment name, and last stay's turnover
 * photos to frame against.
 *
 * Carries NO guest identity and NO money. `FieldIngestSchema` is a separate
 * schema from `IncidentWithItemsSchema` rather than a projection of it, so a
 * later edit to the host payload cannot widen this one by accident — and the
 * phase's test asserts the serialised body against a forbidden-key list.
 */
export const getFieldIngestRoute = createRoute({
  method: "get",
  path: "/{token}",
  tags: ["Field intake"],
  request: {
    params: FieldTokenParamSchema,
  },
  responses: {
    200: {
      description: "Field link resolved; the item is ready for photos",
      content: {
        "application/json": {
          schema: FieldIngestSchema,
        },
      },
    },
    ...fieldReadErrors,
  },
});

/**
 * Presigned R2 upload URLs for this item's evidence. Writes nothing — the keys
 * are minted under `incidents/{incidentId}/{itemId}/`, which is what the submit
 * step verifies each confirmed key against.
 */
export const requestFieldUploadTokensRoute = createRoute({
  method: "post",
  path: "/{token}/upload-tokens",
  tags: ["Field intake"],
  request: {
    params: FieldTokenParamSchema,
    body: {
      content: {
        "application/json": {
          schema: FieldUploadTokensBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Presigned upload URLs generated successfully",
      content: {
        "application/json": {
          schema: UploadTokensResponseSchema,
        },
      },
    },
    ...fieldUploadTokenErrors,
  },
});

/**
 * Confirms the uploaded photos against the item, writes their metadata, and
 * advances the item to `photos_collected` — which also burns the token and may
 * aggregate the claim to `ready_to_file` (Trigger B, D15).
 */
export const submitFieldEvidenceRoute = createRoute({
  method: "post",
  path: "/{token}/submit",
  tags: ["Field intake"],
  request: {
    params: FieldTokenParamSchema,
    body: {
      content: {
        "application/json": {
          schema: FieldSubmitBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Evidence recorded; the link is now spent",
      content: {
        "application/json": {
          schema: FieldSubmitResponseSchema,
        },
      },
    },
    ...fieldSubmitErrors,
  },
});
