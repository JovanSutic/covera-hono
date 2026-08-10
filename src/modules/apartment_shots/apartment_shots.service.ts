import { eq, inArray, and } from "drizzle-orm";
import {
  apartmentShots,
  apartmentShotAssets,
  ApartmentShot,
} from "@/db";
import { Variables } from "@/types";
import { SyncShotItemSchema } from "./apartment_shots.schema";
import { z } from "@hono/zod-openapi";

export type SyncShotItem = z.infer<typeof SyncShotItemSchema>;

export interface ApartmentShotWithAssets extends ApartmentShot {
  assetIds: string[];
}

export const apartmentShotsService = {
  async getByApartmentId(
    db: Variables["db"],
    apartmentId: string
  ): Promise<ApartmentShotWithAssets[]> {
    const shots = await db
      .select()
      .from(apartmentShots)
      .where(eq(apartmentShots.apartmentId, apartmentId))
      .orderBy(apartmentShots.roomLocation, apartmentShots.createdAt);

    if (shots.length === 0) {
      return [];
    }

    const shotIds = shots.map((s) => s.id);

    // Fetch all junction mappings for these shots
    const junctions = await db
      .select({
        shotId: apartmentShotAssets.shotId,
        assetId: apartmentShotAssets.assetId,
      })
      .from(apartmentShotAssets)
      .where(inArray(apartmentShotAssets.shotId, shotIds));

    // Map assetIds to their corresponding shots
    const assetMap = new Map<string, string[]>();
    for (const j of junctions) {
      const existing = assetMap.get(j.shotId) || [];
      existing.push(j.assetId);
      assetMap.set(j.shotId, existing);
    }

    return shots.map((shot) => ({
      ...shot,
      assetIds: assetMap.get(shot.id) || [],
    }));
  },

  /**
   * Reconciles the full shot-to-asset matrix for an apartment in a single transaction.
   * - Upserts (creates/updates) incoming shots.
   * - Deletes shots omitted from the incoming payload.
   * - Reconciles apartment_shot_assets junction records per shot (creates new, deletes removed).
   */
  async syncShots(
    db: Variables["db"],
    apartmentId: string,
    incomingShots: SyncShotItem[]
  ): Promise<ApartmentShotWithAssets[]> {
    return await db.transaction(async (tx) => {
      // 1. Fetch existing shots in DB for this apartment
      const existingShots = await tx
        .select({ id: apartmentShots.id })
        .from(apartmentShots)
        .where(eq(apartmentShots.apartmentId, apartmentId));

      const existingShotIds = existingShots.map((s) => s.id);

      // Separate incoming payload into items to update vs items to insert
      const incomingWithId = incomingShots.filter(
        (s): s is SyncShotItem & { id: string } => Boolean(s.id)
      );
      const incomingIds = incomingWithId.map((s) => s.id);

      // 2. Prune: Delete shots from DB that are not present in incoming payload
      const shotsToDelete = existingShotIds.filter(
        (id) => !incomingIds.includes(id)
      );

      if (shotsToDelete.length > 0) {
        // First delete junction rows (if DB lacks cascade)
        await tx
          .delete(apartmentShotAssets)
          .where(inArray(apartmentShotAssets.shotId, shotsToDelete));

        // Delete shot records
        await tx
          .delete(apartmentShots)
          .where(inArray(apartmentShots.id, shotsToDelete));
      }

      // 3. Upsert Shots & Reconcile Junctions
      for (const item of incomingShots) {
        let shotId: string;

        if (item.id) {
          // UPDATE existing shot metadata
          const [updated] = await tx
            .update(apartmentShots)
            .set({
              roomLocation: item.roomLocation,
              shotType: item.shotType,
              title: item.title,
              instructions: item.instructions,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(apartmentShots.id, item.id),
                eq(apartmentShots.apartmentId, apartmentId)
              )
            )
            .returning({ id: apartmentShots.id });

          shotId = updated.id;
        } else {
          // INSERT new shot
          const [inserted] = await tx
            .insert(apartmentShots)
            .values({
              apartmentId,
              roomLocation: item.roomLocation,
              shotType: item.shotType,
              title: item.title,
              instructions: item.instructions,
            })
            .returning({ id: apartmentShots.id });

          shotId = inserted.id;
        }

        // 4. Reconcile Junction Records (apartment_shot_assets)
        const currentJunctions = await tx
          .select({ assetId: apartmentShotAssets.assetId })
          .from(apartmentShotAssets)
          .where(eq(apartmentShotAssets.shotId, shotId));

        const currentAssetIds = currentJunctions.map((j) => j.assetId);
        const desiredAssetIds = item.assetIds;

        // Assets to link (in payload, not in DB)
        const assetsToInsert = desiredAssetIds.filter(
          (aId) => !currentAssetIds.includes(aId)
        );

        // Assets to unlink (in DB, not in payload)
        const assetsToDelete = currentAssetIds.filter(
          (aId) => !desiredAssetIds.includes(aId)
        );

        if (assetsToDelete.length > 0) {
          await tx
            .delete(apartmentShotAssets)
            .where(
              and(
                eq(apartmentShotAssets.shotId, shotId),
                inArray(apartmentShotAssets.assetId, assetsToDelete)
              )
            );
        }

        if (assetsToInsert.length > 0) {
          await tx.insert(apartmentShotAssets).values(
            assetsToInsert.map((assetId) => ({
              shotId,
              assetId,
            }))
          );
        }
      }

      // 5. Return updated list using full fetch helper within transaction
      const updatedShots = await tx
        .select()
        .from(apartmentShots)
        .where(eq(apartmentShots.apartmentId, apartmentId))
        .orderBy(apartmentShots.roomLocation, apartmentShots.createdAt);

      if (updatedShots.length === 0) {
        return [];
      }

      const allShotIds = updatedShots.map((s) => s.id);
      const allJunctions = await tx
        .select({
          shotId: apartmentShotAssets.shotId,
          assetId: apartmentShotAssets.assetId,
        })
        .from(apartmentShotAssets)
        .where(inArray(apartmentShotAssets.shotId, allShotIds));

      const assetMap = new Map<string, string[]>();
      for (const j of allJunctions) {
        const existing = assetMap.get(j.shotId) || [];
        existing.push(j.assetId);
        assetMap.set(j.shotId, existing);
      }

      return updatedShots.map((shot) => ({
        ...shot,
        assetIds: assetMap.get(shot.id) || [],
      }));
    });
  },
};