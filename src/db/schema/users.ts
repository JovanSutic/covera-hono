import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import {
  createInsertSchema,
  createSelectSchema,
} from "drizzle-zod";

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "host",
  "guest",
]);

export const userStatusEnum = pgEnum("user_status", [
  "created",
  "invited",
  "confirmed",
  "disabled",
]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),

  authId: uuid("auth_id").notNull().unique(),

  email: text("email").notNull().unique(),

  firstName: text("first_name").notNull(),

  lastName: text("last_name").notNull(),

  role: userRoleEnum("role")
    .notNull()
    .default("guest"),

  status: userStatusEnum("status")
    .notNull()
    .default("created"),

  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const SelectUserSchema = createSelectSchema(users);
export const InsertUserSchema = createInsertSchema(users);