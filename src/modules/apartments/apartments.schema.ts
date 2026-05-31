import { z } from "@hono/zod-openapi";

import {
  SelectApartmentSchema,
  InsertApartmentSchema,
} from "@/db";

export const ApartmentSchema =
  SelectApartmentSchema.openapi("Apartment");

export const ApartmentsListSchema =
  z.array(ApartmentSchema);

export const CreateApartmentSchema =
  InsertApartmentSchema.omit({
    id: true,
    createdAt: true,
  }).openapi("CreateApartment");