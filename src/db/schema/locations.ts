import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import {
  createInsertSchema,
  createSelectSchema,
} from "drizzle-zod";

export const locationTypeEnum = pgEnum("location_type", [
  "city",
  "region",
]);

export const locations = pgTable("locations", {
  id: uuid("id")
    .defaultRandom()
    .primaryKey(),

  name: text("name")
    .notNull(),

  country: text("country")
    .notNull(),

  type: locationTypeEnum("type")
    .notNull(),

  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

export type Location =
  typeof locations.$inferSelect;

export type NewLocation =
  typeof locations.$inferInsert;

export const SelectLocationSchema =
  createSelectSchema(locations);

export const InsertLocationSchema =
  createInsertSchema(locations);