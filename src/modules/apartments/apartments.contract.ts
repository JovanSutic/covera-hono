import { createRoute, z } from "@hono/zod-openapi";

import {
  ApartmentSchema,
  ApartmentsListSchema,
  CreateApartmentSchema,
} from "./apartments.schema";

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

export const getApartmentByIdRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Apartments"],

  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },

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
      description: "Apartment not found",
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
      description: "Apartment created",
      content: {
        "application/json": {
          schema: ApartmentSchema,
        },
      },
    },
  },
});