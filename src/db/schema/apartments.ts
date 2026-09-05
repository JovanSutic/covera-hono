import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import {
  createInsertSchema,
  createSelectSchema,
} from "drizzle-zod";

import { users } from "./users";
import { locations } from "./locations";
import { apartmentShots } from "./apartment-shots";
import { apartmentImages } from "./apartment-images";

export const currencyEnum = pgEnum("currency", [
  "EUR",
  "USD",
  "GBP",
  "RSD",
  "CHF",
  "CAD",
  "AUD",
]);

export const apartments = pgTable("apartments", {
  id: uuid("id")
    .defaultRandom()
    .primaryKey(),

  owner: uuid("owner")
    .notNull()
    .references(() => users.id),

  location: uuid("location")
    .notNull()
    .references(() => locations.id),

  name: text("name")
    .notNull(),

  address: text("address")
    .notNull(),

  currency: currencyEnum("currency")
    .default("EUR")
    .notNull(),

  externalId: text("external_id"),

  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

export const apartmentsRelations = relations(apartments, ({ one, many }) => ({
  owner: one(users, {
    fields: [apartments.owner],
    references: [users.id],
  }),
  location: one(locations, {
    fields: [apartments.location],
    references: [locations.id],
  }),
  shots: many(apartmentShots),
  images: many(apartmentImages),
}));

export type Apartment = typeof apartments.$inferSelect;
export type NewApartment = typeof apartments.$inferInsert;
export type Currency = (typeof currencyEnum.enumValues)[number];

export const SelectApartmentSchema = createSelectSchema(apartments);
export const InsertApartmentSchema = createInsertSchema(apartments);