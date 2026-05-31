import { OpenAPIHono } from "@hono/zod-openapi";

import {
  getLocationsRoute,
  createLocationRoute,
} from "./locations.contract";

import { locationsService } from "./locations.service";

const app = new OpenAPIHono();

app.openapi(getLocationsRoute, async (c) => {
  const locations = await locationsService.getAll();
  return c.json(locations, 200);
});

app.openapi(createLocationRoute, async (c) => {
  const body = c.req.valid("json");

  const location = await locationsService.create(body);

  return c.json(location, 201);
});

export default app;