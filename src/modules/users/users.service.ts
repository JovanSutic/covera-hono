import { and, eq, ilike, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import type { User } from "@/db";
import { users } from "@/db/schema";
import { Variables } from "@/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "@hono/zod-openapi";
import { CreateUserSchema, UserFilters } from "./users.schema";

type CreateUserInput = z.infer<typeof CreateUserSchema>;

export const usersService = {
  async getAll(db: Variables["db"], filters?: UserFilters): Promise<User[]> {
    const conditions = [];

    if (filters?.role) {
      conditions.push(eq(users.role, filters.role));
    }

    if (filters?.status) {
      conditions.push(eq(users.status, filters.status));
    }

    if (filters?.search) {
      conditions.push(
        or(
          ilike(users.firstName, `%${filters.search}%`),
          ilike(users.lastName, `%${filters.search}%`),
          ilike(users.email, `%${filters.search}%`),
        ),
      );
    }

    const query = db.select().from(users);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }

    return query;
  },

  async getById(db: Variables["db"], id: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.id, id));

    return user ?? null;
  },

  async getByAuthId(db: Variables["db"], authId: string): Promise<User | null> {
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
    const temporaryPassword = crypto.randomBytes(32).toString("hex");

    const { data, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: temporaryPassword,
      email_confirm: false,
    });

    if (error || !data.user) {
      throw new Error(error?.message ?? "Failed to create auth user");
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
      await supabase.auth.admin.deleteUser(data.user.id);

      throw err;
    }
  },

  async invite(
    db: Variables["db"],
    supabase: SupabaseClient,
    id: string,
  ): Promise<{ success: boolean } | null> {
    const userRecord = await this.getById(db, id);
    if (!userRecord) return null;

    const { data, error } = await supabase.auth.admin.inviteUserByEmail(
      userRecord.email,
      {
        redirectTo: "https://covera.josutic-sutic.workers.dev/update-password",
      },
    );

    if (error || !data.user) {
      throw new Error(
        error?.message ?? "Failed to dispatch automated invitation email",
      );
    }

    await db.update(users).set({ status: "invited" }).where(eq(users.id, id));

    return { success: true };
  },

  async updateStatusByAuthId(
    db: Variables["db"],
    authId: string,
    status: "created" | "invited" | "confirmed" | "disabled",
  ): Promise<User | null> {
    console.log("\n================ SERVICE DIAGNOSTIC START ================");
    console.log("1. Raw authId received:", JSON.stringify(authId));
    console.log("2. Status to apply:", status);

    const cleanAuthId = authId?.trim().toLowerCase();
    console.log("3. Cleaned authId:", cleanAuthId);

    if (!cleanAuthId) {
      console.error("❌ SERVICE ABORTED: cleanAuthId is null/empty!");
      console.log("================ SERVICE DIAGNOSTIC END ================\n");
      return null;
    }

    try {
      const rawCheck = await db.execute(
        sql`SELECT id, email, auth_id, status FROM users WHERE auth_id = ${cleanAuthId}::uuid`,
      );
      console.log(
        "4. RAW SQL check before update returned rows:",
        Array.from(rawCheck),
      );
    } catch (err: any) {
      console.error("❌ RAW SQL Check Error:", err.message);
    }

    console.log("5. Executing Drizzle UPDATE query...");
    let updated: User | undefined;

    try {
      const results = await db
        .update(users)
        .set({ status })
        .where(eq(users.authId, sql`${cleanAuthId}::uuid`))
        .returning();

      console.log("6. Drizzle update raw returning array:", results);
      updated = results[0];
    } catch (err: any) {
      console.error("❌ Drizzle UPDATE Query Threw Error:", err);
    }

    console.log("7. Final returned user object:", updated ?? null);
    console.log("================ SERVICE DIAGNOSTIC END ================\n");

    return updated ?? null;
  },
};
