import { pgTable, uuid, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { reservations } from "./reservations";

export type VisitLogEvent = {
  timestamp: string;
  userAgent: string;
};

// 1. Table Definition
export const inspections = pgTable("inspections", {
  id: uuid("id").primaryKey().defaultRandom(),
  reservationId: uuid("reservation_id")
    .notNull()
    .references(() => reservations.id, { onDelete: "cascade" }),

  visited: jsonb("accessed").$type<VisitLogEvent[]>().notNull().default([]),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 2. Drizzle Relational Definitions
export const inspectionsRelations = relations(inspections, ({ one }) => ({
  reservation: one(reservations, {
    fields: [inspections.reservationId],
    references: [reservations.id],
  }),
}));

// 3. Base Zod Schemas
export const SelectInspectionSchema = createSelectSchema(inspections);
export const InsertInspectionSchema = createInsertSchema(inspections);

// 4. Types
export type Inspection = InferSelectModel<typeof inspections>;
export type NewInspection = InferInsertModel<typeof inspections>;