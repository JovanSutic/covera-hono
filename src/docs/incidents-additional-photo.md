# Incidents — additional damage photos

Status: DRAFT

## Intent

In the operator's words:

> **Goal.** The goal is to have the system flexible enough that it can provide the frontend
> application the ability to let the user upload up to 4 photos per damaged asset. At the moment the
> photos are following the labeling established on the inspection side, close up and wide screen, but
> there will be use cases where user needs more photos to clearly show the damage.

> **Task 1.** Check if there is some issue with uploading additional photos or this is just a
> frontend application limitation. If there is no limit of uploading additional evidence photos,
> photos related to a single item in a damage claim, create a short instruction for the frontend
> agent that will give him the idea how he can implement the additional photos.
>
> **Task 2.** When ever the end user, using the client application is creating incident and adding
> affected assets he would have a chance to upload up to 4 photos, no mater of the asset photo proof
> requirement.
>
> **Task 3.** The following the line of the asset photo proof requirement stays as is but now we are
> added the possibility to add additional photos. And like this. If the requirement asks for 1 photo
> then user has 3 additional, if it asks for 2 photos then he has 2 additional.
>
> **Task 4.** It would be great if this addition would be aligned with the existing api endpoints. So
> no new endpoints added but existing used.

The one ambiguity — what "the asset photo proof requirement" means *in this flow* — is resolved by
D1: it is the incident item's required shots, `requiredPhotoTypes` (`damage` → 2, `theft` → 1), not
`assets.photo_proof_requirement`, which the incidents module never reads.

## Findings — is there a backend limit today? (task 1)

**No. Nothing blocks extra photos of the same type.** `claim_evidence` has exactly one unique
constraint, `claim_evidence_storage_key_unique` (`drizzle/0013_pale_nightshade.sql`); there is no
uniqueness on `(incident_item_id, evidence_type)`, so a second `damage_photo_wide` inserts cleanly,
and `recomputeItemStatus` keys off photo/document *kinds*, not counts. Additional photos are a
frontend limitation today, not an API one.

The only ceilings are two server constants:

| Constant | Where | Bounds |
| --- | --- | --- |
| `MAX_EVIDENCE_PER_ITEM = 20` | `incidents.service.ts` | ALL evidence (photos + documents) on one item. Enforced at both mints and again at both writes. |
| `MAX_ITEM_PHOTOS = 4` | **added by this feature** | PHOTOS on one item. Enforced at the two writes only. |

So the finding is "no limit blocks it, and the harness is the endpoints you already call" — and the
feature then *adds* the product rule the intent asks for (4 photos per item) and publishes the
headroom so the client does not have to guess. The instruction for the frontend agent is
[below](#frontend-guidance-task-1).

## Behaviour

No endpoint is added or removed. Four existing responses change — three gain a field, one gains a
failure mode.

| # | Method | Path | Change | Failure modes |
| --- | --- | --- | --- | --- |
| 1 | POST | `/incidents/{id}/items/{itemId}/evidence` | item payload gains `photoAllowance`; **new** `400 MAX_ITEM_PHOTOS_EXCEEDED` | as before, plus `MAX_ITEM_PHOTOS_EXCEEDED` |
| 2 | GET / POST / PATCH | `/incidents`, `/incidents/{id}`, `/incidents/{id}/items`, `…/items/{itemId}`, `…/reissue-token` | every `IncidentItem` gains `photoAllowance` | unchanged |
| 3 | GET | `/field/ingest/{token}` | payload gains `photoAllowance` | unchanged |
| 4 | POST | `/field/ingest/{token}/submit` | **new** `400 MAX_ITEM_PHOTOS_EXCEEDED` | as before, plus `MAX_ITEM_PHOTOS_EXCEEDED` |
| 5 | POST | the two `upload-tokens` routes | unchanged — the mint's batch bound stays `MAX_EVIDENCE_PER_ITEM` (D13) | unchanged |
| 6 | DELETE | `/incidents/{id}/items/{itemId}/evidence/{evidenceId}` | unchanged; freeing a slot restores `remaining` | unchanged |

`photoAllowance` is `{ max, required, attached, remaining }` — three integers and the cap. It is
derived, never stored, and computed by one function for every surface (D6, D7). `attached` counts
ACTIVE photos; a soft-deleted photo stops spending the allowance.

## The rule (tasks 2 and 3)

`max` is **4 photos per item, for every item, whatever it needs**. The required shots are not a cap
— they are the minimum the cleaner is prompted for — so they do not add to it:

| Item type | `required` (advisory) | Additional a caller may add | `max` |
| --- | --- | --- | --- |
| `damage` | 2 (`damage_photo_wide`, `damage_photo_closeup`) | 2 | 4 |
| `theft` | 1 (`theft_empty_space_photo`) | 3 | 4 |

`remaining = max(0, max - attached)`.

`required` stays **advisory** (D12): nothing enforces that the specific required types are present,
so an item is still `photos_collected` from its first photo — the field guidance drives the user
toward the missing shots rather than refusing the item without them. The requirement "stays as is".

Documents are **not** counted (D3): a receipt or a repair quote is bounded only by
`MAX_EVIDENCE_PER_ITEM`, so an item that has spent its four photos can still carry its valuation.

## Frontend guidance (task 1)

Nothing new to integrate — the flow is the one already in use, and the cap is readable from the
payloads.

**To add an extra photo to an item (the host surface):**

1. `POST /incidents/{id}/items/{itemId}/upload-tokens` with
   `{ "files": [{ "fileType": "image/jpeg" }] }` → `{ tokens: [{ uploadUrl, key }] }`.
2. `PUT` the file bytes to `uploadUrl` (presigned, ~5 minutes).
3. `POST /incidents/{id}/items/{itemId}/evidence` with
   `{ "evidence": [{ "evidenceType": "damage_photo_wide", "storageKey": key }] }`.

The same `evidenceType` may be repeated — there is no uniqueness on it, so a second
`damage_photo_wide` is a valid second wide shot. On the field page the three calls are
`GET /field/ingest/{token}` → `POST /field/ingest/{token}/upload-tokens` →
`POST /field/ingest/{token}/submit`, with photos only.

**To know how many more are allowed**, read `photoAllowance` from the item (host) or from the field
ingest payload (field) and stop offering "add another photo" at `remaining === 0`; show
`required − attached` as the outstanding required shots. Do not hardcode 4: `max` is server-owned and
the server refuses the fifth photo with `400 MAX_ITEM_PHOTOS_EXCEEDED`.

**Two gotchas.** `storageKey` is `UNIQUE`, so never resend a key that was already confirmed — mint a
fresh token for each attempt. And `DELETE …/evidence/{evidenceId}` soft-deletes a photo, which
raises `remaining` again, so a "remove photo" affordance is what makes a mis-shot recoverable.

## Data changes

**None.** No schema change, no migration, no backfill. The cap is a constant and the allowance is
derived from rows that already exist. `MAX_ITEM_PHOTOS_EXCEEDED` is the only new registry entry, and
it changes no table.

## Invariants this must not break

- The error envelope is built only in `renderError` (`errorHandle.md` §3); nothing else constructs
  `{ success: false }`.
- Guards, middleware and handlers **throw**; they never `return c.json(...)` for an error (§4.2).
- Every `code` is in `ERROR_REGISTRY`; no string literal at a throw site (§5). The new code goes in
  the registry **and** in `EXPECTED_STATUS` (`error.codes.test.ts`), which asserts the lists are equal.
- Messages are one plain sentence — no status prefix, no SQL, no table/column names, no raw ids (§8).
- Multi-step writes keep running in `db.transaction()`; this feature adds no write of its own.
- **Feature-specific:** the allowance is DERIVED, never stored — no counter column, so it cannot
  drift from the evidence rows it summarises.
- **Feature-specific:** `max`, `required`, `attached` and `remaining` are computed in exactly one
  place (`buildPhotoAllowance`), so the host items, the field page and the cap enforcement cannot
  disagree about the headroom.
- **Feature-specific:** the photo cap counts PHOTOS only. A document must never be refused because
  the photo allowance is spent.
- **Feature-specific:** the required photo types remain advisory. This feature does not add
  enforcement that a required type is present, and does not change when an item becomes
  `photos_collected`.
- **Feature-specific:** no route, path or method is added — the change rides entirely on existing
  endpoints (task 4).

## Out of scope

- **Enforcing the required shot types.** An item with only one of its two `damage` shots stays
  `photos_collected`. Making the requirement binding is a different feature with its own error code.
- **A per-photo "is this additional" flag.** The schema has no column for it and this feature adds
  none; only the count is bounded.
- **Tightening the mints.** `MAX_EVIDENCE_PER_ITEM` stays the mint's batch bound (D13). A client can
  still be handed tokens for more photos than the cap will accept; the write refuses them.
- **Any change to `assets.photo_proof_requirement`** or the inspection-side shot labels (D1).
- **Raising or configuring `MAX_ITEM_PHOTOS` per asset or per claim.** It is one constant.
- **Client work.** The frontend instruction above is documentation; no client is in this repo.
- **Noticed but untouched:** `fieldSubmitErrors` (`incidents.field.contract.ts`) does not name
  `EVIDENCE_KEY_INVALID` or `MAX_EVIDENCE_EXCEEDED`, both of which the submit handler throws today
  (their 400 status is covered by `VALIDATION_ERROR`). This feature names all three in that bundle
  because it edits it (D15) — the rest of the repo's over-declared bundles are left alone.

## Open questions

None.
