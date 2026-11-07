import {
  pgTable,
  pgEnum,
  uuid,
  boolean,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations, InferInsertModel, InferSelectModel } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { reservations } from "./reservations";
import { incidentItems } from "./incident-items";

// 1. Enums
export const incidentStatusEnum = pgEnum("incident_status", [
  "draft",
  "ready_to_file",
  "submitted_to_guest",
  "escalated_to_aircover",
  "resolved",
  "unfeasible",
]);

// 2. Table Definition
//
// One claim per reservation: `reservation_id` is UNIQUE (the Airbnb 1:1), and
// deleting the reservation takes the claim with it. The reverse is not true of
// `incident_items.asset_id`, which restricts — see incident-items.ts.
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    reservationId: uuid("reservation_id")
      .notNull()
      .unique()
      .references(() => reservations.id, { onDelete: "cascade" }),

    status: incidentStatusEnum("status").default("draft").notNull(),
    isEmergencyMode: boolean("is_emergency_mode").default(false).notNull(),

    // Money is integer cents, matching `assets.approximate_value_cents`.
    placeholderTotalAmountCents: integer("placeholder_total_amount_cents")
      .default(0)
      .notNull(),
    finalPayoutRequestedCents: integer("final_payout_requested_cents")
      .default(0)
      .notNull(),

    resolutionCenterSubmittedAt: timestamp("resolution_center_submitted_at", {
      withTimezone: true,
    }),
    guestResponseDeadlineAt: timestamp("guest_response_deadline_at", {
      withTimezone: true,
    }),
    // Checkout + 30 days, frozen at creation: the deadline the host was shown
    // must not move if the reservation is edited later (D7).
    aircoverEscalationDeadlineAt: timestamp("aircover_escalation_deadline_at", {
      withTimezone: true,
    }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_incidents_status").on(table.status)],
);

// 3. Drizzle Relational Definitions
export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  reservation: one(reservations, {
    fields: [incidents.reservationId],
    references: [reservations.id],
  }),
  items: many(incidentItems),
}));

// 4. Base Zod Schemas
export const SelectIncidentSchema = createSelectSchema(incidents);
export const InsertIncidentSchema = createInsertSchema(incidents);

// 5. Types
export type Incident = InferSelectModel<typeof incidents>;
export type NewIncident = InferInsertModel<typeof incidents>;
