import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
});

export function getEnv() {
  return envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
  });
}