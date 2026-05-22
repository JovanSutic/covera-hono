import { z } from "@hono/zod-openapi";

export const ApartmentSchema = z.object({
  id: z.string().openapi({ example: "apt_123" }),
  ownerId: z.string().openapi({ example: "usr_1" }),

  title: z.string().openapi({ example: "Cozy flat in Rome" }),

  description: z.string().optional().openapi({
    example: "Nice apartment near metro",
  }),

  address: z.string().openapi({
    example: "Via Nomentana 123, Rome",
  }),

  createdAt: z.string().openapi({
    example: "2026-01-01T10:00:00Z",
  }),
});

export const CreateApartmentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  address: z.string().min(1),
});

export const ApartmentsListSchema = z.array(ApartmentSchema);
