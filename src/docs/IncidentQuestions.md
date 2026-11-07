# Purpose
This file is here so it can check if the incident code will satisfy all the situations we need related to the incidents.

Answers below are written against the code as it stood on `feature/51_incident-initial-setup`
(commit `97b18eb feat(51): add incident p1`), cross-checked against `src/docs/incidents.md`,
`src/docs/incidents.decisions.md` and `src/docs/incidents/p1.md`–`p5.md`.

> **Resolved.** Every finding below has since been fixed in the code, in the order the audit
> ranked them: the three that "would bite first" (D3, D1, S1) and then the rest. The audit's
> numbering is preserved — it is the record of what was wrong and why it mattered — but nothing
> here is outstanding. The decisions that record each fix are D32–D43 in
> `src/docs/incidents.decisions.md`, and `src/docs/incidents.md` is updated to match. Read the
> sections below as *what the first cut got wrong*, not as a current to-do list.
>
> Where a comment is quoted as contradicting the code, the comment was made true rather than
> deleted: the dedupe (C2) now happens before the insert, and the baseline payload (V1) is
> documented as returning a signed URL because that is what it does.

---

# Questions

## 1. Can you delete the Incident? Is there a specific endpoint that will delete the incident?

**No. There is no delete endpoint, and no update endpoint either.**

The incident module registers exactly three host routes (`src/modules/incidents/incidents.contract.ts`):

| Method | Path | Line |
| --- | --- | --- |
| POST | `/incidents` | `incidents.contract.ts:55` |
| GET | `/incidents/{id}` | `incidents.contract.ts:86` |
| POST | `/incidents/{id}/confirm-airbnb-filing` | `incidents.contract.ts:111` |

That is the whole surface. `grep -rn "method: \"delete\"" src/modules/` finds deletes only in
`assets` and `reservations`. There is no `DELETE /incidents/{id}`, no `PATCH`, no archive flag.

This is deliberate, not an oversight — `src/docs/incidents.md:103` lists it under **Out of scope**:

> - **Editing or deleting an incident.** No `PATCH`, no `DELETE`. No re-issuing a token.

**Why this matters more than it looks.** The database makes a claim un-deletable *and*
un-recreatable in one move:

- `incidents.reservation_id` is `.unique()` (`src/db/schema/incidents.ts:35-38`), so one claim per
  reservation, forever.
- The route checks that uniqueness *before* inserting and answers `409 INCIDENT_ALREADY_EXISTS`
  (`incidents.route.ts:127-131`).
- Deleting the *reservation* cascades the claim away (`onDelete: "cascade"`), so that is the only
  way a claim ever disappears — and it takes the reservation with it.

So a host who opens a claim against the wrong asset has no correction path: they cannot delete the
claim, cannot edit its items, and cannot create a replacement, because the reservation is already
taken. The `409` is a permanent dead end.

D6 and R4 (`incidents.decisions.md`) show the authors were aware of exactly this trap — they chose
to *reject* out-of-window creation rather than store an `unfeasible` row, with the stated reason:

> `reservations_id UNIQUE` means one junk row permanently blocks the reservation from ever having a
> real claim.

That reasoning applies with equal force to a claim created with the wrong items, and nothing
guards that case.

---

## 2. Can you, on the created Incident, add a new incident item? Is there an endpoint for that?

**No. Items exist only at creation time, and can never be added afterwards.**

`CreateIncidentBodySchema` (`incidents.schema.ts:78-91`) takes `reservationId` + `items[]` with
`.min(1)`, and `incidentsService.create` (`incidents.service.ts:203`) inserts the incident and all
its items in one transaction. There is no second write path into `incident_items`.

`R12` in `incidents.decisions.md` rejected the route explicitly:

> **R12** | A `POST /incidents/{id}/items` route to add items after creation | The blueprint's flow
> creates the incident and its items together, and `UNIQUE(incident_id, asset_id)` makes a later add
> a separate idempotency problem. Out of scope; a host who forgot an asset creates a second
> incident — which the 1:1 constraint already prevents, so the omission is caught at creation
> instead.

Note what that last clause actually concedes: the fallback ("create a second incident") is
**blocked by the 1:1 constraint**. So the practical answer to "the host forgot an asset" is that
there is no recovery at all — see the dead-end analysis in Q7, finding **D1**.

There is also no way to re-run item creation for a claim whose items are all still
`link_generated`. `incidentsService.create` is the only writer of `incident_items`.

---

## 3. Can you edit or delete the incident item?

**No to both.** `incident_items` has exactly one writer at creation (`incidents.service.ts:230-244`)
and one field-driven update at photo submit (`incidents.service.ts:457-467`).

The only mutation that ever touches an item row is the field submit, and it sets exactly four
things:

```ts
.set({
  status: "photos_collected",
  descriptionByCleaner: body.descriptionByCleaner ?? null,
  tokenExpiresAt: new Date(),   // burns the token
  updatedAt: new Date(),
})
```

So the fields a host might reasonably want to correct are all frozen:

| Field | Written when | Editable after? |
| --- | --- | --- |
| `assetId` | creation | no |
| `type` (`damage`/`theft`) | creation | no |
| `estimatedPlaceholderValueCents` | creation | no |
| `descriptionByCleaner` | field submit, once | no |
| `status` | creation → field submit | no |

Two consequences worth naming:

- **A mis-typed `type` is permanent and it poisons the evidence.** `ALLOWED_EVIDENCE`
  (`incidents.field.route.ts:23-26`) decides which photos a cleaner may submit from the item's
  `type`. Mark an item `theft` when it was actually `damage` and the cleaner is *forced* to submit
  `theft_empty_space_photo` — the submit route rejects the damage close-ups with
  `400 EVIDENCE_TYPE_MISMATCH` (`incidents.field.route.ts:107-113`). The wrong evidence is baked
  into the claim.
- **The claim total can never be corrected.** `placeholderTotalAmountCents` is computed once at
  creation as the sum of the items (`incidents.service.ts:218-221`). `finalPayoutRequestedCents`
  has **no writer anywhere** in `src/` — it is only ever the default `0`
  (`src/db/schema/incidents.ts:47-49`). The prep doc calls valuation "very important"; today the
  money on a claim is a provisional host guess that nothing can revise.

For deletion: `incident_items.asset_id` is `onDelete: "restrict"` (`incident-items.ts:50-52`), which
protects the asset from deletion. But nothing deletes *the item* — not the host, and not by cascade
except via the incident or reservation.

---

## 4. How are photos added to incident items? Is this the same 2-endpoint flow as the inspection photo proofs? Can we delete these photos?

### Short answer

The shape is the same (presign → PUT → confirm), but the *mechanics* differ in five ways that
matter. And **no, photos cannot be deleted** — not hard, not soft.

### The flow, as built

The "2 endpoint flow" in this repo lives on the **apartments** module, not inspections:

| Step | Existing proof flow | Incident field flow |
| --- | --- | --- |
| 1. Mint | `POST /apartments/{id}/photos/upload-tokens` (`apartments.contract.ts:115`) | `POST /field/ingest/{token}/upload-tokens` (`incidents.field.contract.ts:78`) |
| 2. PUT | client PUTs bytes straight to R2 | same |
| 3. Confirm | `POST /apartments/{id}/photos/confirm` (`apartments.contract.ts:145`) | `POST /field/ingest/{token}/submit` (`incidents.field.contract.ts:110`) |
| Read back | `GET /reservations/{id}/photos` (`reservations.contract.ts:63`) | `GET /incidents/{id}` (evidence nested under items) |

Both mint through `PutObjectCommand` + `getSignedUrl(..., { expiresIn: 300 })` and store an R2
**storage key**, never a URL — `apartments.service.ts:114-130` vs `incidents.service.ts:407-429`.

### The five differences

1. **Auth is a bearer token in the path, not a session.** The apartments flow sits behind
   `authGuard` + `rolesGuard` + `apartmentGuard`. Every `/field/ingest/*` route has **no guard at
   all** — `incidents.field.route.ts:10-18` states this as design (D17). Possession of the 32-hex
   token *is* the credential.

2. **The key prefix is namespaced and verified.** Incident keys are minted under
   `incidents/{incidentId}/{itemId}/{uuid}.{ext}` (`incidents.service.ts:416`), and submit refuses
   any key that does not start with that item's own prefix
   (`incidents.field.route.ts:119-127`). The apartments flow has no equivalent check — it only
   verifies the key exists in the payload.

3. **Confirm is one-shot, not idempotent.** `syncUploadedPhotos` (`apartments.service.ts:142`) is a
   batch *replace*: it soft-deletes active photos whose keys are absent from the incoming batch and
   upserts the rest, so re-confirming is safe. `submitFieldEvidence` is a pure insert that then
   **burns the token** (`incidents.service.ts:457-467`), so a second submit is
   `404 FIELD_TOKEN_INVALID`. There is no replace semantics anywhere.

4. **There is no photo cap.** `MAX_PHOTOS_PER_RESERVATION` (20) bounds the apartments flow twice —
   in `generateUploadTokens` (`apartments.service.ts:100`) and in `syncUploadedPhotos`
   (`apartments.service.ts:149`). `generateFieldUploadTokens` and `submitFieldEvidence` have **no
   bound at all**. `FieldSubmitBodySchema.photos` is `.min(1)` with no `.max()`
   (`incidents.schema.ts:186`).

5. **Deletion does not exist.** `apartment_images` carries `status: "active" | "soft_deleted"` and a
   `deletedAt` column (`src/db/schema/apartment-images.ts:36-39`), and `syncUploadedPhotos` sets
   them (`apartments.service.ts:168-182`). `claim_evidence` has **neither column** — its fields are
   `evidenceType`, `storageKey`, `exifCapturedAt`, `exifLatitude`, `exifLongitude`, `createdAt`
   (`src/db/schema/claim-evidence.ts:37-58`).

### So: can we delete the photos?

**No.** There is no `DELETE` route, no soft-delete column, and no code that ever removes a
`claim_evidence` row. `grep -rn "claimEvidence" src --include=*.ts` returns exactly one write site
(`incidents.service.ts:446`) and one read site (the relational query in `getById`).

The only way a row disappears is by cascade — deleting the item (impossible), the incident
(impossible), or the reservation.

The practical failure: a cleaner uploads a blurry photo, submits, and the token is spent. The item
is now `photos_collected`, the link is dead, and **nothing** — host or cleaner — can add, replace or
remove that photo. There is no re-issue route either (`incidents.md:103`).

---

## 5. Is there a distinction between photos and other documents used for proofing the valuation?

**Structurally, no — and the document half is unimplemented.**

Everything lives in one table, `claim_evidence`, discriminated only by a single enum column:

```ts
export const evidenceFileTypeEnum = pgEnum("evidence_file_type", [
  "damage_photo_wide",
  "damage_photo_closeup",
  "theft_empty_space_photo",
  "original_purchase_receipt",
  "replacement_retail_quote",
  "handyman_invoice",
  "police_report",
]);
```

(`src/db/schema/claim-evidence.ts:20-28`)

Three members are photos, four are documents. They share the same columns: same `storage_key`, same
nullable EXIF trio, same `incident_item_id` parent. There is no `kind` column, no separate table, no
separate route.

The enum comment says the documents are declared now purely so the storage format never has to
change later:

> `original_purchase_receipt`, `replacement_retail_quote`, `handyman_invoice` and `police_report`
> are the document half of the lifecycle. They are declared now so the storage format never changes
> when that half lands, **and nothing in this feature writes them** (D22).

**Three things make that distinction unenforceable today:**

1. **No endpoint accepts a document type.** `FieldSubmitPhotoSchema.evidenceType` is a closed enum
   of the three *photo* values only (`incidents.schema.ts:171-175`). A receipt cannot be submitted
   through any route.
2. **The per-type gate is photos-only.** `ALLOWED_EVIDENCE` (`incidents.field.route.ts:23-26`) maps
   `damage → [damage_photo_wide, damage_photo_closeup]` and `theft → [theft_empty_space_photo]`.
   Documents are absent from both lists, so they would fail the check even if the schema allowed
   them.
3. **The EXIF columns are photo-only semantics.** `exifCapturedAt`/`exifLatitude`/`exifLongitude`
   are meaningless for a PDF receipt, but they are nullable on every row regardless.

So the honest answer: the *storage* distinguishes them by enum value; the *system* has no
distinction in behaviour, because only the photo third exists. The prep doc's central ask — "the
system needs to drive the user what needs to be provided so the damage claim will have more chance
of success" — is not built.

---

## 6. Walk me through the flow of adding an incident. What are the steps, from the system's perspective?

There are two surfaces: the **host** surface (authenticated) and the **field** surface (token-only).

### Phase A — Host creates the claim

**A1.** `POST /incidents` with `{ reservationId, items: [{ assetId, type, estimatedPlaceholderValueCents? }] }`.
Guards: `authGuard` → `rolesGuard(["admin","host"])` (`incidents.contract.ts:59`).

**A2.** Route loads the reservation (`incidents.route.ts:79`). Unknown id → `404 RESERVATION_NOT_FOUND`.

**A3.** Ownership is asserted against the *reservation's apartment*, via `assertApartmentOwnership`,
**not** `apartmentGuard` (`incidents.route.ts:85-89`). This is D21: `apartmentGuard` would answer
`APARTMENT_NOT_FOUND` for a reservation that simply does not exist.

**A4. Window check, clause 1.** `effectiveCheckOut = alternativeCheckOutDatetime ?? checkOutDatetime`
(the repo-wide epoch-guard rule, `incidents.route.ts:17-26`). If
`now > effectiveCheckOut + 14 days` → `400 INCIDENT_WINDOW_EXPIRED` with `reason: "checkout"`
(`incidents.route.ts:99-104`).

**A5. Feasibility — one query, two outputs.** `assessFeasibility` (`incidents.service.ts:143-192`)
finds the earliest booking at this apartment whose check-in falls *after this stay's check-out*, and
returns `{ nextCheckIn, isEmergency }` together. This is D29 — splitting the two into separate
queries is how a host ends up shown "emergency" on a claim the same request then refuses.

- `now > nextCheckIn` → `400 INCIDENT_WINDOW_EXPIRED`, `reason: "checkin"` (`incidents.route.ts:120-125`).
- `nextCheckIn - now < 4h` → `isEmergencyMode = true` (`incidents.service.ts:190`).
- No next booking → `{ nextCheckIn: null, isEmergency: false }`.

**A6.** Existing claim for this reservation? → `409 INCIDENT_ALREADY_EXISTS` (`incidents.route.ts:127-131`).

**A7.** Per item, before any insert: asset exists (`404 ASSET_NOT_FOUND`) and belongs to this
apartment (`400 ASSET_NOT_IN_APARTMENT`) (`incidents.route.ts:136-146`). Checked first so the client
gets the offending asset named rather than a constraint failure.

**A8. One transaction** (`incidents.service.ts:211-272`) writes:
- the incident row: `status: "draft"`, `isEmergencyMode`, `placeholderTotalAmountCents` = sum of
  item values (D3 — computed server-side so the total can never disagree with the rows),
  `aircoverEscalationDeadlineAt = effectiveCheckOut + 30 days` (D7 — frozen at creation).
- the item rows: `status: "link_generated"`, `cleanerToken = crypto.randomUUID()` minus dashes
  (32 hex, D12), `tokenExpiresAt = now + 12h` (D11).
- then reads the asset rows to hydrate the response.

**A9.** `201` returns the claim with items — and this is **the only response that ever carries
`cleanerToken`** (`incidents.schema.ts:93-100`, D11). `IncidentItemSchema` omits it, and
`getIncidentRoute` never returns it.

**A10. Delivery is unbuilt.** Nothing emails or SMSes the link (`incidents.md:88-89`). The host
copies the token out of the create response and relays it by hand.

### Phase B — Cleaner submits evidence

**B1.** `GET /field/ingest/{token}` — **no guard**. `getFieldContext` resolves the token and returns
`null` for every failure mode at once (unknown, expired, already-burned), so all three answer
`404 FIELD_TOKEN_INVALID` and the route cannot be used as a token oracle (D17).

Returns: `incidentType`, `itemStatus`, the asset reduced to `{id, name, roomLocation, description}`,
`apartmentName`, `baselinePhotos`, `tokenExpiresAt`. Deliberately **no guest identity and no money**
— a separate schema from the host payload, asserted by a test.

**B2.** `POST /field/ingest/{token}/upload-tokens` with `{ photos: [{ fileType }] }` → presigned PUT
URLs under `incidents/{incidentId}/{itemId}/{uuid}.{ext}`, 300s TTL. Writes nothing.

**B3.** Client PUTs the bytes directly to R2. The server never sees them.

**B4.** `POST /field/ingest/{token}/submit` with `{ descriptionByCleaner?, photos: [{ evidenceType,
storageKey, capturedAt?, latitude?, longitude? }] }`. Two validations before any write:
- `evidenceType` must be in `ALLOWED_EVIDENCE[item.type]` → else `400 EVIDENCE_TYPE_MISMATCH` (D13);
- `storageKey` must start with `incidents/{incidentId}/{itemId}/` → else the same error. Without
  this an unauthenticated caller could point the claim at any object in the bucket.

**B5. One transaction** (`incidents.service.ts:445-474`) does four things atomically:
1. inserts the `claim_evidence` rows (EXIF from the body — no extraction job, D10);
2. moves the item to `photos_collected`, stores `descriptionByCleaner`;
3. **burns the token** by setting `tokenExpiresAt = now` (single-use, D11);
4. runs **Trigger B** — `markReadyIfAllItemsCollected` (`incidents.service.ts:577-601`):
   `UPDATE incidents SET status='ready_to_file' WHERE id = ? AND status='draft' AND NOT EXISTS (any
   sibling whose status != 'photos_collected')`.

The `AND status='draft'` makes it idempotent and stops it resurrecting a filed claim; `NOT EXISTS`
is what makes it an aggregate rather than a per-item flag (D15).

### Phase C — Host files with Airbnb

**C1.** `GET /incidents/{id}` returns the claim, items, assets and evidence — no tokens.

**C2.** `POST /incidents/{id}/confirm-airbnb-filing`. Order of checks
(`incidents.route.ts:164-186`): already `submitted_to_guest` → `409 INCIDENT_ALREADY_FILED`; not
`ready_to_file` → `409 INCIDENT_NOT_READY`; else the guarded update sets
`status = "submitted_to_guest"`, `resolutionCenterSubmittedAt = NOW()`,
`guestResponseDeadlineAt = NOW() + 24 hours` (Trigger C). Both clocks run from `NOW()`, not from the
stored escalation date. The status guard lives in the `WHERE` clause too, so a concurrent filing
matches no row and returns `null` → `409 INCIDENT_ALREADY_FILED`.

### Phase D — nothing

There is no Phase D. No escalation to AirCover, no valuation, no resolution, no reminder. The claim
sits at `submitted_to_guest` forever, with a 24-hour guest deadline and a 30-day escalation deadline
stored and never read.

---

## 7. Do you see some flaws and gaps in the current incident setup?

Yes — quite a few. Grouped by what breaks.

### D. Dead ends (a mistake cannot be corrected)

**D1 — No way to add an item after creation, and no way to recreate the claim.** This is the biggest
functional gap. Items exist only in the create payload (Q2). A host who discovers a second damaged
asset on day 3 has no path: `POST /incidents/{id}/items` does not exist (R12), and a second incident
is blocked by `reservation_id UNIQUE` → `409 INCIDENT_ALREADY_EXISTS`. The claim permanently
under-reports the damage. Note that R12's own stated fallback ("creates a second incident") is
exactly what the 1:1 constraint forbids.

**D2 — No delete, no edit.** Q1 and Q3. A claim opened against the wrong asset, or with `type`
mis-set, is permanent. Because the reservation is then consumed, the error is unrecoverable.

**D3 — A dead token permanently freezes the whole claim.** `markReadyIfAllItemsCollected` requires
*every* sibling to be `photos_collected`. Tokens live 12 hours from creation, and there is no
re-issue route. Miss the window on one item and that item is stuck at `link_generated` forever, the
claim is stuck at `draft` forever, and `confirm-airbnb-filing` answers `409 INCIDENT_NOT_READY`
forever. No admin override, no way out. **One expired link bricks a claim.**

**D4 — Photos are write-once and undeletable.** Q4. A blurry or wrong photo submitted by mistake is
in the claim permanently; the token is already spent. The apartments flow solved exactly this with a
replace-and-soft-delete confirm (`apartments.service.ts:167-182`); incidents have no equivalent.

### S. Abuse surface (the token is the only credential)

**S1 — No photo cap on the field surface.** `generateFieldUploadTokens` and `submitFieldEvidence`
have no bound (Q4). The apartments flow caps at 20 in two places. An unauthenticated bearer-token
holder can mint unlimited presigned URLs and insert unlimited `claim_evidence` rows. `photos` is
`.min(1)` with no `.max()` (`incidents.schema.ts:186`).

**S2 — No revocation.** The token is a URL-safe bearer credential with a 12-hour TTL. There is no
route to invalidate it early and no route to re-issue it. If it is sent to the wrong person, or the
cleaner's phone is lost, the only mitigation is waiting out the TTL. Given that delivery is unbuilt
and the token is returned in a JSON body, it will in practice be pasted into a chat thread.

**S3 — The token's lifetime starts at creation, not at first use.** A token minted at 09:00 is dead
at 21:00 even if the cleaner opens it at 20:55. Combined with D3 and S2, a late turnover means the
claim is permanently stuck.

### C. Correctness and message bugs

**C1 — The `"checkin"` window message describes a check that does not exist.** The condition is
`now > nextCheckIn` — the next guest has *already arrived* (`incidents.route.ts:120`). But the
message renders:

```
This claim cannot be opened before the stay begins on {deadline}.
```

(`incidents.errors.ts:60-64`). "Before the stay begins" describes a future arrival; the actual state
is a past one. Worse, **no check prevents opening a claim before a stay begins** — for an
unstarted stay the "next guest" is in the future, so clause 2 passes and clause 1 is measured from a
future check-out, so it passes too. The message claims a rule the code does not implement.

**C2 — Duplicate assets in one request are not deduped, despite comments claiming they are.** Two
items with the same `assetId` in a single POST hit the DB's `UNIQUE(incident_id, asset_id)`
constraint. The route's pre-check loop (`incidents.route.ts:136-146`) validates existence and
apartment but never tracks seen `assetId`s, so nothing catches it first. The result is a raw driver
error (`409 DUPLICATE_RECORD`/`500`), not a readable domain error.

Both comments assert otherwise:
- `incident-items.ts:39-40`: *"the domain layer asserts it first so the client gets a readable error
  rather than a constraint violation."*
- `incidents.decisions.md:100`: *"`incident_items_incident_asset_unique` → asserted in the domain
  layer first."*

Neither is true in the shipped code. This is a comment/code drift, and the exact case the comment
promises to handle is the one that falls through.

### M. Missing operational surface

**M1 — No list endpoint.** No `GET /incidents`, no `/incidents?apartmentId=`. A host can only fetch
a claim they already have the id for. There is no way to ask "which reservations have open claims?"
or "which claims are approaching the 30-day deadline?" — the operational view the feature exists to
serve. `IncidentsListSchema` is defined (`incidents.schema.ts:54-56`) and **never used by any
route**.

**M2 — Deadlines are stored and never read.** `aircoverEscalationDeadlineAt` and
`guestResponseDeadlineAt` are written and nothing acts on them (`incidents.md:98-99` concedes
this). No job, no warning, no check. A host who files and then forgets gets no prompt.

**M3 — `isEmergencyMode` has no consequence.** It is computed, stored and returned as a column, but
no code branches on it — no prioritisation, no escalation, no ordering. Right now it is a flag
nothing reads.

**M4 — Half the status enum is unreachable.** `incident_status` has 6 values; only `draft`,
`ready_to_file` and `submitted_to_guest` are ever written. `escalated_to_aircover`, `resolved` and
`unfeasible` have no transition (D6, D22). Likewise `incident_item_status`: `documents_pending` and
`complete` have no writer. Defensible as forward declaration, but "status" today is a 3-of-6 field.

**M5 — No valuation workflow.** `finalPayoutRequestedCents` has **no writer at all** — it is
permanently `0`. `estimatedPlaceholderValueCents` is host-entered with no supporting evidence
required, and cannot be corrected (Q3). The four document enum members have no upload route, no
schema field and no write path. The prep doc's core ask about driving the user toward
reimbursement-quality proof is unimplemented.

### V. Payload and comment drift

**V1 — The baseline photo payload returns signed URLs, contradicting its own comment.** The service
returns `{ storageKey, downloadUrl }` with a freshly signed GET URL
(`incidents.service.ts:555-564`), and the route passes it straight through. But the comment beside
that pass-through says the opposite:

> `incidents.field.route.ts:71-72` — *"Keys only — the field surface never sees a signed URL it did
> not ask for, and the client fetches through the same presign flow."*

The schema also declares `downloadUrl: z.string().nullable()`, though the service never produces
`null`. Not a security hole — the URLs are 300s and scoped to the baseline photos — but the comment
is wrong about the code beneath it.

**V2 — The baseline overlay is apartment-scoped, not asset-scoped.** `getBaselinePhotos` returns the
previous stay's `checkin_state` photos for the whole **apartment**
(`incidents.service.ts:486-565`). The prep doc's intent is "photos for the state before" *per
asset*. A cleaner photographing a damaged kettle is shown the previous stay's living-room shots as
their framing reference.

**V3 — `submitFieldEvidence` returns a hardcoded status.** It returns
`{ itemStatus: "photos_collected", ... }` as a literal (`incidents.service.ts:472`) rather than the
value the update produced. Correct today, but it will silently lie the moment a second transition
exists.

---

## Summary — the three that would bite first

1. **D3 — one expired link permanently bricks a claim.** No re-issue, no override, and the claim can
   never be recreated because the reservation is consumed. This is the one most likely to happen in
   normal operation.
2. **D1 — items can never be added.** The domain's own 1:1 rule forecloses the workaround R12
   assumed. Any damage discovered after creation is unreportable through the system.
3. **S1 — no cap on an unauthenticated write path.** The only existing precedent
   (`MAX_PHOTOS_PER_RESERVATION`) was deliberately not carried over.

The setup is a solid *initial* slice — the state machine, the trust boundary and the transactional
discipline are all sound — but it is a **create-and-freeze** system: everything is decided in the
first request, and nothing after it can be corrected. That is consistent with `incidents.md`'s
out-of-scope list, so it reads as intentional scoping rather than oversight. The two places where
the *documentation* overstates the *code* are C2 (the dedupe comment) and V1 (the keys-only
comment); those are worth fixing regardless of what gets built next.
