import { createRoute } from "@hono/zod-openapi";

import {
  ApartmentParamSchema,
  ApartmentShotsListSchema,
  GetShotsQuerySchema,
  SyncApartmentShotsSchema,
} from "./apartment_shots.schema";
import { authGuard } from "@/middleware/authGuard";
import { errorResponses, AUTHED, ROLE, VALIDATION } from "@/core/errors/error.responses";
import { rolesGuard } from "@/middleware/roleGuard";
import { specialAccessGuard } from "@/middleware/specialAccessGuard";
import { AccessIdQuerySchema } from "../special_access/special_access.schema";

const getShotsByApartmentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "SPECIAL_ACCESS_INVALID",
  "SPECIAL_ACCESS_SCOPE_MISMATCH",
  "APARTMENT_NOT_FOUND",
  "RESERVATION_NOT_FOUND",
]);
const syncApartmentShotsErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "APARTMENT_NOT_FOUND",
  "APARTMENT_SHOTS_LOCKED",
  "RELATED_RECORD_INVALID",
]);

export const getShotsByApartmentRoute = createRoute({
  method: "get",
  path: "/apartment/{apartmentId}",
  tags: ["Apartment Shots"],
  middleware: [
    specialAccessGuard({
      scope: "inspection_proof",
      bind: { kind: "apartmentParam", param: "apartmentId" },
      roles: ["admin", "host"],
    }),
  ] as const,
  request: {
    params: ApartmentParamSchema,
    query: GetShotsQuerySchema.extend(AccessIdQuerySchema.shape),
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
    ...getShotsByApartmentErrors,
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
    ...syncApartmentShotsErrors,
  },
});