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
      // The two reasons are DIFFERENT states and must not share prose. The
      // `checkin` clause fires when `now > nextCheckIn` — the next guest has
      // ALREADY arrived — so a message about the stay not having begun yet
      // described a future event for a past one, and described a rule
      // (`now < checkIn`) that no clause implements.
      message: (ctx: { reason: "checkout" | "checkin"; deadline: string }) =>
        ctx.reason === "checkout"
          ? `This claim is too old to file: it must be opened within 14 days of check-out, ` +
            `which passed on ${ctx.deadline}.`
          : `This claim can no longer be opened: the next guest checked in on ${ctx.deadline}, ` +
            "so the turnover this claim is about is over.",
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
    evidenceMetadataInvalid: {
      status: 400 as const,
      code: "EVIDENCE_METADATA_INVALID" as const,
      description: "The evidence carries metadata its type cannot have.",
      message: (ctx: { evidenceType: string }) =>
        `A ${ctx.evidenceType} is a document and cannot carry a capture time, ` +
        "latitude or longitude. Remove those fields and try again.",
    },
    /**
     * Distinct from `evidenceTypeMismatch`: that one means the evidence TYPE is
     * wrong for this item, this one means the storage KEY was never issued for
     * this item. Reporting the first when the second is true would send the
     * caller to fix the wrong field, and would hide an attempted cross-item
     * write behind a validation message.
     */
    evidenceKeyInvalid: {
      status: 400 as const,
      code: "EVIDENCE_KEY_INVALID" as const,
      description: "The evidence storage key was not issued for this item.",
      message:
        "That storage key was not issued for this item. Request upload tokens " +
        "for this item first, then confirm the keys they returned.",
    },
    maxEvidenceExceeded: {
      status: 400 as const,
      code: "MAX_EVIDENCE_EXCEEDED" as const,
      description: "The per-item evidence limit would be exceeded.",
      message: (ctx: { limit: number; submitted: number }) =>
        `You can attach at most ${ctx.limit} items of evidence per claim item, ` +
        `but ${ctx.submitted} were submitted. Remove some and try again.`,
    },
    itemNotFound: {
      status: 404 as const,
      code: "INCIDENT_ITEM_NOT_FOUND" as const,
      description: "Incident item does not exist.",
      message: "This claim does not have that item.",
    },
    evidenceNotFound: {
      status: 404 as const,
      code: "EVIDENCE_NOT_FOUND" as const,
      description: "Evidence does not exist.",
      message: "This claim does not have that piece of evidence.",
    },
    itemExists: {
      status: 409 as const,
      code: "INCIDENT_ITEM_EXISTS" as const,
      description: "This asset is already an item on the claim.",
      message: (ctx: { assetId: string }) =>
        `Asset ${ctx.assetId} is already an item on this claim. ` +
        "Edit that item instead of adding a second one.",
    },
    itemLocked: {
      status: 409 as const,
      code: "INCIDENT_ITEM_LOCKED" as const,
      description: "The item already has evidence and can no longer be changed that way.",
      message:
        "This item already has evidence, so its type can no longer be changed: " +
        "the evidence was validated against the type it had.",
    },
    /**
     * The same code as `itemLocked` and a different sentence, because the client
     * is told about the same fact — the item is locked by the evidence it has —
     * for a different attempted action. One code keeps the lock one thing to
     * check; two messages keep the copy about what the caller actually tried.
     */
    itemAlreadyCollected: {
      status: 409 as const,
      code: "INCIDENT_ITEM_LOCKED" as const,
      description: "The item already has evidence and can no longer be changed that way.",
      message:
        "This item has already collected its evidence, so it does not need a new link. " +
        "Remove the evidence first if you want to re-shoot it.",
    },
    notEditable: {
      status: 409 as const,
      code: "INCIDENT_NOT_EDITABLE" as const,
      description: "The claim has been filed and can no longer be changed.",
      message: (ctx: { status: string }) =>
        `This claim is '${ctx.status}' and can no longer be changed. ` +
        "Only a claim that has not been filed with the resolution centre can be edited.",
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
