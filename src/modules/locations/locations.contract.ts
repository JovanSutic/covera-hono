import { createRoute } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";

import {
  LocationSchema,
  GetLocationsResponseSchema,
  CreateLocationSchema,
} from "./locations.schema";

/**
 * GET /locations
 */
export const getLocationsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Locations"],

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

/**
 * POST /locations
 */
export const createLocationRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Locations"],

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