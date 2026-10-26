import { createMiddleware } from "hono/factory";
import { App } from "@/types";
import { usersService } from "../modules/users/users.service";
import type { users } from "@/db/schema";
import { ForbiddenException, UnauthorizedException } from "@/core/errors/error.exceptions";

export type UserRole = (typeof users.$inferSelect)["role"];

export const rolesGuard = (allowedRoles: UserRole[]) => {
  return createMiddleware<App>(async (c, next) => {
    const db = c.get("db");
    const authUser = c.get("authUser");

    if (!authUser) {
      throw new UnauthorizedException({
        code: "AUTH_TOKEN_MISSING",
        message: "Authentication is required for this endpoint. Provide a Bearer token.",
        meta: { origin: "GUARD" },
      });
    }

    const dbUser = await usersService.getByAuthId(db, authUser.id);

    if (!dbUser || !allowedRoles.includes(dbUser.role as UserRole) || dbUser.status !== "confirmed") {
      throw new ForbiddenException({
        code: "FORBIDDEN_ROLE",
        message:
          `This endpoint is only available to: ${allowedRoles.join(", ")}. ` +
          `Your role is '${dbUser?.role ?? "unknown"}'.`,
        meta: { origin: "GUARD", role: dbUser?.role, status: dbUser?.status },
      });
    }

    c.set("user", dbUser);

    await next();
  });
};
