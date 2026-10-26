import { eq, and, asc } from "drizzle-orm";
import { assets, NewAsset, assetTypes } from "@/db";
import { Variables } from "@/types";
import { Asset, AssetType } from "./assets.schema";

export const assetsService = {
  async getByApartmentId(
    db: Variables["db"],
    apartmentId: string
  ): Promise<Asset[]> {
    // Perform a join so each result includes the nested asset_type object
    const rows = await db
      .select({
        asset: assets,
        assetType: assetTypes,
      })
      .from(assets)
      .innerJoin(assetTypes, eq(assets.assetTypeId, assetTypes.id))
      .where(and(eq(assets.apartmentId, apartmentId), eq(assets.isActive, true)))
      .orderBy(assets.roomLocation);

    return rows.map(({ asset, assetType }) => ({
      ...asset,
      asset_type: assetType,
    }));
  },

  async create(
    db: Variables["db"],
    asset: NewAsset
  ): Promise<Asset> {
    // 1. Insert into assets table
    const [createdAsset] = await db
      .insert(assets)
      .values(asset)
      .returning();

    // 2. Query the linked catalog row from asset_types
    const [catalogType] = await db
      .select()
      .from(assetTypes)
      .where(eq(assetTypes.id, createdAsset.assetTypeId));

    // 3. Return the composite object matching Promise<Asset>
    return {
      ...createdAsset,
      asset_type: catalogType,
    };
  },

  async delete(
    db: Variables["db"],
    id: string
  ): Promise<{ success: boolean; id: string } | null> {
    const [deletedAsset] = await db
      .update(assets)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(and(eq(assets.id, id), eq(assets.isActive, true)))
      .returning({ id: assets.id });

    if (!deletedAsset) {
      return null;
    }

    return {
      success: true,
      id: deletedAsset.id,
    };
  },

  async getAllTypes(db: Variables["db"]): Promise<AssetType[]> {
    return db
      .select()
      .from(assetTypes)
      .orderBy(asc(assetTypes.code));
  },
};