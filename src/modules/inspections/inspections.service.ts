import { eq, sql } from "drizzle-orm";
import { inspections, Inspection, NewInspection } from "@/db";
import { Variables } from "@/types";
import type { DetailedInspection, VisitLogEvent } from "./inspections.schema";

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
    if (!detailed) {
      const [inspection] = await db
        .select()
        .from(inspections)
        .where(eq(inspections.id, id));

      return (inspection || null) as T extends true
        ? DetailedInspection
        : Inspection;
    }

    const result = await db.query.inspections.findFirst({
      where: eq(inspections.id, id),
      with: {
        reservation: {
          with: {
            images: true, // Fetch reservation photos to group into shots
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

    if (!result) return null;

    // Destructure images off reservation so they aren't present in reservationData
    const {
      apartment,
      images: reservationImages = [],
      ...reservationData
    } = result.reservation;

    // Group reservation images inside their respective shots
    const shots = (apartment?.shots || []).map((shot) => {
      const { shotAssets, ...shotData } = shot;
      return {
        ...shotData,
        // Assign only the images belonging to this specific shot
        images: reservationImages.filter((img) => img.shotId === shot.id),
        assets: (shotAssets || []).map((pivot) => pivot.asset),
      };
    });

    const detailedInspection: DetailedInspection = {
      id: result.id,
      reservationId: result.reservationId,
      visited: result.visited,
      createdAt: result.createdAt,
      reservation: reservationData,
      shots,
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
