import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const locationErrors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "LOCATION_NOT_FOUND" as const,
      description: "Location does not exist.",
      message: "Location does not exist.",
    },
  },
  StandardErrorSchema,
);
