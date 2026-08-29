import { z } from "@hono/zod-openapi";
import { SelectReservationSchema, InsertReservationSchema } from "@/db";

export const ReservationSchema = SelectReservationSchema.openapi("Reservation");

export const ReservationsListSchema = z
  .array(ReservationSchema)
  .openapi("ReservationsList");

// --- Pagination & Query Schemas ---

export const ReservationQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .min(1)
      .default(1)
      .openapi({
        description: "Page number (1-indexed)",
        default: 1,
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .openapi({
        description: "Number of items per page (max 100)",
        default: 20,
      }),
    sortBy: z
      .enum(["checkInDatetime", "checkOutDatetime", "createdAt"])
      .default("checkInDatetime")
      .openapi({
        description: "Field to sort reservations by",
        default: "checkInDatetime",
      }),
    order: z
      .enum(["asc", "desc"])
      .default("desc")
      .openapi({
        description: "Sort direction",
        default: "desc",
      }),
  })
  .openapi("ReservationQuery");

export const PaginatedReservationsSchema = z
  .object({
    data: z.array(ReservationSchema),
    pagination: z.object({
      page: z.number().openapi({ example: 1 }),
      limit: z.number().openapi({ example: 20 }),
      totalItems: z.number().openapi({ example: 42 }),
      totalPages: z.number().openapi({ example: 3 }),
    }),
  })
  .openapi("PaginatedReservations");

export type ReservationQuery = z.infer<typeof ReservationQuerySchema>;
export type PaginatedReservations = z.infer<typeof PaginatedReservationsSchema>;

// --- Existing Schemas ---

export const CreateReservationSchema = InsertReservationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    checkInDatetime: z.coerce.date(),
    checkOutDatetime: z.coerce.date(),
    alternativeCheckInDatetime: z.coerce.date().optional(),
    alternativeCheckOutDatetime: z.coerce.date().optional(),
  })
  .openapi("CreateReservation");

export const UpdateReservationSchema = CreateReservationSchema.partial().openapi(
  "UpdateReservation"
);

export const ReservationParamSchema = z.object({
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

export const DeleteReservationResponseSchema = z
  .object({
    success: z.boolean(),
    id: z.string().uuid(),
  })
  .openapi("DeleteReservationResponse");