import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { getEnv } from './src/env';

const env = getEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/*",
  out: "./drizzle",
  dbCredentials: {
    url: env.DATABASE_URL!,
  },
});
