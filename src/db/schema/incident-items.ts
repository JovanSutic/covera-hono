import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { incidents } from "./incidents";
import { assets } from "./assets";
import { claimEvidence } from "./claim-evidence";

// 1. Enums
export const assetIncidentTypeEnum = pgEnum("asset_incident_type", [
  "damage",
  "theft",
]);

export const incidentItemStatusEnum = pgEnum("incident_item_status", [
  "link_generated",
  "photos_collected",
  "documents_pending",
  "complete",
]);

// 2. Table Definition
//
// `asset_id` RESTRICTS rather than cascades: an asset named in a claim is the
// evidence the claim rests on, so deleting it must fail loudly instead of
// silently emptying the claim (D5).
//
// `cleaner_token` is UNIQUE and single-use — the submit route expires it (D11).
// `UNIQUE(incident_id, asset_id)` is what makes one asset appear at most once
// per claim; the domain layer asserts it first so the client gets a readable
// error rather than a constraint violation.
export const incidentItems = pgTable(
  "incident_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),

    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),

    type: assetIncidentTypeEnum("type").notNull(),
    status: incidentItemStatusEnum("status").default("link_generated").notNull(),

    cleanerToken: varchar("cleaner_token", { length: 64 }).notNull().unique(),
    tokenExpiresAt: timestamp("token_expires_at", {
      withTimezone: true,
    }).notNull(),

    estimatedPlaceholderValueCents: integer("estimated_placeholder_value_cents")
      .default(0)
      .notNull(),
    descriptionByCleaner: text("description_by_cleaner"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("incident_items_incident_asset_unique").on(
      table.incidentId,
      table.assetId,
    ),
    index("idx_incident_items_incident").on(table.incidentId),
    index("idx_incident_items_asset").on(table.assetId),
  ],
);

// 3. Drizzle Relational Definitions
export const incidentItemsRelations = relations(
  incidentItems,
  ({ one, many }) => ({
    incident: one(incidents, {
      fields: [incidentItems.incidentId],
      references: [incidents.id],
    }),
    asset: one(assets, {
      fields: [incidentItems.assetId],
      references: [assets.id],
    }),
    evidence: many(claimEvidence),
  }),
);

// 4. Base Zod Schemas
export const SelectIncidentItemSchema = createSelectSchema(incidentItems);
export const InsertIncidentItemSchema = createInsertSchema(incidentItems);

// 5. Types
export type IncidentItem = InferSelectModel<typeof incidentItems>;
export type NewIncidentItem = InferInsertModel<typeof incidentItems>;
