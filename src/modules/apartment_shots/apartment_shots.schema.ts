import { z } from "@hono/zod-openapi";
import { roomLocationEnum, photoProofRequirementEnum } from "@/db";

export const ApartmentShotSchema = z
  .object({
    id: z.string().uuid(),
    apartmentId: z.string().uuid(),
    roomLocation: z.enum(roomLocationEnum.enumValues),
    shotType: z.enum(photoProofRequirementEnum.enumValues),
    title: z.string().min(1).max(255),
    instructions: z.string().min(1),
    assetIds: z.array(z.string().uuid()),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .openapi("ApartmentShot");

export const ApartmentShotsListSchema = z
  .array(ApartmentShotSchema)
  .openapi("ApartmentShotsList");

export const SyncShotItemSchema = z
  .object({
    id: z.uuid().optional().nullable(),
    roomLocation: z.enum(roomLocationEnum.enumValues),
    shotType: z.enum(photoProofRequirementEnum.enumValues),
    title: z.string().min(1).max(255),
    instructions: z.string().min(1),
    assetIds: z.array(z.uuid()).min(1),
  })
  .openapi("SyncShotItem");

export const SyncApartmentShotsSchema = z
  .object({
    shots: z.array(SyncShotItemSchema),
  })
  .openapi("SyncApartmentShots");

export const ApartmentParamSchema = z.object({
  apartmentId: z.uuid().openapi({
    param: {
      name: "apartmentId",
      in: "path",
    },
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
});

export const GetShotsQuerySchema = z.object({
  reservationId: z
    .uuid()
    .optional()
    .openapi({
      param: {
        name: "reservationId",
        in: "query",
      },
      description: "Optional reservation ID to filter shots and assets created before or at reservation booking time",
      example: "987e6543-e21b-12d3-a456-426614174000",
    }),
});