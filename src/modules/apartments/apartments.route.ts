import { OpenAPIHono } from "@hono/zod-openapi";

import {
  getApartmentsRoute,
  getApartmentByIdRoute,
  createApartmentRoute,
} from "./apartments.contract";

import { apartmentsService } from "./apartments.service";

const app = new OpenAPIHono();

app.openapi(getApartmentsRoute, async (c) => {
  const apartments = await apartmentsService.getAll();

  return c.json(apartments, 200);
});

app.openapi(getApartmentByIdRoute, async (c) => {
  const { id } = c.req.valid("param");

  const apartment = await apartmentsService.getById(id);

  if (!apartment) {
    return c.json({ message: "Not found" }, 404);
  }

  return c.json(apartment, 200);
});

app.openapi(createApartmentRoute, async (c) => {
  const body = c.req.valid("json");

  const apartment =
    await apartmentsService.create(body);

  return c.json(apartment, 201);
});

export default app;