import { pgTable, pgEnum, uuid, varchar, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql, relations, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { apartments } from "./apartments";
import { reservations } from "./reservations";
import { incidentItems } from "./incident-items";
import { users } from "./users";

export const accessScopeEnum = pgEnum("access_scope", ["inspection_proof", "damage_evidence"]);

export const specialAccess = pgTable(
  "special_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accessId: varchar("access_id", { length: 64 }).notNull().unique(),
    scope: accessScopeEnum("scope").notNull(),
    apartmentId: uuid("apartment_id").notNull().references(() => apartments.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, { onDelete: "cascade" }),
    incidentItemId: uuid("incident_item_id").references(() => incidentItems.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_special_access_reservation").on(table.reservationId),
    index("idx_special_access_incident_item").on(table.incidentItemId),
    check("special_access_subject_matches_scope", sql`(${table.scope} = 'inspection_proof' AND ${table.reservationId} IS NOT NULL AND ${table.incidentItemId} IS NULL) OR (${table.scope} = 'damage_evidence' AND ${table.incidentItemId} IS NOT NULL)`),
  ],
);

export const specialAccessRelations = relations(specialAccess, ({ one }) => ({
  apartment: one(apartments, { fields: [specialAccess.apartmentId], references: [apartments.id] }),
  reservation: one(reservations, { fields: [specialAccess.reservationId], references: [reservations.id] }),
  incidentItem: one(incidentItems, { fields: [specialAccess.incidentItemId], references: [incidentItems.id] }),
  creator: one(users, { fields: [specialAccess.createdBy], references: [users.id] }),
}));

export const SelectSpecialAccessSchema = createSelectSchema(specialAccess);
export const InsertSpecialAccessSchema = createInsertSchema(specialAccess);
export type SpecialAccess = InferSelectModel<typeof specialAccess>;
export type NewSpecialAccess = InferInsertModel<typeof specialAccess>;
export type AccessScope = (typeof accessScopeEnum.enumValues)[number];
