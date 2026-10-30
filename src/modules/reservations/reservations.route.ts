import { createModuleApp } from "@/core/utils/module-app";
import {
  getReservationsByApartmentRoute,
  getReservationByIdRoute,
  createReservationRoute,
  updateReservationRoute,
  deleteReservationRoute,
} from "./reservations.contract";
import { reservationsService } from "./reservations.service";
import { reservationErrors } from "./reservations.errors";
import {
  assertApartmentOwnership,
  assertNoOverlappingReservation,
  checkExistence,
} from "@/core/utils/db-validator";

const app = createModuleApp();

app.openapi(getReservationsByApartmentRoute, async (c) => {
  const db = c.get("db");
  const { apartmentId } = c.req.valid("param");
  const query = c.req.valid("query");

  await checkExistence(db, "apartments", apartmentId);

  const paginatedReservations = await reservationsService.getByApartmentId(
    db,
    apartmentId,
    query,
  );

  return c.json(paginatedReservations, 200);
});

// Keep the list route ahead of this one: "/apartment/{apartmentId}" and "/{id}" do not
// conflict (the list has a static first segment), but declaring the static path first
// keeps the reading order matching the contract's order.
app.openapi(getReservationByIdRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");
  const user = c.get("user");

  if (!user) {
    throw reservationErrors.unauthenticated();
  }

  const reservation = await reservationsService.getById(db, id);

  if (!reservation) {
    throw reservationErrors.notFound({ id });
  }

  // D5: ownership is asserted here rather than by apartmentGuard(true), because that
  // guard resolves an unknown id through the apartments table first and would report
  // APARTMENT_NOT_FOUND for a reservation that simply does not exist.
  await assertApartmentOwnership(db, reservation.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  const withInspection = await reservationsService.getByIdWithInspection(db, id);

  if (!withInspection) {
    throw reservationErrors.notFound({ id });
  }

  return c.json(withInspection, 200);
});

app.openapi(createReservationRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const user = c.get("user");

  if (!user) {
    throw reservationErrors.unauthenticated();
  }

  await assertApartmentOwnership(db, body.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  await assertNoOverlappingReservation(db, {
    apartmentId: body.apartmentId,
    checkInDatetime: body.checkInDatetime,
    checkOutDatetime: body.checkOutDatetime,
    alternativeCheckInDatetime: body.alternativeCheckInDatetime,
    alternativeCheckOutDatetime: body.alternativeCheckOutDatetime,
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
    throw reservationErrors.notFound({ id });
  }

  return c.json(updatedReservation, 200);
});

app.openapi(deleteReservationRoute, async (c) => {
  const db = c.get("db");
  const { id } = c.req.valid("param");

  const result = await reservationsService.delete(db, id);

  if (!result) {
    throw reservationErrors.notFound({ id });
  }

  return c.json(result, 200);
});

export default app;
