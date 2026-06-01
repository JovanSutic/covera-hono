import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { getEnv } from '../env';

const env = getEnv();

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient);
