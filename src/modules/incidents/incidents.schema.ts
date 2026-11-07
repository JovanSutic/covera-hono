import { z } from "@hono/zod-openapi";
import {
  SelectIncidentSchema,
  SelectIncidentItemSchema,
  SelectClaimEvidenceSchema,
} from "@/db";
import { AssetSchema } from "../assets/assets.schema";

// 1. Base schemas

export const IncidentSchema = SelectIncidentSchema.openapi("Incident");

export const ClaimEvidenceSchema =
  SelectClaimEvidenceSchema.openapi("ClaimEvidence");

/**
 * One damaged or stolen asset, with its catalogue row and its evidence.
 *
 * Derived from the table schema via `omit`/`extend` rather than hand-written, so a
 * new column cannot go missing from the payload. `cleanerToken` is omitted
 * everywhere except the create response — the host relays it out of band and no
 * read route returns it (D11).
 *
 * `AssetSchema` is referenced, not redefined — the host claim page and the asset
 * list render the same object, and a second schema for it is how the two drift.
 */
export const IncidentItemBaseSchema = SelectIncidentItemSchema.extend({
  asset: AssetSchema,
  evidence: z.array(ClaimEvidenceSchema),
});

export const IncidentItemSchema = IncidentItemBaseSchema.omit({
  cleanerToken: true,
}).openapi("IncidentItem");

/**
 * The same item, token included — the CREATE payload's shape only. Derived from
 * the same base rather than re-adding the key to `IncidentItemSchema`: Zod's
 * `omit` masks the key, so `extend` refuses to put it back (TS2353). One base,
 * two derivations, and the difference between them is exactly `cleanerToken`.
 */
export const IncidentItemWithTokenSchema =
  IncidentItemBaseSchema.openapi("IncidentItemWithToken");

/**
 * The create and read payload: one claim, its items, and each item's evidence.
 * `cleanerToken` is deliberately absent — it is returned once by the create
 * route and is not part of the claim's read shape (D11).
 */
export const IncidentWithItemsSchema = IncidentSchema.extend({
  items: z.array(IncidentItemSchema),
}).openapi("IncidentWithItems");

export const IncidentsListSchema = z
  .array(IncidentWithItemsSchema)
  .openapi("IncidentsList");

// 2. Request bodies

export const CreateIncidentItemSchema = z
  .object({
    assetId: z.uuid().openapi({
      description: "The asset that was damaged or stolen.",
      example: "550e8400-e29b-41d4-a716-446655440000",
    }),
    type: z.enum(["damage", "theft"]).openapi({
      description: "Whether this asset was damaged or stolen.",
      example: "damage",
    }),
    estimatedPlaceholderValueCents: z.number().int().min(0).optional().openapi({
      description:
        "A provisional value in cents, replaced once the claim is valued. Optional.",
      example: 25000,
    }),
  })
  .openapi("CreateIncidentItem");

export const CreateIncidentBodySchema = z
  .object({
    reservationId: z.uuid().openapi({
      description: "The reservation the damage or theft happened during.",
      example: "770e8400-e29b-41d4-a716-446655440000",
    }),
    items: z
      .array(CreateIncidentItemSchema)
      .min(1)
      .openapi({
        description: "The affected assets. At least one is required.",
      }),
  })
  .openapi("CreateIncident");

/**
 * The create response. This is the ONLY place `cleanerToken` is returned: the
 * host relays each token to the cleaner out of band, and there is no route that
 * reads a token back (D11).
 */
export const CreateIncidentResponseSchema = IncidentWithItemsSchema.extend({
  items: z.array(IncidentItemWithTokenSchema),
}).openapi("CreateIncidentResponse");

// 3. Path params

export const IncidentParamSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "Incident unique identifier (UUID)",
  }),
});

export const FieldTokenParamSchema = z.object({
  token: z.string().min(1).openapi({
    param: { name: "token", in: "path" },
    example: "b01924ce7c9f4d37856e5b3701d35909",
    description: "The tokenized field link identifier.",
  }),
});

// 4. Field surface schemas
//
// A DIFFERENT TRUST BOUNDARY. The token in the path is the whole credential, so
// every field below is chosen to be safe to hand to an unauthenticated caller:
// no guest name, no guest email, no money, no incident id. `FieldIngestSchema`
// carries the asset the cleaner is standing in front of and the baseline photo
// to frame against — nothing that identifies the stay or the guest (D17, and the
// spec's invariant).

export const FieldAssetSchema = IncidentItemSchema.shape.asset.pick({
  id: true,
  name: true,
  roomLocation: true,
  description: true,
});

export const FieldBaselinePhotoSchema = z
  .object({
    storageKey: z.string(),
    downloadUrl: z.string().nullable(),
  })
  .openapi("FieldBaselinePhoto");

export const FieldIngestSchema = z
  .object({
    incidentType: z.enum(["damage", "theft"]).openapi({
      description: "What the host says happened to this asset.",
      example: "damage",
    }),
    itemStatus: IncidentItemSchema.shape.status,
    asset: FieldAssetSchema,
    apartmentName: z.string(),
    baselinePhotos: z.array(FieldBaselinePhotoSchema),
    tokenExpiresAt: z.string().datetime(),
  })
  .openapi("FieldIngest");

export const FieldUploadPhotoSchema = z.object({
  fileType: z
    .string()
    .regex(/^image\/(jpeg|png|webp|jpg)$/, "Only JPEG, PNG, and WebP are allowed"),
});

export const FieldUploadTokensBodySchema = z
  .object({
    photos: z.array(FieldUploadPhotoSchema).min(1),
  })
  .openapi("FieldUploadTokensBody");

export const FieldSubmitPhotoSchema = z
  .object({
    evidenceType: z.enum([
      "damage_photo_wide",
      "damage_photo_closeup",
      "theft_empty_space_photo",
    ]),
    storageKey: z.string().min(1),
    capturedAt: z.string().datetime().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .openapi("FieldSubmitPhoto");

export const FieldSubmitBodySchema = z
  .object({
    descriptionByCleaner: z.string().max(2000).optional(),
    photos: z.array(FieldSubmitPhotoSchema).min(1),
  })
  .openapi("FieldSubmitBody");

export const FieldSubmitResponseSchema = z
  .object({
    success: z.boolean(),
    itemStatus: IncidentItemSchema.shape.status,
    evidenceCount: z.number().int(),
  })
  .openapi("FieldSubmitResponse");

// 5. Exported types

export type Incident = z.infer<typeof IncidentSchema>;
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>;
export type IncidentItem = z.infer<typeof IncidentItemSchema>;
export type IncidentWithItems = z.infer<typeof IncidentWithItemsSchema>;
export type CreateIncident = z.infer<typeof CreateIncidentBodySchema>;
export type CreateIncidentItem = z.infer<typeof CreateIncidentItemSchema>;
export type CreateIncidentResponse = z.infer<
  typeof CreateIncidentResponseSchema
>;
export type FieldAsset = z.infer<typeof FieldAssetSchema>;
export type FieldIngest = z.infer<typeof FieldIngestSchema>;
export type FieldUploadTokensBody = z.infer<typeof FieldUploadTokensBodySchema>;
export type FieldSubmitBody = z.infer<typeof FieldSubmitBodySchema>;
export type FieldSubmitResponse = z.infer<typeof FieldSubmitResponseSchema>;
export type FieldSubmitPhoto = z.infer<typeof FieldSubmitPhotoSchema>;
