import { 
  pgTable, 
  pgEnum, 
  uuid, 
  varchar, 
  text, 
  integer, 
  boolean, 
  timestamp, 
  index 
} from 'drizzle-orm/pg-core';
import { apartments } from './apartments';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';

export const photoProofRequirementEnum = pgEnum('photo_proof_requirement', [
  'SWEEP_ONLY',
  'CLOSEUP',
  'FUNCTIONAL_ACTION'
]);

export const assets = pgTable('assets', {
  id: uuid('id').defaultRandom().primaryKey(),
  
  apartmentId: uuid('apartment_id')
    .notNull()
    .references(() => apartments.id, { onDelete: 'cascade' }),
  
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(),
  
  roomLocation: varchar('room_location', { length: 100 }).notNull(),
  
  description: text('description'),
  
  photoProofRequirement: photoProofRequirementEnum('photo_proof_requirement')
    .default('SWEEP_ONLY')
    .notNull(),
  
  approximateValueCents: integer('approximate_value_cents'),
  
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  activeApartmentRoomIdx: index('idx_active_apartment_room')
    .on(table.apartmentId, table.roomLocation, table.isActive),
}));

export type Asset =
  typeof assets.$inferSelect;

export type NewAsset =
  typeof assets.$inferInsert;

export const SelectAssetSchema = createSelectSchema(assets);
export const InsertAssetSchema = createInsertSchema(assets);