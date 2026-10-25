import { createRoute } from "@hono/zod-openapi";

import {
  ApartmentParamSchema,
  AssetParamSchema,
  AssetSchema,
  AssetsListSchema,
  CreateAssetSchema,
  DeleteAssetResponseSchema,
} from "./assets.schema";
import { authGuard } from "@/middleware/authGuard";
import { errorResponses, AUTHED, ROLE, VALIDATION } from "@/core/errors/error.responses";
import { rolesGuard } from "@/middleware/roleGuard";

const getAssetsByApartmentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "APARTMENT_NOT_FOUND",
]);
const createAssetErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "APARTMENT_NOT_FOUND",
  "ASSET_TYPE_INVALID",
  "RELATED_RECORD_INVALID",
]);
const deleteAssetErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "ASSET_NOT_FOUND",
  "ASSET_LOCKED",
]);

export const getAssetsByApartmentRoute = createRoute({
  method: "get",
  path: "/apartment/{apartmentId}",
  tags: ["Assets"],
  middleware: [authGuard, rolesGuard(["admin","host"])] as const,
  request: {
    params: ApartmentParamSchema,
  },
  responses: {
    200: {
      description: "List all active assets for a specific apartment",
      content: {
        "application/json": {
          schema: AssetsListSchema,
        },
      },
    },
    ...getAssetsByApartmentErrors,
  },
});

export const createAssetRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Assets"],
  middleware: [authGuard, rolesGuard(["host"])] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateAssetSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Asset created successfully",
      content: {
        "application/json": {
          schema: AssetSchema,
        },
      },
    },
    ...createAssetErrors,
  },
});

export const deleteAssetRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Assets"],
  middleware: [authGuard, rolesGuard(["host"])] as const,
  request: {
    params: AssetParamSchema,
  },
  responses: {
    200: {
      description: "Asset soft-deleted successfully",
      content: {
        "application/json": {
          schema: DeleteAssetResponseSchema,
        },
      },
    },
    ...deleteAssetErrors,
  },
});