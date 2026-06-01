import { eq } from "drizzle-orm";

import type { User, NewUser } from "@/db";
import { users } from "@/db/schema";
import { Variables } from "@/types";

export const usersService = {
  async getAll(db: Variables["db"]): Promise<User[]> {
    return db.select().from(users);
  },

  async getById(db: Variables["db"], id: string): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id));

    return user ?? null;
  },

  async create(db: Variables["db"], input: NewUser): Promise<User> {
    const [created] = await db
      .insert(users)
      .values(input)
      .returning();

    return created;
  },
};