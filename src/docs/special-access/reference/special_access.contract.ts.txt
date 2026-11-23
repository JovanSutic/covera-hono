import { createRoute } from "@hono/zod-openapi";
import {
  AccessIdParamSchema,
  CreateSpecialAccessResponseSchema,
  CreateSpecialAccessSchema,
  RevokeSpecialAccessResponseSchema,
} from "./special_access.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";
import {
  errorResponses,
  AUTHED,
  ROLE,
  APARTMENT_SCOPED,
  VALIDATION,
} from "@/core/errors/error.responses";

/*
 * The management surface. Both routes are session-only: a token can never mint or
 * revoke a token (D16), which is why neither declares any `SPECIAL_ACCESS_*` code
 * — a request carrying `?accessId=` here is simply ignored, because these routes
 * do not mount `specialAccessGuard`.
 *
 * Ownership is asserted in the handler through the subject's apartment (D16),
 * reusing `assertApartmentOwnership` exactly as `incidents.route.ts` does, so
 * `...APARTMENT_SCOPED` is declared here as it is there.
 */

const createSpecialAccessErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
  "INCIDENT_ITEM_NOT_FOUND",
]);

const revokeSpecialAccessErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "SPECIAL_ACCESS_NOT_FOUND",
]);

/**
 * Mints a link. The response carries `accessId` — the only payload that does
 * (D14) — because the host has to relay it; no read route ever returns it.
 *
 * A `host` may mint only for an apartment they own; an `admin` may mint for any.
 */
export const createSpecialAccessRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Special access"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateSpecialAccessSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Access link created",
      content: {
        "application/json": {
          schema: CreateSpecialAccessResponseSchema,
        },
      },
    },
    ...createSpecialAccessErrors,
  },
});

/**
 * Cuts a link off. Idempotent: revoking an already-revoked grant is a 200 (D15),
 * so a retried call cannot look like a failure to a client that cannot tell a lost
 * response from a lost grant. An unknown token is a 404.
 *
 * The lookup is by `accessId`, not by row id, so it needs no `SPECIAL_ACCESS_NOT_FOUND`
 * existence oracle beyond the 404 the route already declares.
 */
export const revokeSpecialAccessRoute = createRoute({
  method: "delete",
  path: "/{accessId}",
  tags: ["Special access"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: AccessIdParamSchema,
  },
  responses: {
    200: {
      description: "Access link revoked",
      content: {
        "application/json": {
          schema: RevokeSpecialAccessResponseSchema,
        },
      },
    },
    ...revokeSpecialAccessErrors,
  },
});
