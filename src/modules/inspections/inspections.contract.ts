import { createRoute, z } from "@hono/zod-openapi";
import {
  CreateInspectionSchema,
  DetailedInspectionSchema,
  GetInspectionQuerySchema,
  InspectionParamSchema,
  InspectionSchema,
  PingInspectionResponseSchema,
  ReservationParamSchema,
} from "./inspections.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";
import { commonErrors } from "@/core/errors/error.helpers";

const inspectionErrors = commonErrors.getStandardResponses("Inspection");

/**
 * Host creates an inspection for a given reservation
 */
export const createInspectionRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Inspections"],
  middleware: [authGuard, rolesGuard(["host"])] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateInspectionSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Inspection created successfully",
      content: {
        "application/json": {
          schema: InspectionSchema,
        },
      },
    },
    ...inspectionErrors,
  },
});

/**
 * Public route opened by guest (or host preview) to retrieve inspection details.
 * Unauthenticated so guests can view without logging in.
 */
export const getInspectionByIdRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Inspections"],
  request: {
    params: InspectionParamSchema,
    query: GetInspectionQuerySchema,
  },
  responses: {
    200: {
      description: "Inspection fetched successfully",
      content: {
        "application/json": {
          schema: z.union([InspectionSchema, DetailedInspectionSchema]),
        },
      },
    },
    ...inspectionErrors,
  },
});

/**
 * Host retrieves inspection details by reservation ID
 */
export const getInspectionByReservationRoute = createRoute({
  method: "get",
  path: "/reservation/{reservationId}",
  tags: ["Inspections"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: ReservationParamSchema,
  },
  responses: {
    200: {
      description: "Inspection retrieved by reservation ID",
      content: {
        "application/json": {
          schema: InspectionSchema,
        },
      },
    },
    ...inspectionErrors,
  },
});

/**
 * Unauthenticated client-side ping triggered when guest mounts the view page.
 * Bypasses tracking if request carries an authenticated host session.
 */
export const pingInspectionRoute = createRoute({
  method: "post",
  path: "/{id}/ping",
  tags: ["Inspections"],
  request: {
    params: InspectionParamSchema,
  },
  responses: {
    200: {
      description: "Inspection ping processed successfully",
      content: {
        "application/json": {
          schema: PingInspectionResponseSchema,
        },
      },
    },
    ...inspectionErrors,
  },
});
