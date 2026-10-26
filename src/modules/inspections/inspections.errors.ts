import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const inspectionErrors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "INSPECTION_NOT_FOUND" as const,
      description: "Inspection does not exist.",
      message: "Inspection does not exist.",
    },
    reservationNotFound: {
      status: 404 as const,
      code: "RESERVATION_NOT_FOUND" as const,
      description: "Reservation does not exist.",
      message: "Reservation does not exist.",
    },
    unauthenticated: {
      status: 401 as const,
      code: "AUTH_TOKEN_MISSING" as const,
      description: "No authentication token was supplied.",
      message: "Authentication is required.",
    },
    alreadyExists: {
      status: 409 as const,
      code: "INSPECTION_ALREADY_EXISTS" as const,
      description: "An inspection already exists for this reservation.",
      message: "An inspection already exists for this reservation.",
    },
    flagAlreadyExists: {
      status: 409 as const,
      code: "FLAG_ALREADY_EXISTS" as const,
      description: "A flag already exists for this shot.",
      message: "A flag has already been submitted for this shot.",
    },
  },
  StandardErrorSchema,
);
