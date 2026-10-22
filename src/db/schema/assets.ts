import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { apartments } from "./apartments";
import { assetTypes } from "./asset-types";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  assetAgeBracketEnum,
  assetCategoryEnum,
  assetValueTierEnum,
  photoProofRequirementEnum,
  roomLocationEnum,
} from "./asset-enums";

// --- ASSETS TABLE (STEP 2: NULLABLE TRANSITION STATE) ---
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    apartmentId: uuid("apartment_id")
      .notNull()
      .references(() => apartments.id, { onDelete: "cascade" }),

    // Legacy fields (kept required until backfill step)
    name: varchar("name", { length: 255 }).notNull(),
    category: assetCategoryEnum("category").notNull(),

    roomLocation: roomLocationEnum("room_location").notNull(),
    description: text("description"),

    photoProofRequirement: photoProofRequirementEnum("photo_proof_requirement")
      .default("SWEEP_ONLY")
      .notNull(),

    approximateValueCents: integer("approximate_value_cents"),

    assetTypeId: uuid("asset_type_id")
      .notNull()
      .references(() => assetTypes.id, { onDelete: "restrict" }),

    ageBracket: assetAgeBracketEnum("age_bracket"),
    valueTier: assetValueTierEnum("value_tier"),

    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_active_apartment_room").on(
      table.apartmentId,
      table.roomLocation,
      table.isActive,
    ),
    index("idx_asset_type").on(table.assetTypeId),
  ],
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export const SelectAssetSchema = createSelectSchema(assets);
export const InsertAssetSchema = createInsertSchema(assets);
