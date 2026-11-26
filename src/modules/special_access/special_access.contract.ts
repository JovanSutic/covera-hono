import { createRoute } from "@hono/zod-openapi";
import {
  AccessIdParamSchema,
  CreateSpecialAccessResponseSchema,
  CreateSpecialAccessSchema,
  ListSpecialAccessQuerySchema,
  RevokeSpecialAccessResponseSchema,
  SpecialAccessIntrospectionSchema,
  SpecialAccessListSchema,
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
 * Introspection declares no `VALIDATION` and no `AUTHED`: `AccessIdParamSchema`'s
 * `accessId` is a bare `z.string()`, so a 400 cannot be produced, and the route
 * mounts no auth guard, so a 401 cannot either. Declaring a status a route cannot
 * produce is how a contract starts lying.
 */
const specialAccessIntrospectionErrors = errorResponses([
  "SPECIAL_ACCESS_INVALID",
  "INTERNAL_SERVER_ERROR",
]);

const listSpecialAccessErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
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

/**
 * What is behind this link, for a caller who has nothing else (D21, D22).
 *
 * ANONYMOUS BY DESIGN: the `accessId` in the path is the credential, exactly as
 * the token in `/field/ingest/{token}` is. Requiring a bearer session would make
 * this useless to the one caller it exists for — a frontend route guard that
 * validates a link before the page renders, for a visitor who has no account.
 *
 * Resolution is `resolveByToken`, the REDEMPTION lookup, which collapses unknown,
 * expired and revoked to `null`. All three therefore become one 403
 * `SPECIAL_ACCESS_INVALID`, so the route is not an oracle for which links once
 * existed. `findByToken` — what revoke uses — would return revoked grants.
 *
 * A spent (`usedAt`) grant still answers 200 today; that is recorded as D23, and
 * the frontend never introspects the scope where it can happen.
 *
 * Same path as the DELETE above, different method, which Hono dispatches on —
 * this comment is the record that the ordering was checked rather than assumed.
 */
export const getSpecialAccessRoute = createRoute({
  method: "get",
  path: "/{accessId}",
  tags: ["Special access"],
  middleware: [] as const,
  request: {
    params: AccessIdParamSchema,
  },
  responses: {
    200: {
      description: "The grant behind this link",
      content: {
        "application/json": {
          schema: SpecialAccessIntrospectionSchema,
        },
      },
    },
    ...specialAccessIntrospectionErrors,
  },
});

/**
 * The links minted for one reservation (D24, D25).
 *
 * Session-only and host-authorized against the grant's OWN apartment, copying
 * `revokeSpecialAccessRoute`'s pattern rather than inventing one — which is what
 * stops a host listing another host's links.
 */
export const listSpecialAccessRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Special access"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    query: ListSpecialAccessQuerySchema,
  },
  responses: {
    200: {
      description: "The access links minted for this reservation",
      content: {
        "application/json": {
          schema: SpecialAccessListSchema,
        },
      },
    },
    ...listSpecialAccessErrors,
  },
});
