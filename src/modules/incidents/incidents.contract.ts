import { createRoute } from "@hono/zod-openapi";
import {
  CreateIncidentBodySchema,
  CreateIncidentResponseSchema,
  IncidentParamSchema,
  IncidentSchema,
  IncidentWithItemsSchema,
} from "./incidents.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";
import {
  errorResponses,
  AUTHED,
  ROLE,
  APARTMENT_SCOPED,
  VALIDATION,
} from "@/core/errors/error.responses";

const createIncidentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
  "ASSET_NOT_FOUND",
  "INCIDENT_WINDOW_EXPIRED",
  "ASSET_NOT_IN_APARTMENT",
  "INCIDENT_ALREADY_EXISTS",
]);

const getIncidentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "INCIDENT_NOT_FOUND",
]);

const confirmFilingErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "INCIDENT_NOT_FOUND",
  "INCIDENT_NOT_READY",
  "INCIDENT_ALREADY_FILED",
]);

/**
 * Host opens a claim for a reservation's damaged or stolen assets.
 *
 * The response is the ONE payload that carries each item's `cleanerToken` —
 * the host relays it to the cleaner out of band (D11).
 */
export const createIncidentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateIncidentBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Incident created successfully",
      content: {
        "application/json": {
          schema: CreateIncidentResponseSchema,
        },
      },
    },
    ...createIncidentErrors,
  },
});

/**
 * The claim, hydrated with its items, their assets and their evidence.
 * Never carries a `cleanerToken` (D11).
 */
export const getIncidentRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentParamSchema,
  },
  responses: {
    200: {
      description: "Incident fetched successfully",
      content: {
        "application/json": {
          schema: IncidentWithItemsSchema,
        },
      },
    },
    ...getIncidentErrors,
  },
});

/**
 * Trigger C — starts the 24-hour guest response clock. Only legal once every
 * item has its photos, and only once.
 */
export const confirmAirbnbFilingRoute = createRoute({
  method: "post",
  path: "/{id}/confirm-airbnb-filing",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentParamSchema,
  },
  responses: {
    200: {
      description: "Claim filed with the resolution centre; the guest clock has started",
      content: {
        "application/json": {
          schema: IncidentSchema,
        },
      },
    },
    ...confirmFilingErrors,
  },
});
