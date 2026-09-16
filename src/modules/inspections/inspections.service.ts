import { eq, inArray, sql } from "drizzle-orm";
import {
  inspections,
  inspectionFlags,
  inspectionFlagAssets,
  assets,
  Inspection,
  NewInspection,
  Asset,
} from "@/db";
import { Variables } from "@/types";
import type { DetailedInspection, VisitLogEvent } from "./inspections.schema";
import { CreateInspectionFlag, InspectionFlag } from "./inspectionFlags.schema";

export const inspectionsService = {
  async getByReservationId(
    db: Variables["db"],
    reservationId: string,
  ): Promise<Inspection | null> {
    const [inspection] = await db
      .select()
      .from(inspections)
      .where(eq(inspections.reservationId, reservationId));

    return inspection || null;
  },

  /**
   * Retrieves an inspection by ID.
   * Pass `detailed: true` to fetch the hydrated tree with reservation, shots, assets, and images.
   */
  async getById<T extends boolean = false>(
    db: Variables["db"],
    id: string,
    detailed?: T,
  ): Promise<(T extends true ? DetailedInspection : Inspection) | null> {
    // Non-detailed mode: Return pure database record
    if (!detailed) {
      const [inspection] = await db
        .select()
        .from(inspections)
        .where(eq(inspections.id, id));

      if (!inspection) return null;

      const baseInspection: Inspection = {
        id: inspection.id,
        reservationId: inspection.reservationId,
        visited: (inspection.visited as Inspection["visited"]) ?? [],
        createdAt: inspection.createdAt,
      };

      return baseInspection as T extends true ? DetailedInspection : Inspection;
    }

    // Detailed mode: Hydrate relational tree including flags
    const result = await db.query.inspections.findFirst({
      where: eq(inspections.id, id),
      with: {
        flags: {
          with: {
            flagAssets: {
              with: {
                asset: true,
              },
            },
          },
        },
        reservation: {
          with: {
            images: true,
            apartment: {
              with: {
                shots: {
                  with: {
                    shotAssets: {
                      with: {
                        asset: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!result || !result.reservation) return null;

    // Format junction array (flagAssets) to flat array of assets
    const formattedFlags = (result.flags || []).map((flag) => {
      const { flagAssets = [], ...flagData } = flag as typeof flag & {
        flagAssets?: Array<{ asset: any }>;
      };

      return {
        ...flagData,
        assets: flagAssets.map((fa) => fa.asset),
      };
    });

    const {
      apartment,
      images: reservationImages = [],
      ...reservationData
    } = result.reservation;

    const shots = (apartment?.shots || []).map((shot) => {
      const { shotAssets = [], ...shotData } = shot;
      return {
        ...shotData,
        images: (reservationImages || []).filter(
          (img) => img.shotId === shot.id,
        ),
        assets: shotAssets.map((pivot) => pivot.asset),
      };
    });

    const detailedInspection: DetailedInspection = {
      id: result.id,
      reservationId: result.reservationId,
      visited: (result.visited as Inspection["visited"]) ?? [],
      createdAt: result.createdAt,
      reservation: reservationData,
      shots,
      flags: formattedFlags as DetailedInspection["flags"],
    };

    return detailedInspection as T extends true
      ? DetailedInspection
      : Inspection;
  },

  async create(db: Variables["db"], data: NewInspection): Promise<Inspection> {
    const [createdInspection] = await db
      .insert(inspections)
      .values(data)
      .returning();

    return createdInspection;
  },

  /**
   * Creates an inspection flag attached to an inspection.
   * Handles linking provided assetIds via the junction table in a transaction.
   */
  async createFlag(
    db: Variables["db"],
    inspectionId: string,
    data: CreateInspectionFlag,
  ): Promise<InspectionFlag> {
    const { assetIds = [], ...flagData } = data;

    return await db.transaction(async (tx) => {
      // 1. Insert base flag
      const [insertedFlag] = await tx
        .insert(inspectionFlags)
        .values({
          ...flagData,
          inspectionId,
        })
        .returning();

      let linkedAssets: Asset[] = [];

      // 2. Batch-insert junction records if asset IDs were passed
      if (assetIds.length > 0) {
        const pivotRecords = assetIds.map((assetId) => ({
          flagId: insertedFlag.id, // Fixed column key
          assetId,
        }));

        await tx.insert(inspectionFlagAssets).values(pivotRecords);

        // Fetch corresponding assets for the output payload
        linkedAssets = await tx
          .select()
          .from(assets)
          .where(inArray(assets.id, assetIds));
      }

      return {
        ...insertedFlag,
        assets: linkedAssets,
      };
    });
  },

  /**
   * Appends a new VisitLogEvent object to the JSONB array if the userAgent
   * does not already exist in the visited log.
   */
  async recordVisit(
    db: Variables["db"],
    id: string,
    userAgent: string,
  ): Promise<boolean> {
    const logEvent: VisitLogEvent = {
      timestamp: new Date().toISOString(),
      userAgent,
    };

    const result = await db
      .update(inspections)
      .set({
        visited: sql`
          CASE 
            WHEN EXISTS (
              SELECT 1 FROM jsonb_array_elements(${inspections.visited}) elem 
              WHERE elem->>'userAgent' = ${userAgent}
            ) THEN ${inspections.visited}
            ELSE ${inspections.visited} || ${JSON.stringify(logEvent)}::jsonb
          END
        `,
      })
      .where(eq(inspections.id, id))
      .returning({ id: inspections.id });

    return result.length > 0;
  },
};
