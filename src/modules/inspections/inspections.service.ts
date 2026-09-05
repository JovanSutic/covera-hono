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
            apartment: {
              with: {
                shots: {
                  with: {
                    apartmentShotAssets: {
                      with: {
                        asset: true,
                      },
                    },
                  },
                },
                images: true,
              },
            },
          },
        },
      },
    });

    if (!result) return null;

    const { apartment, ...reservationData } = result.reservation;

    // Flatten pivot join (apartmentShotAssets -> asset) to match ShotWithAssetsSchema
    const shots = (apartment?.shots || []).map((shot) => {
      const { apartmentShotAssets, ...shotData } = shot;
      return {
        ...shotData,
        assets: (apartmentShotAssets || []).map((pivot) => pivot.asset),
      };
    });

    const detailedInspection: DetailedInspection = {
      id: result.id,
      reservationId: result.reservationId,
      visited: result.visited,
      createdAt: result.createdAt,
      reservation: reservationData,
      shots,
      images: apartment?.images || [],
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
