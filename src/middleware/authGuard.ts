import { createMiddleware } from "hono/factory";
import { App } from "@/types";
import { UnauthorizedException } from "@/core/errors/error.exceptions";

export const authGuard = createMiddleware<App>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    throw new UnauthorizedException({
      code: "AUTH_TOKEN_MISSING",
      message: "Authentication is required for this endpoint. Provide a Bearer token.",
      meta: { origin: "GUARD" },
    });
  }

  const supabase = c.get("supabase");
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new UnauthorizedException({
      code: "AUTH_SESSION_EXPIRED",
      message: "Your session is invalid or has expired. Please sign in again.",
      meta: { origin: "GUARD" },
    });
  }

  c.set("authUser", user);

  await next();
});
