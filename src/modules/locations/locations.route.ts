import { OpenAPIHono } from "@hono/zod-openapi";
import { getLocationsRoute, createLocationRoute } from "./locations.contract";
import { locationsService } from "./locations.service";
import { App } from "@/types";

const app = new OpenAPIHono<App>();

app.openapi(getLocationsRoute, async (c) => {
  const db = c.get("db");
  const locations = await locationsService.getAll(db);
  return c.json(locations, 200);
});

app.openapi(createLocationRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");

  const location = await locationsService.create(db, body);

  return c.json(location, 201);
});

export default app;
