import { z } from "@hono/zod-openapi";
import {
  SelectInspectionFlagSchema,
  InsertInspectionFlagSchema,
  SelectAssetSchema,
} from "@/db";

// Base OpenAPI Model Representation
export const InspectionFlagSchema = SelectInspectionFlagSchema.extend({
  assets: z.array(SelectAssetSchema).default([]),
}).openapi("InspectionFlag");

// Request Payload Schema for Creating a Flag
export const CreateInspectionFlagSchema = InsertInspectionFlagSchema.omit({
  id: true,
  resolutionNotes: true,
  status: true,
  inspectionId: true,
  resolvedAt: true,
  resolvedByUserId: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    assetIds: z.array(z.uuid()).default([]),
  })
  .openapi("CreateInspectionFlag");

export type InspectionFlag = z.infer<typeof InspectionFlagSchema>;
export type CreateInspectionFlag = z.infer<typeof CreateInspectionFlagSchema>;