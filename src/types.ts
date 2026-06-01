import { createDb } from "./db";

type Bindings = {
  DATABASE_URL: string;
};

export type Variables = {
  db: ReturnType<typeof createDb>;
};

export type App = {
  Bindings: Bindings;
  Variables: Variables;
};