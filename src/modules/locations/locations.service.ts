import type { Location, NewLocation } from "@/db";
import { locations } from "@/db/schema";
import { Variables } from "@/types";

export const locationsService = {
  async getAll(db: Variables["db"]): Promise<Location[]> {
    return db.select().from(locations);
  },

  async create(db: Variables["db"], input: NewLocation): Promise<Location> {
    const [created] = await db
      .insert(locations)
      .values(input)
      .returning();

    return created;
  },
};