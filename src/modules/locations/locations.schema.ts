import { z } from "@hono/zod-openapi";

import { SelectLocationSchema, InsertLocationSchema } from "@/db";

export const LocationSchema =
  SelectLocationSchema.openapi("Location");

export const GetLocationsResponseSchema =
  z.array(LocationSchema);

export const CreateLocationSchema =
  InsertLocationSchema.omit({
    id: true,
    createdAt: true,
  }).openapi("CreateLocation");