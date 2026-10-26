import { z } from "@hono/zod-openapi";

import {
  SelectAssetSchema,
  SelectAssetTypeSchema,
  InsertAssetSchema,
} from "@/db";

export const AssetTypeSchema = SelectAssetTypeSchema.openapi("AssetType");

export const AssetSchema = SelectAssetSchema.extend({
  asset_type: AssetTypeSchema,
}).openapi("Asset");

export const AssetsListSchema = z.array(AssetSchema).openapi("AssetsList");

export const CreateAssetSchema = InsertAssetSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  isActive: true,
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


// Export the inferred Zod type instead of Drizzle's $inferSelect
export type Asset = z.infer<typeof AssetSchema>;

export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetTypesListSchema = z.array(AssetTypeSchema).openapi("AssetTypesList");