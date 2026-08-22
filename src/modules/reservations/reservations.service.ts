import { eq, desc } from "drizzle-orm";
import { reservations, Reservation, NewReservation } from "@/db";
import { Variables } from "@/types";

export const reservationsService = {
  async getByApartmentId(
    db: Variables["db"],
    apartmentId: string
  ): Promise<Reservation[]> {
    return db
      .select()
      .from(reservations)
      .where(eq(reservations.apartmentId, apartmentId))
      .orderBy(desc(reservations.checkInDatetime));
  },

  async getById(
    db: Variables["db"],
    id: string
  ): Promise<Reservation | null> {
    const [reservation] = await db
      .select()
      .from(reservations)
      .where(eq(reservations.id, id));

    return reservation || null;
  },

  async create(
    db: Variables["db"],
    reservation: NewReservation
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
    data: Partial<NewReservation>
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
    id: string
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