import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/index";

export const createDb = (databaseUrl: string) => {
  const client = postgres(databaseUrl);

  return drizzle(client, {schema});
};