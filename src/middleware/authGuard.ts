import { createMiddleware } from "hono/factory";
import { App } from "@/types";

export const authGuard = createMiddleware<App>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return c.json({ message: "Unauthorized: Missing token" }, 401);
  }

  const supabase = c.get("supabase");
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return c.json({ message: "Unauthorized: Invalid token" }, 401);
  }

  c.set("authUser", user);

  await next();
});
