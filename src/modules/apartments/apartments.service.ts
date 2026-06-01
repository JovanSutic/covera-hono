import { eq } from "drizzle-orm";

import {
  apartments,
  type Apartment,
  type NewApartment,
} from "@/db";
import { Variables } from "@/types";

export const apartmentsService = {
  async getAll(db: Variables["db"]): Promise<Apartment[]> {
    return db.select().from(apartments);
  },

  async getById(db: Variables["db"], id: string): Promise<Apartment | null> {
    const [apartment] = await db
      .select()
      .from(apartments)
      .where(eq(apartments.id, id));

    return apartment ?? null;
  },

  async create(
    db: Variables["db"],
    apartment: NewApartment
  ): Promise<Apartment> {
    const [createdApartment] = await db
      .insert(apartments)
      .values(apartment)
      .returning();

    return createdApartment;
  },
};