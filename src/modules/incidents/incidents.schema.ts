import { z } from "@hono/zod-openapi";
import {
  SelectIncidentSchema,
  SelectIncidentItemSchema,
  SelectClaimEvidenceSchema,
} from "@/db";
import { AssetSchema } from "../assets/assets.schema";

// 1. Base schemas

export const IncidentSchema = SelectIncidentSchema.openapi("Incident");

/**
 * One piece of proof, PHOTO or DOCUMENT.
 *
 * `kind` is derived server-side from `evidenceType` (the single `EVIDENCE_KIND`
 * map in the schema module) rather than stored: a `kind` column beside the enum
 * is a second source of truth for the same fact, and the two drift the first
 * time someone adds an enum member and forgets the column. Putting it on the
 * payload makes the distinction the client renders against first-class instead
 * of something every consumer re-derives.
 *
 * `status` is "active" | "soft_deleted"; deleted evidence is filtered out of
 * every read, so it reaches the client only if a route asks for it by id.
 */
export const IncidentEvidenceSchema = SelectClaimEvidenceSchema.extend({
  kind: z.enum(["photo", "document"]),
}).openapi("IncidentEvidence");

/** Back-compat alias: the evidence schema is the only one the module serves. */
export const ClaimEvidenceSchema = IncidentEvidenceSchema;

/**
 * One damaged or stolen asset, with its catalogue row and its evidence.
 *
 * Derived from the table schema via `omit`/`extend` rather than hand-written, so a
 * new column cannot go missing from the payload. `cleanerToken` is omitted
 * everywhere except the create and token-reissue responses — the host relays it
 * out of band and no other read route returns it (D11).
 *
 * `AssetSchema` is referenced, not redefined — the host claim page and the asset
 * list render the same object, and a second schema for it is how the two drift.
 */
export const IncidentItemBaseSchema = SelectIncidentItemSchema.extend({
  asset: AssetSchema,
  evidence: z.array(IncidentEvidenceSchema),
});

export const IncidentItemSchema = IncidentItemBaseSchema.omit({
  cleanerToken: true,
}).openapi("IncidentItem");

/**
 * The same item, token included — the CREATE and TOKEN-REISSUE payloads' shape
 * only. Derived from the same base rather than re-adding the key to
 * `IncidentItemSchema`: Zod's `omit` masks the key, so `extend` refuses to put it
 * back (TS2353). One base, two derivations, and the difference between them is
 * exactly `cleanerToken`.
 */
export const IncidentItemWithTokenSchema =
  IncidentItemBaseSchema.openapi("IncidentItemWithToken");

/**
 * The create and read payload: one claim, its items, and each item's evidence.
 * `cleanerToken` is deliberately absent — it is returned once by the create
 * route and by the token-reissue route, and is not part of the claim's read
 * shape (D11).
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

/**
 * `items` is OPTIONAL, and that is the point of this feature's rework: the
 * incident and its items are now separately created, so a host can open the
 * claim the moment they notice the damage and add the affected assets as they
 * find them. `POST /incidents/{id}/items` is the other half.
 *
 * An empty array and an omitted key mean the same thing. A claim with no items
 * stays `draft` and cannot be filed (`markReadyIfAllItemsCollected` requires at
 * least one item).
 */
export const CreateIncidentBodySchema = z
  .object({
    reservationId: z.uuid().openapi({
      description: "The reservation the damage or theft happened during.",
      example: "770e8400-e29b-41d4-a716-446655440000",
    }),
    items: z
      .array(CreateIncidentItemSchema)
      .optional()
      .default([])
      .openapi({
        description:
          "The affected assets. Optional — items may also be added afterwards " +
          "with POST /incidents/{id}/items.",
      }),
  })
  .openapi("CreateIncident");

/**
 * The editable half of a claim. Status, the clocks and the item-derived total
 * are server-owned and deliberately not accepted here; what a host may correct
 * is the money they are asking for (M5 — `finalPayoutRequestedCents` had no
 * writer at all before this).
 */
export const UpdateIncidentBodySchema = z
  .object({
    finalPayoutRequestedCents: z.number().int().min(0).optional().openapi({
      description: "The amount requested from the resolution centre, in cents.",
      example: 30000,
    }),
  })
  .openapi("UpdateIncident");

/**
 * The editable half of an item.
 *
 * `type` is included because a mis-typed item is otherwise permanent and it
 * poisons the evidence: the field surface decides which photos a cleaner may
 * submit from this value, so a `damage` item marked `theft` forces the wrong
 * shots. The route refuses a `type` change once any evidence exists, because
 * evidence already submitted was validated against the old type.
 *
 * `descriptionByCleaner` is NOT editable — it is the cleaner's own account, and
 * letting the host rewrite it would make it worthless as evidence.
 */
export const UpdateIncidentItemBodySchema = z
  .object({
    type: z.enum(["damage", "theft"]).optional().openapi({
      description: "Correct a mis-typed item. Only while it has no evidence.",
      example: "damage",
    }),
    estimatedPlaceholderValueCents: z.number().int().min(0).optional().openapi({
      description: "Correct the provisional value, in cents.",
      example: 25000,
    }),
  })
  .openapi("UpdateIncidentItem");

/**
 * The create response. This is the ONLY payload that carries `cleanerToken`
 * besides the reissue route: the host relays it to the cleaner out of band, and
 * no read route returns it (D11).
 */
export const CreateIncidentResponseSchema = IncidentWithItemsSchema.extend({
  items: z.array(IncidentItemWithTokenSchema),
}).openapi("CreateIncidentResponse");

/** The response of adding a single item — that item, token included. */
export const AddIncidentItemResponseSchema = IncidentItemWithTokenSchema;

/**
 * Host-side upload tokens. `fileType` is a MIME type and, unlike the field
 * surface, this route accepts documents as well as images — a receipt or a
 * repair quote is a PDF at least as often as it is a photo.
 */
export const EvidenceUploadFileSchema = z.object({
  fileType: z
    .string()
    .regex(
      /^(image\/(jpeg|png|webp|jpg)|application\/pdf)$/,
      "Only JPEG, PNG, WebP and PDF are allowed",
    ),
});

export const EvidenceUploadTokensBodySchema = z
  .object({
    files: z.array(EvidenceUploadFileSchema).min(1).openapi({
      description: "The files to mint presigned PUT URLs for.",
    }),
  })
  .openapi("EvidenceUploadTokensBody");

/**
 * Host-side evidence confirmation — the counterpart of the field submit, but
 * accepting both halves of the proof.
 *
 * `capturedAt`/`latitude`/`longitude` are PHOTO-only: a PDF receipt has no
 * capture time or coordinates, so the service refuses them on a document rather
 * than storing three meaningless nulls (EVIDENCE_METADATA_INVALID).
 */
export const AttachEvidenceItemSchema = z
  .object({
    /**
     * The enum is taken from the COLUMN's own select schema rather than built
     * from `Object.keys(EVIDENCE_KIND)`: the keys of a map are `string` to the
     * type system, so a hand-built enum accepts any string and the service then
     * cannot typecheck the insert. Reusing the column schema keeps the accepted
     * values and the storable values the same set by construction.
     */
    evidenceType: SelectClaimEvidenceSchema.shape.evidenceType.openapi({
      description: "Which of the claim's evidence types this is.",
      example: "original_purchase_receipt",
    }),
    storageKey: z.string().min(1),
    capturedAt: z.string().datetime().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .openapi("AttachEvidenceItem");

export const AttachEvidenceBodySchema = z
  .object({
    evidence: z.array(AttachEvidenceItemSchema).min(1),
  })
  .openapi("AttachEvidenceBody");

export const AttachEvidenceResponseSchema = z
  .object({
    success: z.boolean(),
    attachedCount: z.number().int(),
    item: IncidentItemSchema,
  })
  .openapi("AttachEvidenceResponse");

// 3. Path params

export const IncidentParamSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "Incident unique identifier (UUID)",
  }),
});

export const IncidentItemParamSchema = z.object({
  id: z.uuid().openapi({
    param: { name: "id", in: "path" },
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "Incident unique identifier (UUID)",
  }),
  itemId: z.uuid().openapi({
    param: { name: "itemId", in: "path" },
    example: "223e4567-e89b-12d3-a456-426614174000",
    description: "Incident item unique identifier (UUID)",
  }),
});

export const IncidentEvidenceParamSchema = IncidentItemParamSchema.extend({
  evidenceId: z.uuid().openapi({
    param: { name: "evidenceId", in: "path" },
    example: "323e4567-e89b-12d3-a456-426614174000",
    description: "Evidence unique identifier (UUID)",
  }),
});

export const FieldTokenParamSchema = z.object({
  token: z.string().min(1).openapi({
    param: { name: "token", in: "path" },
    example: "b01924ce7c9f4d37856e5b3701d35909",
    description: "The tokenized field link identifier.",
  }),
});

// 4. List query

/**
 * The operational view (M1). Without this a host could only read a claim whose
 * id they already had, so "which reservations have open claims?" and "which
 * claims are near their escalation deadline?" — the questions the feature exists
 * to answer — were unanswerable.
 */
export const IncidentQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({
      description: "Page number (1-indexed)",
      default: 1,
    }),
    limit: z.coerce.number().int().min(1).max(100).default(20).openapi({
      description: "Number of items per page (max 100)",
      default: 20,
    }),
    status: z
      .enum([
        "draft",
        "ready_to_file",
        "submitted_to_guest",
        "escalated_to_aircover",
        "resolved",
        "unfeasible",
      ])
      .optional()
      .openapi({ description: "Only claims in this status." }),
    /**
     * REQUIRED, and deliberately so.
     *
     * A claim is reached through its reservation's apartment, which is what
     * ownership is asserted against — so an unscoped list would return every
     * host's claims to every host. The query is scoped by the one key the
     * ownership check can be run on, exactly as the reservations list is scoped
     * by its `apartmentId` path segment.
     */
    apartmentId: z.uuid().openapi({
      description: "Only claims whose reservation is for this apartment.",
    }),
    emergencyOnly: z.coerce.boolean().default(false).openapi({
      description: "Only claims flagged as emergency mode.",
      default: false,
    }),
    /**
     * `escalation` is the default because the deadline is the one date on a
     * claim that its owner must act before: the nearest deadline first is the
     * list an operator can work down (M2).
     */
    sortBy: z
      .enum(["escalation", "createdAt", "checkOutDatetime"])
      .default("escalation")
      .openapi({ description: "Field to sort claims by", default: "escalation" }),
    order: z.enum(["asc", "desc"]).default("asc").openapi({
      description: "Sort direction",
      default: "asc",
    }),
  })
  .openapi("IncidentQuery");

export const PaginatedIncidentsSchema = z
  .object({
    data: z.array(IncidentWithItemsSchema),
    pagination: z.object({
      page: z.number().openapi({ example: 1 }),
      limit: z.number().openapi({ example: 20 }),
      totalItems: z.number().openapi({ example: 42 }),
      totalPages: z.number().openapi({ example: 3 }),
    }),
  })
  .openapi("PaginatedIncidents");

// 5. Delete responses

export const DeleteIncidentResponseSchema = z
  .object({
    success: z.boolean(),
    id: z.uuid(),
  })
  .openapi("DeleteIncidentResponse");

export const DeleteIncidentItemResponseSchema = z
  .object({
    success: z.boolean(),
    id: z.uuid(),
  })
  .openapi("DeleteIncidentItemResponse");

export const DeleteEvidenceResponseSchema = z
  .object({
    success: z.boolean(),
    id: z.uuid(),
  })
  .openapi("DeleteEvidenceResponse");

// 6. Field surface schemas
//
// A DIFFERENT TRUST BOUNDARY. The token in the path is the whole credential, so
// every field below is chosen to be safe to hand to an unauthenticated caller:
// no guest name, no guest email, no money, no incident id. `FieldIngestSchema`
// carries the asset the cleaner is standing in front of, the framing guidance
// (which evidence types this item needs, and what is already attached) and the
// baseline photo to frame against — nothing that identifies the stay or the
// guest (D17, and the spec's invariant).

export const FieldAssetSchema = IncidentItemSchema.shape.asset.pick({
  id: true,
  name: true,
  roomLocation: true,
  description: true,
});

export const FieldBaselinePhotoSchema = z
  .object({
    storageKey: z.string(),
    downloadUrl: z.string(),
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
    /**
     * The guidance the prep doc asks for ("the system needs to drive the user
     * what needs to be provided"): which evidence types this item accepts, and
     * how many of each are already attached. Counts and type names only — no
     * storage keys, no money.
     */
    requiredEvidenceTypes: z.array(z.string()),
    attachedEvidenceCounts: z.record(z.string(), z.number().int()),
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

// 7. Exported types

export type Incident = z.infer<typeof IncidentSchema>;
export type IncidentEvidence = z.infer<typeof IncidentEvidenceSchema>;
export type ClaimEvidence = IncidentEvidence;
export type IncidentItem = z.infer<typeof IncidentItemSchema>;
export type IncidentItemWithToken = z.infer<typeof IncidentItemWithTokenSchema>;
export type IncidentWithItems = z.infer<typeof IncidentWithItemsSchema>;
export type CreateIncident = z.infer<typeof CreateIncidentBodySchema>;
export type CreateIncidentItem = z.infer<typeof CreateIncidentItemSchema>;
export type CreateIncidentResponse = z.infer<
  typeof CreateIncidentResponseSchema
>;
export type UpdateIncident = z.infer<typeof UpdateIncidentBodySchema>;
export type UpdateIncidentItem = z.infer<typeof UpdateIncidentItemBodySchema>;
export type AttachEvidenceBody = z.infer<typeof AttachEvidenceBodySchema>;
export type AttachEvidenceResponse = z.infer<
  typeof AttachEvidenceResponseSchema
>;
export type IncidentQuery = z.infer<typeof IncidentQuerySchema>;
export type PaginatedIncidents = z.infer<typeof PaginatedIncidentsSchema>;
export type FieldAsset = z.infer<typeof FieldAssetSchema>;
export type FieldIngest = z.infer<typeof FieldIngestSchema>;
export type FieldUploadTokensBody = z.infer<typeof FieldUploadTokensBodySchema>;
export type FieldSubmitBody = z.infer<typeof FieldSubmitBodySchema>;
export type FieldSubmitResponse = z.infer<typeof FieldSubmitResponseSchema>;
export type FieldSubmitPhoto = z.infer<typeof FieldSubmitPhotoSchema>;
