import { 
  pgTable, 
  uuid, 
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';
import { assetCategoryEnum } from './asset-enums';
import { createSelectSchema } from 'drizzle-zod';

export const assetTypes = pgTable('asset_types', {
  id: uuid('id').defaultRandom().primaryKey(),
  
  // Stable system key for developer reference & analytics (e.g., 'TELEVISION', 'SMART_LOCK')
  code: varchar('code', { length: 100 }).notNull().unique(),
  
  // Category belongs here so hosts never have to pick it manually
  category: assetCategoryEnum('category').notNull(),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const SelectAssetTypeSchema = createSelectSchema(assetTypes);
