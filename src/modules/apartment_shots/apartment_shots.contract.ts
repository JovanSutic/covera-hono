import { createRoute } from "@hono/zod-openapi";

import {
  ApartmentParamSchema,
  ApartmentShotsListSchema,
  SyncApartmentShotsSchema,
} from "./apartment_shots.schema";
import { authGuard } from "@/middleware/authGuard";
import { commonErrors } from "@/core/errors/error.helpers";
import { rolesGuard } from "@/middleware/roleGuard";

const shotErrors = commonErrors.getStandardResponses("ApartmentShot");

export const getShotsByApartmentRoute = createRoute({
  method: "get",
  path: "/apartment/{apartmentId}",
  tags: ["Apartment Shots"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: ApartmentParamSchema,
  },
  responses: {
    200: {
      description: "List all configured shots for an apartment with their attached assets",
      content: {
        "application/json": {
          schema: ApartmentShotsListSchema,
        },
      },
    },
    ...shotErrors,
  },
});

export const syncApartmentShotsRoute = createRoute({
  method: "put",
  path: "/apartment/{apartmentId}",
  tags: ["Apartment Shots"],
  middleware: [authGuard, rolesGuard(["host"])] as const,
  request: {
    params: ApartmentParamSchema,
    body: {
      content: {
        "application/json": {
          schema: SyncApartmentShotsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Full apartment shot-to-asset matrix synced successfully",
      content: {
        "application/json": {
          schema: ApartmentShotsListSchema,
        },
      },
    },
    ...shotErrors,
  },
});