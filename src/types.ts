import { createDb } from "./db";
import type { SupabaseClient } from "@supabase/supabase-js";

type Bindings = {
  DATABASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export type Variables = {
  db: ReturnType<typeof createDb>;
  supabase: SupabaseClient;
};

export type App = {
  Bindings: Bindings;
  Variables: Variables;
};
