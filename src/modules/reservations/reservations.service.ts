import { eq, desc, asc, count, lt, gte, and } from "drizzle-orm";
import { reservations, Reservation, NewReservation } from "@/db";
import { Variables } from "@/types";
import type {
  ReservationQuery,
  PaginatedReservations,
  ReservationWithInspection,
  ReservationPhotos,
} from "./reservations.schema"; // adjust path as needed
import { buildProofShots } from "@/core/utils/proof-shots";

const SORTABLE_COLUMNS = {
  checkInDatetime: reservations.checkInDatetime,
  checkOutDatetime: reservations.checkOutDatetime,
  createdAt: reservations.createdAt,
} as const;

export const reservationsService = {
  async getByApartmentId(
    db: Variables["db"],
    apartmentId: string,
    query: ReservationQuery,
  ): Promise<PaginatedReservations> {
    const { page, limit, sortBy, order, history } = query;
    const offset = (page - 1) * limit;

    const sortColumn = SORTABLE_COLUMNS[sortBy] ?? reservations.checkInDatetime;
    const orderFn = order === "asc" ? asc : desc;

    const now = new Date();

    // Filter strategy:
    // - history = true: return ALL reservations for the apartment (no time filter)
    // - history = false: return active/upcoming reservations only (checkOutDatetime >= now)
    const whereClause = history
      ? eq(reservations.apartmentId, apartmentId)
      : and(
          eq(reservations.apartmentId, apartmentId),
          gte(reservations.checkOutDatetime, now),
        );

    const [countResult, data] = await Promise.all([
      db.select({ total: count() }).from(reservations).where(whereClause),
      db.query.reservations.findMany({
        where: whereClause,
        orderBy: [orderFn(sortColumn)],
        limit,
        offset,
        with: {
          inspection: true,
        },
      }),
    ]);

    const totalItems = Number(countResult[0]?.total ?? 0);
    const totalPages = Math.ceil(totalItems / limit);

    return {
      data,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
      },
    };
  },

  async getById(db: Variables["db"], id: string): Promise<Reservation | null> {
    const [reservation] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, id));

    return reservation || null;
  },

  /**
   * One reservation with its inspection attached — the shape the reservation page
   * reads (D4). `getById` above deliberately stays relation-free: `apartmentGuard`
   * calls it for ownership resolution and needs only the row.
   */
  async getByIdWithInspection(
    db: Variables["db"],
    id: string,
  ): Promise<ReservationWithInspection | null> {
    const reservation = await db.query.reservations.findFirst({
      where: eq(reservations.id, id),
      with: {
        inspection: true,
      },
    });

    return reservation || null;
  },

  /**
   * The photos submitted FOR this reservation, in the same shape the inspection
   * tree exposes them (`ShotWithAssets[]`) so the host's photo dialog renders
   * either source with no branching.
   *
   * Why this exists: `apartment_images` is keyed by `reservationId`, but until this
   * read landed the ONLY route that exposed it was `GET /inspections/{id}?detailed`.
   * An inspection row is created by a separate host action that the backend refuses
   * before the reservation is COVERED — so a covered reservation with photos and no
   * inspection had them on disk and nowhere to read them.
   *
   * Deliberate choices, each load-bearing:
   * - JOINED in one query rather than three sequential reads: the images, the
   *   apartment's shots and each shot's assets are all keyed off data the first
   *   row already carries, so nothing here needs a second round trip.
   * - ONLY shots with at least one active image are returned. The inspection
   *   tree keeps unphotographed shots (its contract); a photo read that returned
   *   them would put empty cards in the dialog.
   * - `status: "active"` AND `deletedAt IS NULL`, the exact predicate
   *   `summarizeShotProofs` and `RoomPhotoItem` apply. Filtering in SQL means the
   *   client cannot count an image it will then refuse to render.
   */
  async getProofPhotos(
    db: Variables["db"],
    id: string,
  ): Promise<ReservationPhotos> {
    const reservation = await db.query.reservations.findFirst({
      where: eq(reservations.id, id),
      with: {
        images: true,
        apartment: {
          with: {
            shots: {
              with: {
                shotAssets: {
                  with: { asset: { with: { assetType: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!reservation || !reservation.apartment) return [];

    const activeImages = (reservation.images ?? []).filter(
      (image) => image.status === "active" && !image.deletedAt,
    );

    const photographedShotIds = new Set(activeImages.map((image) => image.shotId));

    return buildProofShots(
      reservation.apartment.shots.filter((shot) => photographedShotIds.has(shot.id)),
      activeImages,
    ) as ReservationPhotos;
  },

  async create(
    db: Variables["db"],
    reservation: NewReservation,
  ): Promise<Reservation> {
    const [createdReservation] = await db
      .insert(reservations)
      .values(reservation)
      .returning();

    return createdReservation;
  },

  async update(
    db: Variables["db"],
    id: string,
    data: Partial<NewReservation>,
  ): Promise<Reservation | null> {
    const [updatedReservation] = await db
      .update(reservations)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, id))
      .returning();

    return updatedReservation || null;
  },

  async delete(
    db: Variables["db"],
    id: string,
  ): Promise<{ success: boolean; id: string } | null> {
    const [deletedReservation] = await db
      .delete(reservations)
      .where(eq(reservations.id, id))
      .returning({ id: reservations.id });

    if (!deletedReservation) {
      return null;
    }

    return {
      success: true,
      id: deletedReservation.id,
    };
  },
};
