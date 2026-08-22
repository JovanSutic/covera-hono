import { z } from "@hono/zod-openapi";
import { SelectReservationSchema, InsertReservationSchema } from "@/db";

export const ReservationSchema = SelectReservationSchema.openapi("Reservation");

export const ReservationsListSchema = z
  .array(ReservationSchema)
  .openapi("ReservationsList");

export const CreateReservationSchema = InsertReservationSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    checkInDatetime: z.coerce.date(),
    checkOutDatetime: z.coerce.date(),
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