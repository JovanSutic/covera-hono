import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The single source of truth for every error code the API can emit.
 *
 * Rules (see docs/errorHandle.md §5):
 *  - Codes are namespaced SCREAMING_SNAKE, never a status name, never free-form.
 *  - `status` is the ONLY place a code's HTTP status is decided.
 *  - `description` is the OpenAPI description (developer-facing, no trailing period needed).
 *
 * Adding a code here is the only way to use it: `ErrorCode` is derived from this table,
 * so an unknown code at a throw site or in a contract is a compile error.
 */
export const ERROR_REGISTRY = {
  // ---- 400 -----------------------------------------------------------------
  VALIDATION_ERROR:        { status: 400, description: "The request failed validation." },
  INVALID_DATETIME:        { status: 400, description: "A date value in the request is not valid." },
  INVALID_IDENTIFIER:      { status: 400, description: "An identifier in the request is not a valid value." },
  MISSING_REQUIRED_FIELD:  { status: 400, description: "A required field was missing from the request." },
  CONSTRAINT_VIOLATION:    { status: 400, description: "The submitted values violate a data rule." },
  RESERVATION_INVALID_RANGE: { status: 400, description: "Check-out must be strictly after check-in." },
  RESERVATION_NOT_COVERED:   { status: 400, description: "The reservation is not in the COVERED state." },
  INSPECTION_NO_PHOTO_PROOF: { status: 400, description: "The reservation has no satisfied photo proof." },
  INSPECTION_WINDOW_EXPIRED: { status: 400, description: "The inspection creation window has expired." },
  FLAG_WINDOW_EXPIRED:       { status: 400, description: "The flag submission window has expired." },
  MAX_PHOTOS_EXCEEDED:       { status: 400, description: "The per-reservation photo limit would be exceeded." },
  ASSET_TYPE_INVALID:        { status: 400, description: "The referenced asset type does not exist." },
  AUTH_PROVIDER_ERROR:       { status: 400, description: "The authentication provider rejected the request." },
  INVITATION_ERROR:          { status: 400, description: "The invitation could not be dispatched." },
  INCIDENT_WINDOW_EXPIRED:   { status: 400, description: "The claim is outside the window in which it can be opened." },
  ASSET_NOT_IN_APARTMENT:    { status: 400, description: "The asset does not belong to the apartment the claim is for." },
  EVIDENCE_TYPE_MISMATCH:    { status: 400, description: "The evidence type is not valid for this item." },
  EVIDENCE_METADATA_INVALID: { status: 400, description: "The evidence carries metadata its type cannot have." },
  EVIDENCE_KEY_INVALID:      { status: 400, description: "The evidence storage key was not issued for this item." },
  MAX_EVIDENCE_EXCEEDED:     { status: 400, description: "The per-item evidence limit would be exceeded." },

  // ---- 401 -----------------------------------------------------------------
  AUTH_TOKEN_MISSING:   { status: 401, description: "No authentication token was supplied." },
  AUTH_TOKEN_INVALID:   { status: 401, description: "The authentication token is invalid." },
  AUTH_SESSION_EXPIRED: { status: 401, description: "The session has expired and must be renewed." },

  // ---- 403 -----------------------------------------------------------------
  FORBIDDEN_ROLE:              { status: 403, description: "The caller's role cannot access this endpoint." },
  FORBIDDEN_APARTMENT_ACCESS:  { status: 403, description: "The caller does not own this apartment." },

  // ---- 404 -----------------------------------------------------------------
  ROUTE_NOT_FOUND:      { status: 404, description: "The requested route does not exist." },
  APARTMENT_NOT_FOUND:  { status: 404, description: "Apartment does not exist." },
  RESERVATION_NOT_FOUND:{ status: 404, description: "Reservation does not exist." },
  INSPECTION_NOT_FOUND: { status: 404, description: "Inspection does not exist." },
  ASSET_NOT_FOUND:      { status: 404, description: "Asset does not exist." },
  ASSET_TYPE_NOT_FOUND: { status: 404, description: "Asset type does not exist." },
  LOCATION_NOT_FOUND:   { status: 404, description: "Location does not exist." },
  USER_NOT_FOUND:       { status: 404, description: "User does not exist." },
  FLAG_NOT_FOUND:       { status: 404, description: "Flag does not exist." },
  INCIDENT_NOT_FOUND:   { status: 404, description: "Incident does not exist." },
  INCIDENT_ITEM_NOT_FOUND: { status: 404, description: "Incident item does not exist." },
  EVIDENCE_NOT_FOUND:   { status: 404, description: "Evidence does not exist." },
  FIELD_TOKEN_INVALID:  { status: 404, description: "The field link is not valid, has expired, or has already been used." },

  // ---- 409 -----------------------------------------------------------------
  RESERVATION_OVERLAP:      { status: 409, description: "Reservation overlaps an existing reservation." },
  INSPECTION_ALREADY_EXISTS:{ status: 409, description: "An inspection already exists for this reservation." },
  FLAG_ALREADY_EXISTS:      { status: 409, description: "A flag already exists for this shot." },
  ASSET_LOCKED:             { status: 409, description: "Asset is locked by an active reservation." },
  APARTMENT_SHOTS_LOCKED:   { status: 409, description: "Shots are locked by an active reservation." },
  DUPLICATE_RECORD:         { status: 409, description: "A record with these values already exists." },
  RELATED_RECORD_INVALID:   { status: 409, description: "A referenced record does not exist or is still in use." },
  INCIDENT_ALREADY_EXISTS:  { status: 409, description: "An incident already exists for this reservation." },
  INCIDENT_NOT_READY:       { status: 409, description: "The claim cannot be filed until every item has its photos." },
  INCIDENT_ALREADY_FILED:   { status: 409, description: "The claim has already been filed." },
  INCIDENT_ITEM_EXISTS:     { status: 409, description: "This asset is already an item on the claim." },
  INCIDENT_ITEM_LOCKED:     { status: 409, description: "The item already has evidence and can no longer be re-typed." },
  INCIDENT_NOT_EDITABLE:    { status: 409, description: "The claim has been filed and can no longer be changed." },

  // ---- 500 / other ---------------------------------------------------------
  INTERNAL_SERVER_ERROR: { status: 500, description: "An unexpected error occurred." },
  METHOD_NOT_ALLOWED:    { status: 405, description: "The HTTP method is not allowed for this route." },
  HTTP_ERROR:            { status: 500, description: "The request could not be completed." },
} as const satisfies Record<string, { status: ContentfulStatusCode; description: string }>;

/** Union of every valid error code. Derived — never hand-written. */
export type ErrorCode = keyof typeof ERROR_REGISTRY;

/** Status for a code, as a literal type. */
export type StatusFor<C extends ErrorCode> = (typeof ERROR_REGISTRY)[C]["status"];