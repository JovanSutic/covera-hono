import { createRoute } from "@hono/zod-openapi";
import {
  ApartmentParamSchema,
  CreateReservationSchema,
  DeleteReservationResponseSchema,
  ReservationParamSchema,
  ReservationSchema,
  ReservationsListSchema,
  UpdateReservationSchema,
} from "./reservations.schema";
import { authGuard } from "@/middleware/authGuard";
import { commonErrors } from "@/core/errors/error.helpers";
import { rolesGuard } from "@/middleware/roleGuard";
import { apartmentGuard } from "@/middleware/apartmentGuard";

const reservationErrors = commonErrors.getStandardResponses("Reservation");

export const getReservationsByApartmentRoute = createRoute({
  method: "get",
  path: "/apartment/{apartmentId}",
  tags: ["Reservations"],
  middleware: [
    authGuard,
    rolesGuard(["admin", "host"]),
    apartmentGuard(true),
  ] as const,
  request: {
    params: ApartmentParamSchema,
  },
  responses: {
    200: {
      description: "List all reservations for a specific apartment",
      content: {
        "application/json": {
          schema: ReservationsListSchema,
        },
      },
    },
    ...reservationErrors,
  },
});

export const createReservationRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Reservations"],
  middleware: [authGuard, rolesGuard(["host"])] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateReservationSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Reservation created successfully",
      content: {
        "application/json": {
          schema: ReservationSchema,
        },
      },
    },
    ...reservationErrors,
  },
});

export const updateReservationRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Reservations"],
  middleware: [authGuard, rolesGuard(["host"])] as const,
  request: {
    params: ReservationParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateReservationSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Reservation updated successfully",
      content: {
        "application/json": {
          schema: ReservationSchema,
        },
      },
    },
    ...reservationErrors,
  },
});

export const deleteReservationRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Reservations"],
  middleware: [authGuard, rolesGuard(["host"])] as const,
  request: {
    params: ReservationParamSchema,
  },
  responses: {
    200: {
      description: "Reservation deleted successfully",
      content: {
        "application/json": {
          schema: DeleteReservationResponseSchema,
        },
      },
    },
    ...reservationErrors,
  },
});
