import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const shotErrors = defineErrors(
  {
    reservationNotFound: {
      status: 404 as const,
      code: "RESERVATION_NOT_FOUND" as const,
      description: "Reservation does not exist.",
      message: "Reservation does not exist.",
    },
    shotsLocked: {
      status: 409 as const,
      code: "APARTMENT_SHOTS_LOCKED" as const,
      description: "Shots are locked by an active reservation.",
      message:
        "These shots cannot be changed because this apartment has an upcoming or active reservation " +
        "with locked photo proof. Wait until that reservation is closed.",
    },
  },
  StandardErrorSchema,
);
