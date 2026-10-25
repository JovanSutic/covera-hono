import { createMiddleware } from "hono/factory";
import { env } from "hono/adapter";
import { App } from "@/types";
import { createDb } from "@/db/client";
import { AppError } from "@/core/errors/error.exceptions";

export const dbMiddleware = createMiddleware(async (c, next) => {
  const runtimeEnv = env<App["Bindings"]>(c);
  const databaseUrl = runtimeEnv.DATABASE_URL;

  if (!databaseUrl) {
    throw new AppError(500, {
      code: "HTTP_ERROR",
      message: "The service is not correctly configured and cannot serve requests right now.",
      meta: { origin: "BOOTSTRAP", missing: "DATABASE_URL" },
    });
  }
  const db = createDb(databaseUrl);

  c.set("db", db);

  await next();
});
