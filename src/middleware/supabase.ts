import { createMiddleware } from "hono/factory";
import { env } from "hono/adapter"; // Crucial multi-runtime adapter
import { createSupabaseAdmin } from "@/lib/supabase";
import { App } from "@/types";

export const supabaseMiddleware = createMiddleware<App>(async (c, next) => {
  const runtimeEnv = env<App["Bindings"]>(c);

  const supabaseUrl = runtimeEnv.SUPABASE_URL;
  const supabaseServiceRole = runtimeEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRole) {
    throw new Error("Missing Supabase configuration environment variables.");
  }

  const supabase = createSupabaseAdmin({
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: supabaseServiceRole,
  });

  c.set("supabase", supabase);

  await next();
});
