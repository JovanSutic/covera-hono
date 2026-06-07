import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type SupabaseEnv = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export function createSupabaseAdmin(
  env: SupabaseEnv,
): SupabaseClient {
  return createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}