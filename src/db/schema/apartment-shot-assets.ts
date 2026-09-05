import { pgTable, uuid, primaryKey, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { apartmentShots } from "./apartment-shots";
import { assets } from "./assets";

export const apartmentShotAssets = pgTable(
  "apartment_shot_assets",
  {
    shotId: uuid("shot_id")
      .notNull()
      .references(() => apartmentShots.id, { onDelete: "cascade" }),

    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.shotId, table.assetId] }),
    index("idx_shot_assets_asset").on(table.assetId),
  ],
);

export const apartmentShotAssetsRelations = relations(apartmentShotAssets, ({ one }) => ({
  shot: one(apartmentShots, {
    fields: [apartmentShotAssets.shotId],
    references: [apartmentShots.id],
  }),
  asset: one(assets, {
    fields: [apartmentShotAssets.assetId],
    references: [assets.id],
  }),
}));

export type ApartmentShotAsset = typeof apartmentShotAssets.$inferSelect;
export type NewApartmentShotAsset = typeof apartmentShotAssets.$inferInsert;