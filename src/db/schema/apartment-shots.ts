import { 
  pgTable, 
  uuid, 
  varchar, 
  text, 
  timestamp, 
  index 
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { apartments } from './apartments';
import { roomLocationEnum, photoProofRequirementEnum } from './assets';
import { apartmentShotAssets } from './apartment-shot-assets';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

export const apartmentShots = pgTable(
  'apartment_shots',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    apartmentId: uuid('apartment_id')
      .notNull()
      .references(() => apartments.id, { onDelete: 'cascade' }),

    roomLocation: roomLocationEnum('room_location').notNull(),
    shotType: photoProofRequirementEnum('shot_type').notNull(),

    title: varchar('title', { length: 255 }).notNull(),
    instructions: text('instructions').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_shots_apartment_room').on(table.apartmentId, table.roomLocation),
  ]
);

export type ApartmentShot = typeof apartmentShots.$inferSelect;
export type NewApartmentShot = typeof apartmentShots.$inferInsert;

export const SelectApartmentShotSchema = createSelectSchema(apartmentShots);
export const InsertApartmentShotSchema = createInsertSchema(apartmentShots);