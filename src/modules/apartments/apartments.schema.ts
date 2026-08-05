import { z } from "@hono/zod-openapi";

import {
  SelectApartmentSchema,
  InsertApartmentSchema,
  SelectLocationSchema,
} from "@/db";

export const ApartmentSchema = SelectApartmentSchema.openapi("Apartment");

export const LocationSchema = SelectLocationSchema.openapi("Location");

export const ApartmentWithLocationSchema = SelectApartmentSchema.extend({
  location: LocationSchema,
}).openapi("ApartmentWithLocation");

export const ApartmentsListSchema = z
  .array(ApartmentWithLocationSchema)
  .openapi("ApartmentsList");

export const ApartmentsWithLocationListSchema = ApartmentsListSchema;

export const CreateApartmentSchema = InsertApartmentSchema.omit({
  id: true,
  createdAt: true,
}).openapi("CreateApartment");

export const RequestUploadTokensSchema = z.object({
  fileTypes: z
    .array(
      z
        .string()
        .regex(
          /^image\/(jpeg|png|webp|jpg)$/,
          "Only JPEG, PNG, and WebP are allowed",
        ),
    )
    .min(1, "Must request at least one upload token"),
});

export const UploadTokensResponseSchema = z.object({
  tokens: z.array(
    z.object({
      uploadUrl: z.string().url(),
      key: z.string(),
    }),
  ),
});

export const ConfirmUploadBodySchema = z.object({
  uploadedKeys: z
    .array(z.string())
    .min(1, "Must confirm at least one uploaded photo storage key"),
});

export const ConfirmUploadResponseSchema = z.object({
  success: z.boolean(),
  activeCount: z.number(),
});