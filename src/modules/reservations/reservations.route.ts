import { OpenAPIHono } from "@hono/zod-openapi";

import {
  getReservationsRoute,
  getReservationByIdRoute,
  createReservationRoute,
} from "./reservations.contract";

import { reservationsService } from "./reservations.service";

const app = new OpenAPIHono();

app.openapi(getReservationsRoute, (c) => {
  return c.json(reservationsService.getAll());
});

app.openapi(getReservationByIdRoute, (c) => {
  const { id } = c.req.valid("param");

  const reservation = reservationsService.getById(id);

  if (!reservation) {
    return c.json({ message: "Not found" }, 404);
  }

  return c.json(reservation, 200);
});

app.openapi(createReservationRoute, (c) => {
  const body = c.req.valid("json");

  // later replaced by auth middleware
  const guestUserId = "usr_1";

  try {
    const reservation = reservationsService.create(guestUserId, body);

    return c.json(reservation, 201);
  } catch (err: any) {
    return c.json({ message: String(err) }, 400);
  }
});


export default app;
