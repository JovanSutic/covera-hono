import { z } from "@hono/zod-openapi";

export const ReservationSchema = z.object({
  id: z.string(),
  apartmentId: z.string(),
  guestUserId: z.string(),

  startDate: z.string().openapi({
    example: "2026-01-01",
  }),

  endDate: z.string().openapi({
    example: "2026-01-05",
  }),

  status: z.enum(["pending", "confirmed", "cancelled"]),
});

export const CreateReservationSchema = z.object({
  apartmentId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
});

export const ReservationsListSchema = z.array(ReservationSchema);
