import { OpenAPIHono } from "@hono/zod-openapi";
import {
  getApartmentsRoute,
  getApartmentByIdRoute,
  createApartmentRoute,
} from "./apartments.contract";

import { apartmentsService } from "./apartments.service";

const app = new OpenAPIHono();

app.openapi(getApartmentsRoute, (c) => {
  return c.json(apartmentsService.getAll());
});

app.openapi(getApartmentByIdRoute, (c) => {
  const { id } = c.req.valid("param");

  const apartment = apartmentsService.getById(id);

  if (!apartment) {
    return c.json({ message: "Not found" }, 404);
  }

  return c.json(apartment, 200);
});

app.openapi(createApartmentRoute, (c) => {
  const body = c.req.valid("json");

  // later: get from auth middleware
  const ownerId = "usr_2";

  const apartment = apartmentsService.create(ownerId, body);

  return c.json(apartment, 201);
});

export default app;
