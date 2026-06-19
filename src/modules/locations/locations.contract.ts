import { createRoute } from "@hono/zod-openapi";
import {
  LocationSchema,
  GetLocationsResponseSchema,
  CreateLocationSchema,
} from "./locations.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";

export const getLocationsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Locations"],
  middleware: [authGuard, rolesGuard(["admin"])] as const,
  responses: {
    200: {
      description: "List locations",
      content: {
        "application/json": {
          schema: GetLocationsResponseSchema,
        },
      },
    },
  },
});

export const createLocationRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Locations"],
  middleware: [authGuard, rolesGuard(["admin"])] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateLocationSchema,
        },
      },
    },
  },

  responses: {
    201: {
      description: "Location created",
      content: {
        "application/json": {
          schema: LocationSchema,
        },
      },
    },
  },
});