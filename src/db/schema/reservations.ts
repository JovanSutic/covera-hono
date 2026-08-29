import { 
  pgTable, 
  uuid, 
  varchar, 
  timestamp, 
  integer, 
  boolean,
  pgEnum, 
  index 
} from 'drizzle-orm/pg-core';
import { apartments } from './apartments';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

export const reservationStatusEnum = pgEnum('reservation_status', [
  'UPCOMING',
  'CHECK_IN_DUE',
  'ACTIVE',
  'CHECK_OUT_DUE',
  'CLOSED',
  'DISPUTED',
]);

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    apartmentId: uuid('apartment_id')
      .notNull()
      .references(() => apartments.id, { onDelete: 'cascade' }),

    platformReservationId: varchar('platform_reservation_id', { length: 255 }),

    guestName: varchar('guest_name', { length: 255 }).notNull(),
    guestEmail: varchar('guest_email', { length: 255 }),

    checkInDatetime: timestamp('check_in_datetime', { withTimezone: true }).notNull(),
    checkOutDatetime: timestamp('check_out_datetime', { withTimezone: true }).notNull(),

    // Optional alternative check-in / check-out timestamps (e.g., early check-in, late check-out)
    alternativeCheckInDatetime: timestamp('alternative_check_in_datetime', { withTimezone: true }),
    alternativeCheckOutDatetime: timestamp('alternative_check_out_datetime', { withTimezone: true }),

    // Indicates whether the reservation inspection photo requirements have been satisfied
    hasPhotoProof: boolean('has_photo_proof').default(false).notNull(),

    status: reservationStatusEnum('status').default('UPCOMING').notNull(),

    proofWindowHours: integer('proof_window_hours').default(4).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_reservations_apartment').on(table.apartmentId),
    index('idx_reservations_status').on(table.status),
    index('idx_reservations_dates').on(table.apartmentId, table.checkInDatetime, table.checkOutDatetime),
  ]
);

export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;

export const SelectReservationSchema = createSelectSchema(reservations);
export const InsertReservationSchema = createInsertSchema(reservations);