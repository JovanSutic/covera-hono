import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const incidentErrors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "INCIDENT_NOT_FOUND" as const,
      description: "Incident does not exist.",
      message: "Incident does not exist.",
    },
    // The three below use codes that already exist in the registry, so they add
    // no entry to `EXPECTED_STATUS`. They exist because the host routes look up
    // a reservation and an asset before they can resolve a claim, and both
    // lookups must fail through this module's throwers rather than inlining an
    // exception — that is what keeps every thrown code traceable to a registry
    // declaration (D27).
    unauthenticated: {
      status: 401 as const,
      code: "AUTH_TOKEN_MISSING" as const,
      description: "No authentication token was supplied.",
      message: "Authentication is required.",
    },
    reservationNotFound: {
      status: 404 as const,
      code: "RESERVATION_NOT_FOUND" as const,
      description: "Reservation does not exist.",
      message: "Reservation does not exist.",
    },
    assetNotFound: {
      status: 404 as const,
      code: "ASSET_NOT_FOUND" as const,
      description: "Asset does not exist.",
      message: "Asset does not exist.",
    },
    alreadyExists: {
      status: 409 as const,
      code: "INCIDENT_ALREADY_EXISTS" as const,
      description: "An incident already exists for this reservation.",
      message: "An incident already exists for this reservation.",
    },
    notReady: {
      status: 409 as const,
      code: "INCIDENT_NOT_READY" as const,
      description: "Not every item has its photos yet.",
      message:
        "This claim cannot be filed yet: one or more items still need photos. " +
        "Collect them first, then file.",
    },
    alreadyFiled: {
      status: 409 as const,
      code: "INCIDENT_ALREADY_FILED" as const,
      description: "The claim has already been filed.",
      message: "This claim has already been filed with the resolution centre.",
    },
    windowExpired: {
      status: 400 as const,
      code: "INCIDENT_WINDOW_EXPIRED" as const,
      description: "The claim is outside the filing window.",
      message: (ctx: { reason: "checkout" | "checkin"; deadline: string }) =>
        ctx.reason === "checkout"
          ? `This claim is too old to file: it must be opened within 14 days of check-out, ` +
            `which passed on ${ctx.deadline}.`
          : `This claim cannot be opened before the stay begins on ${ctx.deadline}.`,
    },
    assetNotInApartment: {
      status: 400 as const,
      code: "ASSET_NOT_IN_APARTMENT" as const,
      description: "The asset belongs to a different apartment.",
      message: (ctx: { assetId: string }) =>
        `Asset ${ctx.assetId} is not in the apartment this reservation is for. ` +
        "Only assets in that apartment can be claimed.",
    },
    evidenceTypeMismatch: {
      status: 400 as const,
      code: "EVIDENCE_TYPE_MISMATCH" as const,
      description: "The evidence type does not match the item's incident type.",
      message: (ctx: { incidentType: "damage" | "theft"; allowed: string[] }) =>
        `A ${ctx.incidentType} item only accepts evidence of type: ${ctx.allowed.join(", ")}.`,
    },
    fieldTokenInvalid: {
      status: 404 as const,
      code: "FIELD_TOKEN_INVALID" as const,
      description: "The field link is no longer usable.",
      message:
        "This link is no longer valid. It may have expired, or the photos may already " +
        "have been submitted. Ask the host for a new link.",
    },
  },
  StandardErrorSchema,
);
