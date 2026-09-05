import { eq, desc, asc, count, lt, gte, and } from "drizzle-orm";
import { reservations, Reservation, NewReservation } from "@/db";
import { Variables } from "@/types";
import type {
  ReservationQuery,
  PaginatedReservations,
} from "./reservations.schema"; // adjust path as needed

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
      db
        .select()
        .from(reservations)
        .where(whereClause)
        .orderBy(orderFn(sortColumn))
        .limit(limit)
        .offset(offset),
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
