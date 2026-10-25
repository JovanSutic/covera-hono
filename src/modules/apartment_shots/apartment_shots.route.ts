import { OpenAPIHono } from "@hono/zod-openapi";
import {
  getShotsByApartmentRoute,
  syncApartmentShotsRoute,
} from "./apartment_shots.contract";
import { apartmentShotsService } from "./apartment_shots.service";
import { assertCanModifyApartmentShots, checkExistence } from "@/core/utils/db-validator";
import { App } from "@/types";
import { reservations } from "@/db";
import { NotFoundException } from "@/core/errors/error.exceptions";
import { reservationsService } from "../reservations/reservations.service";

const app = new OpenAPIHono<App>();

app.openapi(getShotsByApartmentRoute, async (c) => {
  const db = c.get("db");
  const { apartmentId } = c.req.valid("param");
  const { reservationId } = c.req.valid("query");

  await checkExistence(db, "apartments", apartmentId);

  let cutoffDate: Date | undefined;

  if (reservationId) {
    const reservation = await reservationsService.getById(db, reservationId);

    if (!reservation) {
      throw new NotFoundException({
        code: "RESERVATION_NOT_FOUND",
        message: "Reservation does not exist.",
        meta: { origin: "ROUTE", id: reservationId },
      });
    }

    cutoffDate = new Date(reservation.createdAt);
  }

  const shotsList = await apartmentShotsService.getByApartmentId(
    db,
    apartmentId,
    cutoffDate,
  );

  return c.json(shotsList, 200);
});

app.openapi(syncApartmentShotsRoute, async (c) => {
  const db = c.get("db");
  const { apartmentId } = c.req.valid("param");
  const body = c.req.valid("json");

  await checkExistence(db, "apartments", apartmentId);

  await assertCanModifyApartmentShots(db, apartmentId);

  const updatedShots = await apartmentShotsService.syncShots(
    db,
    apartmentId,
    body.shots,
  );

  return c.json(updatedShots, 200);
});

export default app;
