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
import { errorResponses, AUTHED, ROLE, VALIDATION } from "@/core/errors/error.responses";
import { CreateInspectionFlagSchema, InspectionFlagSchema } from "./inspectionFlags.schema";

const createInspectionErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
  "INSPECTION_ALREADY_EXISTS",
  "RESERVATION_NOT_COVERED",
  "INSPECTION_NO_PHOTO_PROOF",
  "INSPECTION_WINDOW_EXPIRED",
]);
const createInspectionFlagErrors = errorResponses([
  ...VALIDATION,
  "INSPECTION_NOT_FOUND",
  "FLAG_ALREADY_EXISTS",
  "FLAG_WINDOW_EXPIRED",
  "INTERNAL_SERVER_ERROR",
]);
const getInspectionByIdErrors = errorResponses([
  ...VALIDATION,
  "INSPECTION_NOT_FOUND",
  "INTERNAL_SERVER_ERROR",
]);
const getInspectionByReservationErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
  "INSPECTION_NOT_FOUND",
]);
const pingInspectionErrors = errorResponses([
  ...VALIDATION,
  "INSPECTION_NOT_FOUND",
  "INTERNAL_SERVER_ERROR",
]);

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
    ...createInspectionErrors,
  },
});

/**
 * Create a new flag against an inspection (e.g. reported by guest or host)
 */
export const createInspectionFlagRoute = createRoute({
  method: "post",
  path: "/{id}/flags",
  tags: ["Inspections"],
  request: {
    params: InspectionParamSchema,
    body: {
      content: {
        "application/json": {
          schema: CreateInspectionFlagSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Inspection flag created successfully",
      content: {
        "application/json": {
          schema: InspectionFlagSchema,
        },
      },
    },
    ...createInspectionFlagErrors,
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
    ...getInspectionByIdErrors,
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
    ...getInspectionByReservationErrors,
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
    ...pingInspectionErrors,
  },
});