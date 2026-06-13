import { createMiddleware } from "hono/factory";
import { App } from "@/types";
import { usersService } from "../modules/users/users.service";
import type { users } from "@/db/schema";

export type UserRole = (typeof users.$inferSelect)["role"];

export const rolesGuard = (allowedRoles: UserRole[]) => {
  return createMiddleware<App>(async (c, next) => {
    const db = c.get("db");
    const authUser = c.get("authUser");

    if (!authUser) {
      return c.json({ message: "Unauthorized: Authentication missing" }, 401);
    }

    const dbUser = await usersService.getByAuthId(db, authUser.id);

    if (
      !dbUser ||
      !allowedRoles.includes(dbUser.role as UserRole) ||
      dbUser.status !== "confirmed"
    ) {
      return c.json({ message: "Forbidden: Insufficient permissions for your role" }, 403);
    }

    c.set("user", dbUser);

    await next();
  });
};
