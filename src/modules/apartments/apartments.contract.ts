import { createRoute, z } from "@hono/zod-openapi";
import {
  ApartmentSchema,
  CreateApartmentSchema,
  ApartmentsListSchema,
} from "./apartments.schema";

/**
 * GET /apartments
 */
export const getApartmentsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Apartments"],

  responses: {
    200: {
      description: "List apartments",
      content: {
        "application/json": {
          schema: ApartmentsListSchema,
        },
      },
    },
  },
});

/**
 * GET /apartments/:id
 */
export const getApartmentByIdRoute = createRoute({
  method: "get",
  path: "/{id}",

  request: {
    params: z.object({
      id: z.string(),
    }),
  },

  tags: ["Apartments"],

  responses: {
    200: {
      description: "Apartment detail",
      content: {
        "application/json": {
          schema: ApartmentSchema,
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
 * POST /apartments
 */
export const createApartmentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Apartments"],

  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateApartmentSchema,
        },
      },
    },
  },

  responses: {
    201: {
      description: "Created apartment",
      content: {
        "application/json": {
          schema: ApartmentSchema,
        },
      },
    },
  },
});
