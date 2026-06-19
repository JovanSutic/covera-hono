import { createRoute, z } from "@hono/zod-openapi";

import {
  ApartmentSchema,
  ApartmentsListSchema,
  CreateApartmentSchema,
} from "./apartments.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";
import { commonErrors } from "@/core/errors/error.helpers";

const apartmentErrors = commonErrors.getStandardResponses("Apartment");

export const getApartmentsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Apartments"],
  middleware: [authGuard] as const,
  responses: {
    200: {
      description: "List apartments",
      content: {
        "application/json": {
          schema: ApartmentsListSchema,
        },
      },
    },
    ...apartmentErrors,
  },
});

export const getApartmentByIdRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Apartments"],
  middleware: [authGuard] as const,
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
    ...apartmentErrors,
  },
});

export const createApartmentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Apartments"],
  middleware: [authGuard, rolesGuard(["admin"])] as const,
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
    ...apartmentErrors,
  },
});
