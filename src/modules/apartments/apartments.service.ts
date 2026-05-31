import { eq } from "drizzle-orm";

import {
  db,
  apartments,
  type Apartment,
  type NewApartment,
} from "@/db";

export const apartmentsService = {
  async getAll(): Promise<Apartment[]> {
    return db.select().from(apartments);
  },

  async getById(id: string): Promise<Apartment | null> {
    const [apartment] = await db
      .select()
      .from(apartments)
      .where(eq(apartments.id, id));

    return apartment ?? null;
  },

  async create(
    apartment: NewApartment,
  ): Promise<Apartment> {
    const [createdApartment] = await db
      .insert(apartments)
      .values(apartment)
      .returning();

    return createdApartment;
  },
};