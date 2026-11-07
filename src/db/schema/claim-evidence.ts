import {
  pgTable,
  pgEnum,
  uuid,
  text,
  decimal,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { incidentItems } from "./incident-items";

// 1. Enums
//
// The enum is the ONE discriminator between the two halves of a claim's proof:
// the first three values are PHOTOS the cleaner shoots on site, the last four
// are DOCUMENTS that back the valuation (receipts, quotes, invoices, a police
// report). There is deliberately no separate `kind` column — a second column
// restating the enum is how the two drift — so `EVIDENCE_KIND` below is the
// single mapping from a type to its half, and the API derives `kind` from it.
export const evidenceFileTypeEnum = pgEnum("evidence_file_type", [
  "damage_photo_wide",
  "damage_photo_closeup",
  "theft_empty_space_photo",
  "original_purchase_receipt",
  "replacement_retail_quote",
  "handyman_invoice",
  "police_report",
]);

// 2. Table Definition
//
// `storage_key` is the R2 object key, not a URL, matching
// `apartment_images.storage_key` (D4). UNIQUE makes the confirm step idempotent.
//
// The EXIF columns are written from the submit body's own fields; there is no
// extraction job in this repo (D10). They are PHOTO-only semantics — a PDF
// receipt has no capture time or coordinates — so the domain layer refuses a
// document that carries them rather than storing three meaningless nulls.
//
// `status`/`deleted_at` mirror `apartment_images` exactly: evidence is
// soft-deleted, never removed, so a mistaken upload can be withdrawn without
// destroying the record of what was filed. The R2 object itself is left in
// place, as the apartments flow leaves its own.
export const claimEvidence = pgTable(
  "claim_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    incidentItemId: uuid("incident_item_id")
      .notNull()
      .references(() => incidentItems.id, { onDelete: "cascade" }),

    evidenceType: evidenceFileTypeEnum("evidence_type").notNull(),
    storageKey: text("storage_key").notNull().unique(),

    exifCapturedAt: timestamp("exif_captured_at", { withTimezone: true }),
    exifLatitude: decimal("exif_latitude", { precision: 9, scale: 6 }),
    exifLongitude: decimal("exif_longitude", { precision: 9, scale: 6 }),

    status: text("status", { enum: ["active", "soft_deleted"] })
      .default("active")
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_claim_evidence_item").on(table.incidentItemId)],
);

/**
 * The photo/document split, derived from the enum rather than stored beside it.
 *
 * Everything downstream — the cleaner shooting on site, the host attaching a
 * receipt, the EXIF rule, the upload-token MIME filter — reads this one map, so
 * adding a member to the enum is a compile error here until it is classified.
 */
export const EVIDENCE_KIND = {
  damage_photo_wide: "photo",
  damage_photo_closeup: "photo",
  theft_empty_space_photo: "photo",
  original_purchase_receipt: "document",
  replacement_retail_quote: "document",
  handyman_invoice: "document",
  police_report: "document",
} as const satisfies Record<
  (typeof evidenceFileTypeEnum.enumValues)[number],
  "photo" | "document"
>;

export type EvidenceKind = (typeof EVIDENCE_KIND)[keyof typeof EVIDENCE_KIND];

export const PHOTO_EVIDENCE_TYPES = Object.entries(EVIDENCE_KIND)
  .filter(([, kind]) => kind === "photo")
  .map(([type]) => type) as Array<keyof typeof EVIDENCE_KIND>;

export const DOCUMENT_EVIDENCE_TYPES = Object.entries(EVIDENCE_KIND)
  .filter(([, kind]) => kind === "document")
  .map(([type]) => type) as Array<keyof typeof EVIDENCE_KIND>;

// 3. Drizzle Relational Definitions
export const claimEvidenceRelations = relations(claimEvidence, ({ one }) => ({
  incidentItem: one(incidentItems, {
    fields: [claimEvidence.incidentItemId],
    references: [incidentItems.id],
  }),
}));

// 4. Base Zod Schemas
export const SelectClaimEvidenceSchema = createSelectSchema(claimEvidence);
export const InsertClaimEvidenceSchema = createInsertSchema(claimEvidence);

// 5. Types
export type ClaimEvidence = InferSelectModel<typeof claimEvidence>;
export type NewClaimEvidence = InferInsertModel<typeof claimEvidence>;
