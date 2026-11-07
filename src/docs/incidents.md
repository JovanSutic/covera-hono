# Incidents (AirCover claim tracking)

Status: DRAFT

## Intent

From `src/docs/incident-management-prep.md`, in the operator's words:

> Incident is something that host is creating for a specific reservation and it represent situation
> where during this reservation in apartment on one or more assets there is spotted damage or theft.
> This means that Incident needs to be connected with the reservation, and this is 1-1 connection…
> Also, incident has items, so sub entities that represent the damaged or stolen assets.
>
> …we can't really tell how much photos we will need, so maybe sometimes there will be enough to make
> 1-2 photos, but sometimes more. So system should be flexible enough to store and connect multiple,
> unknown amount of photos per incident item.

From `src/docs/incident_management_backend_blueprint.md`, the system goals:

> The system decouples field data intake from administrative office workflows using unauthenticated,
> tokenized dynamic links for field staff. It enforces strict structural alignment with Airbnb's
> automated Resolution Center logic.

This feature lands the **initial backend setup** for that system: the three tables, the host-facing
incident lifecycle, and the tokenized field-intake surface. It is the first slice of
`feature/51_incident-initial-setup`.

## Behaviour

The claim and its items are **separately managed**: a claim is opened the moment the host notices
damage, and the affected assets are added to it afterwards. The same holds one level down — an item
is added first, then photos or documents are attached to it as proof.

| # | Method | Path | Guards | Success | Failure modes |
| --- | --- | --- | --- | --- | --- |
| 1 | POST | `/incidents` | `authGuard`, `rolesGuard(["admin","host"])`, ownership | `201` `IncidentWithItems` (each item with its `cleanerToken`) | `400` `VALIDATION_ERROR` / `INCIDENT_WINDOW_EXPIRED` / `ASSET_NOT_IN_APARTMENT`; `401` `AUTH_TOKEN_MISSING`; `403` `FORBIDDEN_ROLE` / `FORBIDDEN_APARTMENT_ACCESS`; `404` `RESERVATION_NOT_FOUND` / `APARTMENT_NOT_FOUND` / `ASSET_NOT_FOUND`; `409` `INCIDENT_ALREADY_EXISTS` / `INCIDENT_ITEM_EXISTS` |
| 2 | GET | `/incidents` | `authGuard`, `rolesGuard(["admin","host"])`, ownership | `200` `PaginatedIncidents` | `400` `VALIDATION_ERROR` (includes a missing `apartmentId`); `401`; `403` |
| 3 | GET | `/incidents/{id}` | `authGuard`, `rolesGuard(["admin","host"])`, ownership | `200` `IncidentWithItems` | `401`; `403`; `404` `INCIDENT_NOT_FOUND` / `APARTMENT_NOT_FOUND` / `FORBIDDEN_APARTMENT_ACCESS` |
| 4 | PATCH | `/incidents/{id}` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `200` `IncidentWithItems` | `401`; `403`; `404` `INCIDENT_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` |
| 5 | DELETE | `/incidents/{id}` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `200` `DeleteIncidentResponse` | `401`; `403`; `404` `INCIDENT_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` |
| 6 | POST | `/incidents/{id}/items` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `201` `IncidentItemWithToken` | `400` `VALIDATION_ERROR` / `ASSET_NOT_IN_APARTMENT`; `401`; `403`; `404` `INCIDENT_NOT_FOUND` / `ASSET_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` / `INCIDENT_ITEM_EXISTS` |
| 7 | PATCH | `/incidents/{id}/items/{itemId}` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `200` `IncidentItem` | `401`; `403`; `404` `INCIDENT_NOT_FOUND` / `INCIDENT_ITEM_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` / `INCIDENT_ITEM_LOCKED` |
| 8 | DELETE | `/incidents/{id}/items/{itemId}` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `200` `DeleteIncidentItemResponse` | `401`; `403`; `404` `INCIDENT_NOT_FOUND` / `INCIDENT_ITEM_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` |
| 9 | POST | `/incidents/{id}/items/{itemId}/upload-tokens` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `200` `UploadTokensResponse` (images **and** PDFs) | `400` `VALIDATION_ERROR`; `401`; `403`; `404` `INCIDENT_NOT_FOUND` / `INCIDENT_ITEM_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` |
| 10 | POST | `/incidents/{id}/items/{itemId}/evidence` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `201` `AttachEvidenceResponse` | `400` `EVIDENCE_TYPE_MISMATCH` / `EVIDENCE_METADATA_INVALID` / `EVIDENCE_KEY_INVALID` / `MAX_EVIDENCE_EXCEEDED`; `401`; `403`; `404` `INCIDENT_NOT_FOUND` / `INCIDENT_ITEM_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` |
| 11 | DELETE | `/incidents/{id}/items/{itemId}/evidence/{evidenceId}` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `200` `DeleteEvidenceResponse` | `401`; `403`; `404` `INCIDENT_NOT_FOUND` / `INCIDENT_ITEM_NOT_FOUND` / `EVIDENCE_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` |
| 12 | POST | `/incidents/{id}/items/{itemId}/reissue-token` | `authGuard`, `rolesGuard(["admin","host"])`, ownership, editable | `200` `IncidentItemWithToken` | `401`; `403`; `404` `INCIDENT_NOT_FOUND` / `INCIDENT_ITEM_NOT_FOUND`; `409` `INCIDENT_NOT_EDITABLE` / `INCIDENT_ITEM_LOCKED` |
| 13 | POST | `/incidents/{id}/confirm-airbnb-filing` | `authGuard`, `rolesGuard(["admin","host"])`, ownership | `200` `Incident` with `submittedToGuest` status and both clock fields set | `401`; `403`; `404` `INCIDENT_NOT_FOUND`; `409` `INCIDENT_NOT_READY` / `INCIDENT_ALREADY_FILED` |
| 14 | GET | `/field/ingest/{token}` | **none** — possession of the token is the credential | `200` `FieldIngest` | `404` `FIELD_TOKEN_INVALID` |
| 15 | POST | `/field/ingest/{token}/upload-tokens` | **none** — token-gated | `200` `UploadTokensResponse` (images only) | `400` `VALIDATION_ERROR` / `MAX_EVIDENCE_EXCEEDED`; `404` `FIELD_TOKEN_INVALID` |
| 16 | POST | `/field/ingest/{token}/submit` | **none** — token-gated | `200` `FieldSubmitResponse` | `400` `VALIDATION_ERROR` / `EVIDENCE_TYPE_MISMATCH` / `EVIDENCE_KEY_INVALID` / `MAX_EVIDENCE_EXCEEDED`; `404` `FIELD_TOKEN_INVALID` |

`cleanerToken` appears in exactly three responses: `POST /incidents`, `POST /incidents/{id}/items`
and `POST …/reissue-token` — the calls that mint it. Every read omits it, because the token is a
credential the host relays out of band (D11). `getItemWithAsset` is the token-stripped hydration and
the default; the two routes that must return it ask for `getItemWithToken` explicitly by name.

`FieldIngest` carries **no guest identity and no money**: incident type, item status, the asset's
name/room/description, the apartment name, the presigned baseline (previous-stay check-in) photo
URLs, the token's expiry, and the evidence guidance below. This is asserted by a test against the
serialised body, not by prose.

`FieldIngest` also carries `requiredEvidenceTypes` (which shots this item needs) and
`attachedEvidenceCounts` (how many of each are already in), so the field page prompts for the
missing shots instead of showing a bare file picker. Counts and type names only — no storage keys.

`GET /incidents` **requires** `apartmentId`. A claim is reached through its reservation's
apartment, which is what ownership is asserted against, so an unscoped list would return every
host's claims to every host.

## Data changes

Three new tables in one migration (`drizzle/0013_*.sql`), generated by `npm run db:generate`:

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `incidents` | one claim per reservation | `reservation_id UNIQUE` (the 1:1), FK → `reservations` `ON DELETE cascade` |
| `incident_items` | one damaged/stolen asset inside a claim | FK → `incidents` cascade; FK → `assets` **restrict**; `cleaner_token UNIQUE`; `UNIQUE(incident_id, asset_id)` |
| `claim_evidence` | photos and financial documents per item | FK → `incident_items` cascade; `storage_key UNIQUE` |

A second migration (`drizzle/0014_*.sql`) adds the two soft-delete columns
`claim_evidence.status` (`text`, default `'active'`, not null) and `claim_evidence.deleted_at`
(`timestamptz`, nullable). Only two statements; the `assets.asset_type_id SET NOT NULL` drift
described below did not recur.

Four enums: `incident_status`, `incident_item_status`, `asset_incident_type`, `evidence_file_type`.

**No backfill. No change to any existing table.** Money is stored as integer cents
(`*_cents`), matching `assets.approximate_value_cents` — not the blueprint's `DECIMAL(10,2)`
(D3). Files are stored as R2 storage keys, matching `apartment_images.storage_key` — not the
blueprint's `file_url` (D4).

## Invariants this must not break

- The error envelope is built only in `renderError` (`errorHandle.md` §3); nothing else
  constructs `{ success: false }`.
- Guards, middleware and handlers **throw**; they never `return c.json(...)` for an error (§4.2).
- Every `code` is in `ERROR_REGISTRY`; no string literal at a throw site (§5). The eight new
  codes are added to the registry **and** to `EXPECTED_STATUS` in `error.codes.test.ts`, which
  asserts the two lists are equal.
- Messages are one plain sentence — no status prefix, no SQL, no table/column names, no raw
  ids (§8). `assert-error.ts` enforces the SQL/prefix half of this on every `expectError` call.
- Every route declares every status its guards imply (§6); `scripts/check-contracts.ts` fails
  the gate otherwise.
- Multi-step writes run in `db.transaction()`; domain assertions throw inside it and roll it
  back (§4.4).
- **Feature-specific:** `/field/*` responses never contain a guest name, guest email, or any
  `*_cents` field. The field surface is a different trust boundary from the host surface.
- **Feature-specific:** a `cleaner_token` is single-use. `submit` and every attach set
  `tokenExpiresAt = now`, so a replay is `FIELD_TOKEN_INVALID` rather than a second write. An item
  whose evidence is withdrawn back to nothing keeps the burned token: it reads `link_generated`
  and needs `POST …/reissue-token`, which replaces the token in one write.
- **Feature-specific:** `incidents.status` may only be advanced by an explicit transition, never
  computed on read. `draft` ⇄ `ready_to_file` is decided by `syncIncidentReadiness`, which runs
  **in both directions** inside the item write's transaction. A claim is fileable when it HAS at
  least one item and NO item is still `link_generated`.
- **Feature-specific:** an item's `status` is a fact about its evidence, so it is always written
  by `recomputeItemStatus` from the active rows — never set by hand at a call site.
- **Feature-specific:** evidence is soft-deleted (`status = 'soft_deleted'`, `deleted_at`); the
  row records what was filed and the R2 object is left in place.
- **Feature-specific:** an item's `type` is frozen once it has evidence. The field surface
  validated what the cleaner submitted against the type the item had at the time, so re-typing it
  afterwards would leave evidence that no longer answers the question it was collected for.

## Out of scope

Deliberately not built here, so the diff does not grow to fit them:

- **EXIF extraction as a background job.** This repo has no queue, no KV, and no `waitUntil`
  wiring. The submit and attach bodies carry `capturedAt`/`latitude`/`longitude`, validated and
  stored (D10).
- **Token delivery.** Nothing emails or SMSes a cleaner link. The token is returned from
  `POST /incidents` and `POST …/items` (and re-minted by `POST …/reissue-token`); the delivery
  channel is a later feature.
- **`documents_pending`.** The value exists in the enum but nothing transitions into it —
  deliberately. It means "documents have been REQUESTED and are outstanding", and nothing in the
  system records a request, so inventing a writer with no trigger would make the value lie. The
  document half of the lifecycle itself IS built: attaching a receipt or invoice to an item that
  already has its photos moves it to `complete`.
- **Valuation.** `estimated_placeholder_value_cents` is captured at item creation and on `PATCH
  …/items/{itemId}`, and summed into `placeholder_total_amount_cents` on every item write that
  can change it. `final_payout_requested_cents` is the only claim field `PATCH /incidents/{id}`
  accepts. No valuation workflow, no payout calculation.
- **Any Airbnb integration.** No Resolution Center API call, no escalation scheduler. The two
  deadline columns are computed and stored; nothing acts on them.
- **The `unfeasible` and `escalated_to_aircover` statuses.** Both are enum members with no
  transition into them. Creation past the window is **rejected** rather than stored as
  `unfeasible` (D6).
- **Editing a filed claim.** `PATCH`/`DELETE` and every item write refuse with
  `INCIDENT_NOT_EDITABLE` once the claim is `submitted_to_guest` or beyond, and the attachment
  soft-delete is under the same gate. A filed claim is frozen because the guest is looking at it.
- **Noticed but untouched:** `drizzle/0013` generation also wanted to emit
  `ALTER TABLE "assets" ALTER COLUMN "asset_type_id" SET NOT NULL`, because the Drizzle schema
  declares `notNull()` while migrations `0000`–`0012` never applied it. That is pre-existing,
  repo-wide drift unrelated to this feature; the statement was stripped and D14 records why.

## Open questions

None.
