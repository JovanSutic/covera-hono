import { pgTable, uuid, timestamp, text, pgEnum, primaryKey } from "drizzle-orm/pg-core";
import { relations, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { inspections } from "./inspections";
import { apartmentShots } from "./apartment-shots";
import { assets } from "./assets";
import { users } from "./users";

// 1. Enums
export const flagReasonEnum = pgEnum("flag_reason", [
  "missing_asset",
  "damaged",
  "poor_photo",
  "wrong_room",
  "other",
]);

export const flagStatusEnum = pgEnum("flag_status", [
  "pending",
  "under_review",
  "resolved",
  "dismissed",
]);

// 2. Table Definitions
export const inspectionFlags = pgTable("inspection_flags", {
  id: uuid("id").primaryKey().defaultRandom(),

  inspectionId: uuid("inspection_id")
    .notNull()
    .references(() => inspections.id, { onDelete: "cascade" }),

  shotId: uuid("shot_id").references(() => apartmentShots.id, { onDelete: "set null" }),

  reason: flagReasonEnum("reason").notNull(),
  details: text("details").notNull(),

  reportedByUserId: uuid("reported_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  status: flagStatusEnum("status").default("pending").notNull(),
  resolutionNotes: text("resolution_notes"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// Junction table for multi-asset selection
export const inspectionFlagAssets = pgTable(
  "inspection_flag_assets",
  {
    flagId: uuid("flag_id")
      .notNull()
      .references(() => inspectionFlags.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.flagId, table.assetId] }),
  })
);

// 3. Drizzle Relational Definitions
export const inspectionFlagsRelations = relations(
  inspectionFlags,
  ({ one, many }) => ({
    inspection: one(inspections, {
      fields: [inspectionFlags.inspectionId],
      references: [inspections.id],
    }),
    shot: one(apartmentShots, {
      fields: [inspectionFlags.shotId],
      references: [apartmentShots.id],
    }),
    reportedByUser: one(users, {
      fields: [inspectionFlags.reportedByUserId],
      references: [users.id],
      relationName: "flagReporter",
    }),
    resolvedByUser: one(users, {
      fields: [inspectionFlags.resolvedByUserId],
      references: [users.id],
      relationName: "flagResolver",
    }),
    flagAssets: many(inspectionFlagAssets),
  })
);

export const inspectionFlagAssetsRelations = relations(
  inspectionFlagAssets,
  ({ one }) => ({
    flag: one(inspectionFlags, {
      fields: [inspectionFlagAssets.flagId],
      references: [inspectionFlags.id],
    }),
    asset: one(assets, {
      fields: [inspectionFlagAssets.assetId],
      references: [assets.id],
    }),
  })
);

// 4. Base Zod Schemas
export const SelectInspectionFlagSchema = createSelectSchema(inspectionFlags);
export const InsertInspectionFlagSchema = createInsertSchema(inspectionFlags);

// 5. Types
export type InspectionFlag = InferSelectModel<typeof inspectionFlags>;
export type NewInspectionFlag = InferInsertModel<typeof inspectionFlags>;
export type InspectionFlagAsset = InferSelectModel<typeof inspectionFlagAssets>;
export type NewInspectionFlagAsset = InferInsertModel<typeof inspectionFlagAssets>;