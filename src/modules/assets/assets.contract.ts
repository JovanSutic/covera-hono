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
import { commonErrors } from "@/core/errors/error.helpers";
import { rolesGuard } from "@/middleware/roleGuard";

const assetErrors = commonErrors.getStandardResponses("Asset");

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
    ...assetErrors,
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
    ...assetErrors,
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
    ...assetErrors,
  },
});