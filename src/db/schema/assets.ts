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

export const assetCategoryEnum = pgEnum('asset_category', [
  'ELECTRONICS',
  'APPLIANCES_LARGE',
  'APPLIANCES_SMALL',
  'FURNITURE',
  'STRUCTURAL_SURFACES',
  'BATH_PLUMBING_FIXTURES',
  'RUGS_CARPETS_TEXTILES',
  'LIGHTING_FIXTURES',
  'SAFETY_SECURITY',
  'ENTERTAINMENT_RECREATION',
  'DECOR_ART',
  'UTILITIES_INFRASTRUCTURE',
  'OUTDOOR_PATIO',
  'OTHER'
]);

export const roomLocationEnum = pgEnum('room_location', [
  // --- ENTRANCE & CIRCULATION ---
  'ENTRANCE_HALLWAY',
  'STAIRCASE_CORRIDOR',

  // --- LIVING & ENTERTAINMENT ---
  'LIVING_ROOM',
  'DINING_ROOM',
  'GAME_ENTERTAINMENT_ROOM',
  'HOME_OFFICE_STUDY',

  // --- COOKING & UTILITY WET AREAS ---
  'KITCHEN',
  'PANTRY_LAUNDRY_ROOM',

  // --- SLEEPING QUARTERS ---
  'BEDROOM_PRIMARY',   // Primary / Master Bedroom
  'BEDROOM_2',
  'BEDROOM_3',
  'BEDROOM_4',
  'BEDROOM_5',

  // --- BATHROOMS & SPA ---
  'BATHROOM_FULL_1',  // Full Bath (Shower/Tub)
  'BATHROOM_FULL_2',
  'BATHROOM_FULL_3',
  'BATHROOM_HALF_POWDER', // Half Bath / Guest Toilet
  'SAUNA_SPA_ROOM',

  // --- FITNESS & WELLNESS ---
  'GYM_FITNESS_ROOM',

  // --- OUTSIDE & TERRAIN ---
  'BALCONY_TERRACE',
  'PATIO_DECK',
  'GARDEN_YARD',
  'SWIMMING_POOL_AREA',

  // --- STORAGE, PARKING & UTILITIES ---
  'STORAGE_ROOM',
  'GARAGE_PARKING',
  'UTILITY_BOILER_ROOM',

  // --- FALLBACK ---
  'OTHER'
]);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    
    apartmentId: uuid('apartment_id')
      .notNull()
      .references(() => apartments.id, { onDelete: 'cascade' }),
    
    name: varchar('name', { length: 255 }).notNull(),
    
    category: assetCategoryEnum('category').notNull(),
    roomLocation: roomLocationEnum('room_location').notNull(),
    
    description: text('description'),
    
    photoProofRequirement: photoProofRequirementEnum('photo_proof_requirement')
      .default('SWEEP_ONLY')
      .notNull(),
    
    approximateValueCents: integer('approximate_value_cents'),
    
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_active_apartment_room').on(
      table.apartmentId,
      table.roomLocation,
      table.isActive
    ),
  ]
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export const SelectAssetSchema = createSelectSchema(assets);
export const InsertAssetSchema = createInsertSchema(assets);