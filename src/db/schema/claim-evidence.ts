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
// `original_purchase_receipt`, `replacement_retail_quote`, `handyman_invoice`
// and `police_report` are the document half of the lifecycle. They are declared
// now so the storage format never changes when that half lands, and nothing in
// this feature writes them (D22).
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
// extraction job in this repo (D10).
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

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_claim_evidence_item").on(table.incidentItemId)],
);

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
