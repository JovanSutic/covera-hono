import { pgTable, uuid, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const userRoleEnum = pgEnum("user_role", ["admin", "host", "guest"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),

  email: text("email").notNull().unique(),

  name: text("name").notNull(),

  roles: userRoleEnum("roles").array().notNull().default(["guest"]),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export const SelectUserSchema = createSelectSchema(users);
export const InsertUserSchema = createInsertSchema(users);
