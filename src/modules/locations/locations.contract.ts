import { createRoute } from "@hono/zod-openapi";
import {
  LocationSchema,
  GetLocationsResponseSchema,
  CreateLocationSchema,
} from "./locations.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";
import { errorResponses, AUTHED, ROLE, VALIDATION } from "@/core/errors/error.responses";

const locationErrors = errorResponses([...AUTHED, ...ROLE]);
const createLocationErrors = errorResponses([...AUTHED, ...ROLE, ...VALIDATION]);

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
    ...locationErrors,
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
    ...createLocationErrors,
  },
});