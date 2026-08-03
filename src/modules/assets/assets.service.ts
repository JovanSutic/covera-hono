import { eq, and } from "drizzle-orm";
import { assets, Asset, NewAsset } from "@/db";
import { Variables } from "@/types";

export const assetsService = {
  async getByApartmentId(
    db: Variables["db"],
    apartmentId: string
  ): Promise<Asset[]> {
    return db
      .select()
      .from(assets)
      .where(and(eq(assets.apartmentId, apartmentId), eq(assets.isActive, true)))
      .orderBy(assets.roomLocation, assets.name);
  },

  async create(
    db: Variables["db"],
    asset: NewAsset
  ): Promise<Asset> {
    const [createdAsset] = await db
      .insert(assets)
      .values(asset)
      .returning();

    return createdAsset;
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
};