import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const apartmentErrors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "APARTMENT_NOT_FOUND" as const,
      description: "Apartment does not exist.",
      message: "Apartment does not exist.",
    },
    userNotFound: {
      status: 404 as const,
      code: "USER_NOT_FOUND" as const,
      description: "User does not exist.",
      message: "User does not exist.",
    },
    locationNotFound: {
      status: 404 as const,
      code: "LOCATION_NOT_FOUND" as const,
      description: "Location does not exist.",
      message: "Location does not exist.",
    },
    maxPhotos: {
      status: 400 as const,
      code: "MAX_PHOTOS_EXCEEDED" as const,
      description: "The per-reservation photo limit would be exceeded.",
      message: (ctx: { limit: number; count: number }) =>
        `This reservation already has ${ctx.count} photos and the limit is ${ctx.limit}. ` +
        "Remove some photos before adding more.",
    },
  },
  StandardErrorSchema,
);
