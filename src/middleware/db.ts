import { createMiddleware } from "hono/factory";
import { env } from "hono/adapter";
import { App } from "@/types";
import { createDb } from "@/db/client";

export const dbMiddleware = createMiddleware(async (c, next) => {
  const runtimeEnv = env<App["Bindings"]>(c);
  const databaseUrl = runtimeEnv.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL environment variable.");
  }
  const db = createDb(databaseUrl);

  c.set("db", db);

  await next();
});
