import { createRoute, z } from "@hono/zod-openapi";
import {
  ReservationSchema,
  CreateReservationSchema,
  ReservationsListSchema,
} from "./reservations.schema";

/**
 * GET /reservations
 */
export const getReservationsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Reservations"],

  responses: {
    200: {
      description: "List reservations",
      content: {
        "application/json": {
          schema: ReservationsListSchema,
        },
      },
    },
  },
});

/**
 * GET /reservations/:id
 */
export const getReservationByIdRoute = createRoute({
  method: "get",
  path: "/{id}",

  request: {
    params: z.object({
      id: z.string(),
    }),
  },

  tags: ["Reservations"],

  responses: {
    200: {
      description: "Reservation detail",
      content: {
        "application/json": {
          schema: ReservationSchema,
        },
      },
    },

    404: {
      description: "Not found",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
          }),
        },
      },
    },
  },
});

/**
 * POST /reservations
 */
export const createReservationRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Reservations"],

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
      description: "Created reservation",
      content: {
        "application/json": {
          schema: ReservationSchema,
        },
      },
    },
    400: {
      description: "Bad request",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
          }),
        },
      },
    },
  },
});
