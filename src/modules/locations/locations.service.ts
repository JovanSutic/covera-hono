import type { Location, NewLocation } from "@/db";
import { locations } from "@/db/schema";

export const locationsService = {
  async getAll(db: any): Promise<Location[]> {
    return db.select().from(locations);
  },

  async create(db: any, input: NewLocation): Promise<Location> {
    const [created] = await db
      .insert(locations)
      .values(input)
      .returning();

    return created;
  },
};