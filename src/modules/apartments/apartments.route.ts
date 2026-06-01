import { OpenAPIHono } from "@hono/zod-openapi";

import {
  getApartmentsRoute,
  getApartmentByIdRoute,
  createApartmentRoute,
} from "./apartments.contract";

import { apartmentsService } from "./apartments.service";
import { App } from "@/types";

const app = new OpenAPIHono<App>();

app.openapi(getApartmentsRoute, async (c) => {
  const db = c.get("db");
  const apartments = await apartmentsService.getAll(db);

  return c.json(apartments, 200);
});

app.openapi(getApartmentByIdRoute, async (c) => {
    const db = c.get("db");
  const { id } = c.req.valid("param");

  const apartment = await apartmentsService.getById(db, id);

  if (!apartment) {
    return c.json({ message: "Not found" }, 404);
  }

  return c.json(apartment, 200);
});

app.openapi(createApartmentRoute, async (c) => {
    const db = c.get("db");
  const body = c.req.valid("json");

  const apartment = await apartmentsService.create(db, body);

  return c.json(apartment, 201);
});

export default app;
