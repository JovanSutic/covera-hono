import { z } from "@hono/zod-openapi";
import {
  SelectInspectionSchema,
  InsertInspectionSchema,
  SelectReservationSchema,
  SelectApartmentShotSchema,
  SelectAssetSchema,
  SelectApartmentImageSchema,
} from "@/db";

// Base VisitLogEvent schema for OpenAPI documentation
export const VisitLogEventSchema = z
  .object({
    timestamp: z.string().datetime().openapi({
      example: "2026-09-05T14:10:00.000Z",
      description: "ISO timestamp of when the inspection link was visited",
    }),
    userAgent: z.string().openapi({
      example:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
      description: "Client User-Agent header string captured during ping",
    }),
  })
  .openapi("VisitLogEvent");

// Base Database Model Representation
export const InspectionSchema = SelectInspectionSchema.extend({
  visited: z.array(VisitLogEventSchema).default([]),
}).openapi("Inspection");

// Nested Schemas for Hydrated GET Responses
export const ShotWithAssetsSchema = SelectApartmentShotSchema.extend({
  assets: z.array(SelectAssetSchema),
}).openapi("ShotWithAssets");

export const DetailedInspectionSchema = InspectionSchema.extend({
  reservation: SelectReservationSchema,
  shots: z.array(ShotWithAssetsSchema),
}).openapi("DetailedInspection");

// Path Parameters
export const InspectionParamSchema = z.object({
  id: z.uuid().openapi({
    param: {
      name: "id",
      in: "path",
    },
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "Inspection unique identifier (UUID)",
  }),
});

export const ReservationParamSchema = z.object({
  reservationId: z.uuid().openapi({
    param: {
      name: "reservationId",
      in: "path",
    },
    example: "123e4567-e89b-12d3-a456-426614174000",
    description: "Reservation unique identifier (UUID)",
  }),
});

// Query Parameters
export const GetInspectionQuerySchema = z.object({
  detailed: z
    .string()
    .optional()
    .transform((val) => val === "true")
    .openapi({
      param: {
        name: "detailed",
        in: "query",
      },
      type: "boolean",
      description:
        "When set to true, returns the fully hydrated inspection tree including reservation, shots, assets, and images.",
      example: true,
    }),
});

// Request Bodies
export const CreateInspectionSchema = InsertInspectionSchema.omit({
  id: true,
  visited: true,
  createdAt: true,
}).openapi("CreateInspection");

// Responses
export const PingInspectionResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    tracked: z.boolean().openapi({ example: true }),
  })
  .openapi("PingInspectionResponse");

// Exported Types
export type VisitLogEvent = z.infer<typeof VisitLogEventSchema>;
export type Inspection = z.infer<typeof InspectionSchema>;
export type DetailedInspection = z.infer<typeof DetailedInspectionSchema>;
export type CreateInspection = z.infer<typeof CreateInspectionSchema>;
export type GetInspectionQuery = z.infer<typeof GetInspectionQuerySchema>;