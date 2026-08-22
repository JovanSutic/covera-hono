import { OpenAPIHono } from "@hono/zod-openapi";
import {
  getReservationsByApartmentRoute,
  createReservationRoute,
  updateReservationRoute,
  deleteReservationRoute,
} from "./reservations.contract";
import { reservationsService } from "./reservations.service";
import {
  NotFoundException,
  UnauthorizedException,
} from "@/core/errors/error.exceptions";
import {
  assertApartmentOwnership,
  checkExistence,
} from "@/core/utils/db-validator";
import { App } from "@/types";

const app = new OpenAPIHono<App>();

app.openapi(getReservationsByApartmentRoute, async (c) => {
  const db = c.get("db");
  const { apartmentId } = c.req.valid("param");

  await checkExistence(db, "apartments", apartmentId);

  const reservationsList = await reservationsService.getByApartmentId(
    db,
    apartmentId,
  );

  return c.json(reservationsList, 200);
});

app.openapi(createReservationRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const user = c.get("user");

  if (!user) {
    throw new UnauthorizedException("Reservation");
  }

  await assertApartmentOwnership(db, body.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  const newReservation = await reservationsService.create(db, body);

  return c.json(newReservation, 201);
});

app.openapi(updateReservationRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const updatedReservation = await reservationsService.update(db, id, body);

  if (!updatedReservation) {
    throw new NotFoundException("Reservation");
  }

  return c.json(updatedReservation, 200);
});

app.openapi(deleteReservationRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  const result = await reservationsService.delete(db, id);

  if (!result) {
    throw new NotFoundException("Reservation");
  }

  return c.json(result, 200);
});

export default app;
