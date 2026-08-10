import { OpenAPIHono } from "@hono/zod-openapi";
import {
  getShotsByApartmentRoute,
  syncApartmentShotsRoute,
} from "./apartment_shots.contract";
import { apartmentShotsService } from "./apartment_shots.service";
import { checkExistence } from "@/core/utils/db-validator";
import { App } from "@/types";

const app = new OpenAPIHono<App>();

app.openapi(getShotsByApartmentRoute, async (c) => {
  const db = c.get("db");
  const { apartmentId } = c.req.valid("param");

  await checkExistence(db, "apartments", apartmentId);

  const shotsList = await apartmentShotsService.getByApartmentId(
    db,
    apartmentId
  );

  return c.json(shotsList, 200);
});

app.openapi(syncApartmentShotsRoute, async (c) => {
  const db = c.get("db");
  const { apartmentId } = c.req.valid("param");
  const body = c.req.valid("json");

  await checkExistence(db, "apartments", apartmentId);

  const updatedShots = await apartmentShotsService.syncShots(
    db,
    apartmentId,
    body.shots
  );

  return c.json(updatedShots, 200);
});



export default app;