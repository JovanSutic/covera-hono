import { createRoute } from "@hono/zod-openapi";
import {
  AddIncidentItemResponseSchema,
  AttachEvidenceBodySchema,
  AttachEvidenceResponseSchema,
  CreateIncidentBodySchema,
  CreateIncidentItemSchema,
  CreateIncidentResponseSchema,
  DeleteEvidenceResponseSchema,
  DeleteIncidentItemResponseSchema,
  DeleteIncidentResponseSchema,
  EvidenceUploadTokensBodySchema,
  IncidentEvidenceParamSchema,
  IncidentItemParamSchema,
  IncidentItemSchema,
  IncidentItemWithTokenSchema,
  IncidentParamSchema,
  IncidentQuerySchema,
  IncidentSchema,
  IncidentWithItemsSchema,
  PaginatedIncidentsSchema,
  UpdateIncidentBodySchema,
  UpdateIncidentItemBodySchema,
} from "./incidents.schema";
import { UploadTokensResponseSchema } from "../apartments/apartments.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";
import {
  errorResponses,
  AUTHED,
  ROLE,
  APARTMENT_SCOPED,
  VALIDATION,
} from "@/core/errors/error.responses";

/*
 * The host surface. Every route here is authenticated and apartment-scoped, and
 * every bundle below therefore carries `...AUTHED, ...ROLE, ...APARTMENT_SCOPED,
 * ...VALIDATION` — `check-contracts.ts` fails the build when a route mounts
 * `authGuard` without declaring 401, or a role guard without declaring 403, so
 * the bundles are not only prose.
 *
 * The three sub-resources are declared separately on purpose (this feature's
 * rework): an incident and its items are created, edited and deleted by
 * different calls, so a host can open a claim the moment they notice damage and
 * add the affected assets afterwards. The same holds one level down — an item is
 * added first, then photos or documents are attached to it as proof.
 */

const createIncidentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "RESERVATION_NOT_FOUND",
  "ASSET_NOT_FOUND",
  "INCIDENT_WINDOW_EXPIRED",
  "ASSET_NOT_IN_APARTMENT",
  "INCIDENT_ALREADY_EXISTS",
  "INCIDENT_ITEM_EXISTS",
]);

const listIncidentsErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
]);

const getIncidentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "INCIDENT_NOT_FOUND",
]);

/**
 * The mutation bundle: every claim-scoped write resolves the same claim through
 * `resolveOwnedIncident`, so they fail identically and share one bundle. Listing
 * it once is what keeps "edit the claim" and "add an item to the claim" from
 * drifting into different 404/403 behaviour for the same id.
 */
const mutateIncidentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "INCIDENT_NOT_FOUND",
  "INCIDENT_NOT_EDITABLE",
]);

const mutateItemErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "INCIDENT_NOT_FOUND",
  "INCIDENT_NOT_EDITABLE",
  "INCIDENT_ITEM_NOT_FOUND",
  "INCIDENT_ITEM_LOCKED",
  "ASSET_NOT_FOUND",
  "ASSET_NOT_IN_APARTMENT",
  "INCIDENT_ITEM_EXISTS",
  "EVIDENCE_TYPE_MISMATCH",
]);

const itemEvidenceErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "INCIDENT_NOT_FOUND",
  "INCIDENT_NOT_EDITABLE",
  "INCIDENT_ITEM_NOT_FOUND",
  "EVIDENCE_NOT_FOUND",
  "EVIDENCE_TYPE_MISMATCH",
  "EVIDENCE_METADATA_INVALID",
  "EVIDENCE_KEY_INVALID",
  "MAX_EVIDENCE_EXCEEDED",
]);

const reissueTokenErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "INCIDENT_NOT_FOUND",
  "INCIDENT_NOT_EDITABLE",
  "INCIDENT_ITEM_NOT_FOUND",
]);

const confirmFilingErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "INCIDENT_NOT_FOUND",
  "INCIDENT_NOT_READY",
  "INCIDENT_ALREADY_FILED",
]);

/**
 * Host opens a claim for a reservation's damaged or stolen assets.
 *
 * `items` is optional: the claim and its items are separately created, so the
 * claim can be opened before the host has finished walking the apartment.
 *
 * The response is the ONE payload besides the token-reissue route that carries
 * each item's `cleanerToken` — the host relays it to the cleaner out of band
 * (D11).
 */
export const createIncidentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateIncidentBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Incident created successfully",
      content: {
        "application/json": {
          schema: CreateIncidentResponseSchema,
        },
      },
    },
    ...createIncidentErrors,
  },
});

/**
 * The operational list (M1). Without it a host could only open a claim whose id
 * they already had, so "which claims are near their escalation deadline?" — the
 * question the deadline columns exist to answer — was unanswerable.
 *
 * Defaults to sorting by escalation deadline, soonest first: that is the order
 * an operator can work down.
 */
export const listIncidentsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    query: IncidentQuerySchema,
  },
  responses: {
    200: {
      description: "Claims matching the query, most urgent first by default",
      content: {
        "application/json": {
          schema: PaginatedIncidentsSchema,
        },
      },
    },
    ...listIncidentsErrors,
  },
});

/**
 * The claim, hydrated with its items, their assets and their evidence.
 * Never carries a `cleanerToken` (D11).
 */
export const getIncidentRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentParamSchema,
  },
  responses: {
    200: {
      description: "Incident fetched successfully",
      content: {
        "application/json": {
          schema: IncidentWithItemsSchema,
        },
      },
    },
    ...getIncidentErrors,
  },
});

/**
 * Corrects the claim (M5). What a host may change is the money they are asking
 * for; the status, the two clocks and the item-derived total are server-owned,
 * and a filed claim refuses every edit (INCIDENT_NOT_EDITABLE).
 */
export const updateIncidentRoute = createRoute({
  method: "patch",
  path: "/{id}",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateIncidentBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Claim updated successfully",
      content: {
        "application/json": {
          schema: IncidentWithItemsSchema,
        },
      },
    },
    ...mutateIncidentErrors,
  },
});

/**
 * Removes the claim (D2). Its items and their evidence cascade away with it,
 * which frees the reservation to carry a real claim again — without this, a
 * claim opened by mistake permanently consumes the reservation's one claim slot.
 */
export const deleteIncidentRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentParamSchema,
  },
  responses: {
    200: {
      description: "Claim deleted successfully",
      content: {
        "application/json": {
          schema: DeleteIncidentResponseSchema,
        },
      },
    },
    ...mutateIncidentErrors,
  },
});

/**
 * Adds one item to an existing claim and mints its field link — the other half
 * of the separated create (D1).
 *
 * Returns that item WITH its `cleanerToken`, because the token is minted here
 * and the host has to relay it; no read route ever returns it.
 */
export const addIncidentItemRoute = createRoute({
  method: "post",
  path: "/{id}/items",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentParamSchema,
    body: {
      content: {
        "application/json": {
          schema: CreateIncidentItemSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Item added to the claim",
      content: {
        "application/json": {
          schema: AddIncidentItemResponseSchema,
        },
      },
    },
    ...mutateItemErrors,
  },
});

/**
 * Corrects one item's type and provisional value.
 *
 * A `type` change is refused once the item has evidence: the field surface
 * validated what the cleaner submitted against the type the item had at the
 * time, so re-typing it afterwards would leave evidence that no longer answers
 * the question it was collected for.
 */
export const updateIncidentItemRoute = createRoute({
  method: "patch",
  path: "/{id}/items/{itemId}",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentItemParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateIncidentItemBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Item updated successfully",
      content: {
        "application/json": {
          schema: IncidentItemSchema,
        },
      },
    },
    ...mutateItemErrors,
  },
});

/**
 * Removes one item from a claim. Its evidence cascades with it, and the claim's
 * derived total is recomputed in the same transaction.
 */
export const deleteIncidentItemRoute = createRoute({
  method: "delete",
  path: "/{id}/items/{itemId}",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentItemParamSchema,
  },
  responses: {
    200: {
      description: "Item removed from the claim",
      content: {
        "application/json": {
          schema: DeleteIncidentItemResponseSchema,
        },
      },
    },
    ...mutateItemErrors,
  },
});

/**
 * Presigned R2 upload URLs for an item's evidence.
 *
 * Unlike the field surface's mint, this one accepts DOCUMENTS as well as images
 * (D6): a receipt or a repair quote is a PDF at least as often as it is a photo,
 * and the host — not the cleaner — is who holds those.
 *
 * Writes nothing, so the per-item cap is enforced at the attach below, which is
 * the call that actually inserts.
 */
export const requestEvidenceUploadTokensRoute = createRoute({
  method: "post",
  path: "/{id}/items/{itemId}/upload-tokens",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentItemParamSchema,
    body: {
      content: {
        "application/json": {
          schema: EvidenceUploadTokensBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Presigned upload URLs generated successfully",
      content: {
        "application/json": {
          schema: UploadTokensResponseSchema,
        },
      },
    },
    ...itemEvidenceErrors,
  },
});

/**
 * Confirms an upload against the item and records it as evidence — the host's
 * counterpart of the field submit, and the write that makes the DOCUMENT half of
 * `evidence_file_type` reachable at all (D6).
 *
 * The item's status and the claim's aggregate are re-derived from the evidence
 * that results, so attaching a receipt to an item that already has its photos
 * advances it to `complete` without making the claim unfilable.
 */
export const attachEvidenceRoute = createRoute({
  method: "post",
  path: "/{id}/items/{itemId}/evidence",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentItemParamSchema,
    body: {
      content: {
        "application/json": {
          schema: AttachEvidenceBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Evidence attached to the item",
      content: {
        "application/json": {
          schema: AttachEvidenceResponseSchema,
        },
      },
    },
    ...itemEvidenceErrors,
  },
});

/**
 * Withdraws one piece of evidence (D4). A soft delete: the row records what was
 * filed, and the item's status is re-derived from what remains — so removing the
 * last photo of an item an reopen a claim that was ready to file.
 */
export const deleteEvidenceRoute = createRoute({
  method: "delete",
  path: "/{id}/items/{itemId}/evidence/{evidenceId}",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentEvidenceParamSchema,
  },
  responses: {
    200: {
      description: "Evidence withdrawn from the item",
      content: {
        "application/json": {
          schema: DeleteEvidenceResponseSchema,
        },
      },
    },
    ...itemEvidenceErrors,
  },
});

/**
 * Mints a fresh field link for an item whose previous one expired unused (D3).
 *
 * Without this an expired link was fatal: the token is single-use and
 * time-limited, and nothing could mint another, so a claim whose cleaner was
 * slow could never collect its evidence. Replacing `cleaner_token` invalidates
 * the old value in the same write.
 *
 * Only legal while the item is still `link_generated` — an item that already has
 * evidence does not need a link.
 */
export const reissueItemTokenRoute = createRoute({
  method: "post",
  path: "/{id}/items/{itemId}/reissue-token",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentItemParamSchema,
  },
  responses: {
    200: {
      description: "A fresh field link for this item",
      content: {
        "application/json": {
          schema: IncidentItemWithTokenSchema,
        },
      },
    },
    ...reissueTokenErrors,
  },
});

/**
 * Trigger C — starts the 24-hour guest response clock. Only legal once every
 * item has its evidence, and only once.
 */
export const confirmAirbnbFilingRoute = createRoute({
  method: "post",
  path: "/{id}/confirm-airbnb-filing",
  tags: ["Incidents"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: {
    params: IncidentParamSchema,
  },
  responses: {
    200: {
      description: "Claim filed with the resolution centre; the guest clock has started",
      content: {
        "application/json": {
          schema: IncidentSchema,
        },
      },
    },
    ...confirmFilingErrors,
  },
});
