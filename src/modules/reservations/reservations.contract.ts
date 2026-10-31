import { createRoute } from "@hono/zod-openapi";
import {
  ApartmentParamSchema,
  CreateReservationSchema,
  DeleteReservationResponseSchema,
  PaginatedReservationsSchema,
  ReservationParamSchema,
  ReservationPhotosSchema,
  ReservationQuerySchema,
  ReservationSchema,
  ReservationWithInspectionSchema,
  UpdateReservationSchema,
} from "./reservations.schema";
import { authGuard } from "@/middleware/authGuard";
import { errorResponses, AUTHED, ROLE, APARTMENT_SCOPED, VALIDATION } from "@/core/errors/error.responses";
import { rolesGuard } from "@/middleware/roleGuard";
import { apartmentGuard } from "@/middleware/apartmentGuard";

const getReservationsByApartmentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
]);
const createReservationErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "APARTMENT_NOT_FOUND",
  "FORBIDDEN_APARTMENT_ACCESS",
  "RESERVATION_OVERLAP",
  "RESERVATION_INVALID_RANGE",
  "RELATED_RECORD_INVALID",
]);
const updateReservationErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
  "RESERVATION_OVERLAP",
  "RESERVATION_INVALID_RANGE",
]);
const deleteReservationErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
]);
const getReservationByIdErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
  "APARTMENT_NOT_FOUND",
  "FORBIDDEN_APARTMENT_ACCESS",
]);

/**
 * The photo read resolves the reservation, then asserts ownership against the
 * apartment it belongs to — so it declares exactly the same codes as the detail
 * route it sits beside, for the same reasons (`D5` in `reservations.route.ts`).
 */
export const getReservationPhotosRoute = createRoute({
  method: "get",
  path: "/{id}/photos",
  tags: ["Reservations"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: ReservationParamSchema,
  },
  responses: {
    200: {
      description: "The photo proofs submitted for this reservation",
      content: {
        "application/json": {
          schema: ReservationPhotosSchema,
        },
      },
    },
    ...getReservationByIdErrors,
  },
});

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
    query: ReservationQuerySchema,
  },
  responses: {
    200: {
      description: "List all reservations for a specific apartment with pagination and sorting",
      content: {
        "application/json": {
          schema: PaginatedReservationsSchema,
        },
      },
    },
    ...getReservationsByApartmentErrors,
  },
});

export const getReservationByIdRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Reservations"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: ReservationParamSchema,
  },
  responses: {
    200: {
      description: "A single reservation with its inspection",
      content: {
        "application/json": {
          schema: ReservationWithInspectionSchema,
        },
      },
    },
    ...getReservationByIdErrors,
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
    ...createReservationErrors,
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
    ...updateReservationErrors,
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
    ...deleteReservationErrors,
  },
});
