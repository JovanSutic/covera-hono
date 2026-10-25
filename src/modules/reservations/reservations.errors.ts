import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const reservationErrors = defineErrors(
  {
    notFound: {
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
    invalidRange: {
      status: 400 as const,
      code: "RESERVATION_INVALID_RANGE" as const,
      description: "Check-out must be strictly after check-in.",
      message: "Check-out must be strictly after check-in.",
    },
    overlap: {
      status: 409 as const,
      code: "RESERVATION_OVERLAP" as const,
      description: "Reservation overlaps an existing reservation.",
      message:
        "This apartment already has a reservation overlapping the requested dates. " +
        "Choose dates outside that range or cancel the existing reservation.",
    },
  },
  StandardErrorSchema,
);
