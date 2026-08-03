import { z } from "@hono/zod-openapi";

import {
  SelectAssetSchema,
  InsertAssetSchema,
} from "@/db";

export const AssetSchema = SelectAssetSchema.openapi("Asset");

export const AssetsListSchema = z.array(AssetSchema).openapi("AssetsList");

export const CreateAssetSchema = InsertAssetSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).openapi("CreateAsset");

export const AssetParamSchema = z.object({
  id: z.uuid().openapi({
    param: {
      name: "id",
      in: "path",
    },
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
});

export const ApartmentParamSchema = z.object({
  apartmentId: z.uuid().openapi({
    param: {
      name: "apartmentId",
      in: "path",
    },
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
});

export const DeleteAssetResponseSchema = z.object({
  success: z.boolean(),
  id: z.uuid(),
}).openapi("DeleteAssetResponse");