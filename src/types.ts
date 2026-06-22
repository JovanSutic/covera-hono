import { createDb } from "./db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@/db";
import { S3Client } from "@aws-sdk/client-s3";

export type Bindings = {
  R2_ENDPOINT_URL: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  DATABASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

export type Variables = {
  db: ReturnType<typeof createDb>;
  supabase: SupabaseClient;
  user?: User;
  authUser?: any;
  s3: S3Client;
  r2BucketName: string;
};

export type App = {
  Bindings: Bindings;
  Variables: Variables;
};
