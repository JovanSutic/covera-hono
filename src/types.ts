import { createDb } from "./db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@/db";

type Bindings = {
  DATABASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export type Variables = {
  db: ReturnType<typeof createDb>;
  supabase: SupabaseClient;
  user?: User;
  authUser?: any;
};

export type App = {
  Bindings: Bindings;
  Variables: Variables;
};
