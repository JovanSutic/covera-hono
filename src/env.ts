import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string(),
});

console.log("DATABASE_URL:", process.env.DATABASE_URL);

export const env = envSchema.parse(process.env);
