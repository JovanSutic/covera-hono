import { eq } from "drizzle-orm";
import type { User } from "@/db";
import { users } from "@/db/schema";
import { Variables } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "@hono/zod-openapi";
import { CreateUserSchema } from "./users.schema";

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const usersService = {
  async getAll(db: Variables["db"]): Promise<User[]> {
    return db.select().from(users);
  },

  async getById(
    db: Variables["db"],
    id: string,
  ): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, id));

    return user ?? null;
  },

  async getByAuthId(
    db: Variables["db"],
    authId: string,
  ): Promise<User | null> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.authId, authId));

    return user ?? null;
  },

  async create(
    db: Variables["db"],
    supabase: SupabaseClient,
    input: CreateUserInput,
  ): Promise<User> {

    const { data, error } =
      await supabase.auth.admin.createUser({
        email: input.email,
        email_confirm: false,
      });

    if (error || !data.user) {
      throw new Error(
        error?.message ?? "Failed to create auth user",
      );
    }

    try {
      const [created] = await db
        .insert(users)
        .values({
          authId: data.user.id,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          role: input.role,
          status: "created",
        })
        .returning();

      return created;
    } catch (err) {
      await supabase.auth.admin.deleteUser(
        data.user.id,
      );

      throw err;
    }
  },
};