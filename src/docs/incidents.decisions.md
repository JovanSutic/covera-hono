# Incidents — decisions

Every choice an executor would otherwise make mid-flight. Approve this table in one pass, or edit it
in place; do not leave a row `OPEN`.

**Status values:** `APPROVED` · `OPEN` (blocks execution) · `REJECTED` (kept for the record)

`APPROVED` here means "decided by the model under the operator's standing instruction to decide and
document" — this document *is* the record to review. Any row the operator disagrees with is a
one-line edit and a re-run of the phase that depends on it.

---

## Decisions

### Shape and naming

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D1 | Module directory is `src/modules/incidents/`, mounted at `/incidents`; the field surface is a **second route file in the same module**, `incidents.field.route.ts`, mounted at `/field/ingest`. | One entity, one module. The field routes are a different trust boundary but the same domain, and they share `incidentsService` and `incidents.errors.ts`. A separate `src/modules/field/` tree would duplicate both. Two route files is the smallest split that lets the unauthenticated surface be read (and reviewed) on its own. | APPROVED |
| D2 | Response schemas are `Incident`, `IncidentItem`, `IncidentWithItems`, `FieldIngest`, `FieldSubmitResponse`, registered via `.openapi("…")`. | Matches `Reservation`, `Inspection`, `Asset`. `IncidentWithItems` is the create/get payload: one incident with its `items` array and each item's `evidence` array — the client needs all three to render the claim. | APPROVED |
| D3 | Money is stored as **integer cents** in columns named `*_cents` (`placeholder_total_amount_cents`, `final_payout_requested_cents`, `estimated_placeholder_value_cents`), not `DECIMAL(10,2)`. | Follows the repo: `assets.approximate_value_cents` is `integer`. Integer cents cannot drift under float arithmetic and needs no decimal serialisation in JSON. Deviates from the blueprint's DDL — recorded here so it is not "fixed" back. | APPROVED |
| D4 | Evidence files are stored as an R2 **storage key** (`claim_evidence.storage_key`), not the blueprint's `file_url`, and the column is `UNIQUE`. | Matches `apartment_images.storage_key`, which is also `UNIQUE`. The upload flow is the existing presign → PUT → confirm pattern; the server never learns a URL. `UNIQUE` makes the confirm step idempotent. | APPROVED |
| D5 | `incident_items.asset_id` is `ON DELETE restrict`; `incidents.reservation_id` and `incident_items.incident_id` and `claim_evidence.incident_item_id` are `ON DELETE cascade`. | An asset named in a claim must not vanish — deleting it would destroy evidence. The claim itself is disposable: deleting the reservation or the incident should take its items and evidence with it. Mirrors `assets.asset_type_id` restrict vs `apartment_shot_assets` cascade. | APPROVED |
| D6 | Creating an incident outside the feasibility window is **rejected**, not stored as `unfeasible`. | The blueprint qualifies the check ("throw an automated unfeasible policy block"). `unfeasible` stays a registry enum member for a later admin override, but a rejected request must not leave a row: `reservations_id UNIQUE` means a junk row would permanently block the reservation from ever having a real claim. | APPROVED |

### Feasibility, clocks and the emergency flag

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D7 | `aircover_escalation_deadline_at = effectiveCheckOut + 30 days`, computed at creation, **NOT NULL**. | Blueprint §1 ("Checkout + 30 days"). `effectiveCheckOut` is `alternativeCheckOutDatetime` when it is a real date, else `checkOutDatetime` — the same `COALESCE` rule `assertCanCreateInspection` already uses. Storing it means the deadline is a fact, not a recomputation that can drift if the reservation is later edited. | APPROVED |
| D8 | `is_emergency_mode = (next check-in profile time - now) < 4 hours`, where "next check-in" is the **earliest** future reservation at the same apartment (excluding this one); no future reservation → `false`. | Blueprint Trigger A. "Profile time" = the same `alternative ?? checkIn` resolution. `false` when there is no next guest is the conservative default: the flag raises urgency, it never blocks anything. **Read with D9:** the flag and D9's second clause read the *same* next-guest check-in, and they must come from one query — see D29. | APPROVED |
| D9 | The feasibility window is: **accept** when `now <= effectiveCheckOut + 14 days` **AND** `now <= nextCheckIn`; reject otherwise. `nextCheckIn` is the check-in of the next reservation at the apartment **after this stay's check-out** (resolved `alternative ?? primary`); no next reservation → the clause passes. | Blueprint Trigger A, verbatim: `NOW() > (Previous_Guest_Checkout_Time + Interval '14 days')` **OR** `NOW() > Next_Guest_Checkin_Profile_Time`. **Both clauses reference neighbouring guests** — the first counts from the previous guest's check-out, the second refuses once the next guest has arrived. This corrects an earlier draft of this row that used `now > effectiveCheckIn` for the second clause: anchored on *this* stay's check-in, the test is self-contradictory, because a check-in after now is never before now, so clause 2 could never fire and a claim could be opened for a stay that started months ago. Anchoring on **this stay's check-out** is what makes the predicate mean "within 14 days after the stay ended, and before the next guest arrives" — the real Airbnb filing window. One error code (`INCIDENT_WINDOW_EXPIRED`) covers both clauses; the message says which. | APPROVED |

### Field intake and evidence

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D10 | No background job. `POST /field/ingest/{token}/submit` carries optional `capturedAt`, `latitude`, `longitude` per photo, validates them in the Zod schema, and writes them to `claim_evidence` in the same transaction. | The blueprint asks for an EXIF extraction background job. This repo has no queue, no KV binding, no `waitUntil` wiring, and `wrangler.toml` declares none. Adding one is a project-level infrastructure change, not a feature step. The columns and their semantics are identical, so the job can be added later without touching the stored data or the contract. | APPROVED |
| D11 | `token_expires_at = created + 12 hours`, and the token is **single-use**: `submit` sets `tokenExpiresAt = now`. | Blueprint: "created_at + 12 hrs max". Single-use follows from the item's own state machine — once it is `photos_collected` the link has no job left, and a replayable write endpoint holding evidence is a liability. A re-submit therefore returns `404 FIELD_TOKEN_INVALID`, not a conflict. | APPROVED |
| D12 | Token value is 32 hex chars from `crypto.randomUUID()` with dashes stripped, `varchar(64)`. | The blueprint's `VARCHAR(64)` with 32 chars of randomness is ~122 bits, far past guessing. `crypto.randomUUID()` is global in Node 22 and in Workers, so no new dependency, and `.replace(/-/g, "")` keeps it URL-safe. | APPROVED |
| D13 | `evidence_type` is validated against the item's `type`: a `damage` item accepts `damage_photo_wide` / `damage_photo_closeup`; a `theft` item accepts `theft_empty_space_photo`. Violation is `400 EVIDENCE_TYPE_MISMATCH`. | The enum alone cannot express this — it is a cross-field rule the database does not know about. Without it a theft claim can be filed with damage close-ups, which is exactly the "drive the user what to provide" the prep doc asks for. | APPROVED |
| D14 | `drizzle/0013` is generated by `npm run db:generate`, then the single statement `ALTER TABLE "assets" ALTER COLUMN "asset_type_id" SET NOT NULL;` is **deleted from the file by hand**. | Verified: the schema declares `assets.assetTypeId` `.notNull()`, but snapshots `0000`–`0012` never recorded it, so the generator emits this drift statement into our migration. Shipping it would add a NOT NULL constraint on an existing production table as a side effect of an unrelated feature — and it would fail on any row already holding NULL. Removing it leaves the drift exactly as it was found. | APPROVED |
| D15 | Trigger B (item → `ready_to_file`) runs **inside the submit transaction**, as a single `UPDATE items … ; UPDATE incidents SET status='ready_to_file' WHERE id = … AND status='draft' AND NOT EXISTS (unfinished siblings)`. | Blueprint Trigger B. Doing it in the same transaction makes the aggregate and the item write atomic — there is no window where a finished claim still reads `draft`. The `AND status='draft'` guard makes the update idempotent and keeps it from resurrecting a filed claim. | APPROVED |
| D16 | The baseline "previous stay's turnover photo" is read as the apartment's shots joined to the **most recent earlier reservation's** active `checkin_state` images. If there is none, the field returns `baselinePhotos: []`. | Blueprint §3 requires `GET /field/ingest/:token` to return it "for overlay framing". Reuses `buildProofShots` / `toAssetWithType` (`@/core/utils/proof-shots`) rather than a second mapping, per that file's own warning. An empty array is a real state (first-ever stay) and the client renders without an overlay. | APPROVED |
| D17 | The field surface is unauthenticated by design; **no** guard is mounted on any `/field/*` route, and this is stated in the contract as a comment. | Blueprint §3: "unauthenticated, tokenized dynamic links for field staff". The token in the path is the credential. `check-contracts.ts` only requires 500 for a guard-less route, so no 401/403 is declared — declaring one would document a status the route cannot produce. | APPROVED |

### Errors, wiring and process

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D18 | Eight new codes, each in `ERROR_REGISTRY` **and** in `EXPECTED_STATUS` (`error.codes.test.ts`): `INCIDENT_NOT_FOUND` 404, `INCIDENT_ALREADY_EXISTS` 409, `INCIDENT_NOT_READY` 409, `INCIDENT_ALREADY_FILED` 409, `INCIDENT_WINDOW_EXPIRED` 400, `ASSET_NOT_IN_APARTMENT` 400, `EVIDENCE_TYPE_MISMATCH` 400, `FIELD_TOKEN_INVALID` 404. | The registry test asserts `Object.keys(EXPECTED_STATUS).sort()` equals the registry's, so adding to one without the other is a red gate — that is the point of the test. `FIELD_TOKEN_INVALID` is deliberately **not** a distinct 401: the token is a path segment, not an Authorization header, and a 404 keeps the field surface from confirming which tokens once existed. | APPROVED |
| D19 | `incidents.errors.ts` uses `defineErrors({…}, StandardErrorSchema)` for the module's throwers; contracts spread `errorResponses([...AUTHED, ...ROLE, …])` for the host routes and an explicit code list for the field routes. | Both are the established patterns (§7 and `error.responses.ts`). The host routes need `AUTHED`/`ROLE`/`APARTMENT_SCOPED`; the field routes need neither, so they list only `VALIDATION_ERROR` and `FIELD_TOKEN_INVALID`. `check-contracts.ts` resolves both forms. | APPROVED |
| D20 | `incidents` and `incidentItems` are added to the `resourceRegistry` in `db-validator.ts`, and the two rows are added to the `expected` array in `db-validator.test.ts`. | `checkExistence(db, "incidents", id)` is how the host routes resolve existence, exactly as `inspections` does. The test's `expected` array is an explicit list — leaving it stale means the new rows are unverified. | APPROVED |
| D21 | Handlers resolve the reservation → apartment and call `assertApartmentOwnership`, **not** `apartmentGuard`. | Same reasoning as `reservations.route.ts` D5: `apartmentGuard` resolves an unknown id through the apartments table first and would answer `APARTMENT_NOT_FOUND` for a reservation that simply does not exist. The routes need the reservation row anyway, so ownership is asserted against the apartment it carries. | APPROVED |
| D22 | The item status transition is `link_generated → photos_collected`, and only that. `documents_pending` and `complete` are enum members with no writer. | Prep doc scopes this feature to the photo half. Shipping the enum values now means the storage format never changes when the document half lands. Recorded in the spec's out-of-scope so nobody adds a half-wired transition. | APPROVED |
| D23 | Response fields are camelCase (`storageKey`, `evidenceType`, `capturedAt`); the one exception is `asset_type` on the baseline photo payload, which the shared `toAssetWithType` mapper produces. | `drizzle-zod` derives camelCase from the column names, and every other module serves camelCase. The exception is not a choice — it is what the shared proof-shots mapper already emits, and re-mapping it here is how the two payloads drift. | APPROVED |
| D24 | **Five** phases: P1 schema+migration, P2 errors+schema, P3 host lifecycle, P4 field read + upload-token mint, P5 field submit + aggregation. One commit per phase, plus one for the docs. | P2 needs P1's tables. P3 needs P2's codes, throwers and payload shapes. P4 and P5 share the field files, but P4 is read-and-mint (no writes) and P5 is the write path **plus Trigger B**, the only state-machine logic in the feature — landing them together would bury that predicate in the same commit as the plumbing around it. One commit per phase because `.husky/pre-commit` re-runs the whole suite; docs stay separate from code (skill Stage 7; the `ed4e94e` post-mortem). | APPROVED |
| D25 | Tests: `incidents.test.ts` (host routes), `incidents.field.test.ts` (field routes), `incidents.service.test.ts` (transitions and the aggregation predicate). Each phase ends with its own test step. | Route tests sit with the module; the service file mirrors `apartments.service.test.ts` and `assets.service.test.ts`, which is where a chainable mock is the established way to observe a transition the route mock swallows. | APPROVED |
| D26 | No update to `src/docs/errorHandle.md`. | The feature adds codes to the registry (§5's table is a registry mirror, and it already lists codes the doc's table omits, e.g. `MAX_PHOTOS_EXCEEDED`). It changes no rule. If the operator wants §5's table kept in sync, that is a docs pass across every existing code, not a line in this feature. | APPROVED |

### Corrections found while proving the plan

These were discovered by building each phase's own code and running the gate against it, not by
re-reading the plan. Each one would have been executed into the code as a defect.

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D27 | `incidentErrors` also exposes three throwers over **pre-existing** registry codes: `unauthenticated` (401 `AUTH_TOKEN_MISSING`), `reservationNotFound` (404 `RESERVATION_NOT_FOUND`), `assetNotFound` (404 `ASSET_NOT_FOUND`). | D18 counted eight new codes; these three add no new code, because the registry already carries them and `check-contracts.ts` resolves `...bundle` spreads through the real `ERROR_REGISTRY`. The module needs them as *throwers* so a route can fail cleanly rather than hand-building a response — which invariant 2 forbids. Consequence for phase 2: `EXPECTED_STATUS` gains exactly the eight D18 codes, and `incidents.errors.ts` is longer than eight entries. | APPROVED |
| D28 | `scripts/check-contracts.ts` globs **every `*.contract.ts` in a module directory**, not just `<module>.contract.ts`. | The original glob was built from the module *name*, so `incidents.field.contract.ts` — the unauthenticated surface, the one most in need of static checking — was invisible to the gate. Broadening it immediately caught three genuine missing-`INTERNAL_SERVER_ERROR` declarations in this feature's own field contract. This is a **change to an established rule** (skill Stage 2), so it is called out here and belongs in the PR description. | APPROVED |
| D29 | Trigger A's two clauses and the emergency flag are read by **one** service method, `incidentsService.assessFeasibility(db, apartmentId, {reservationId, effectiveCheckOut, now}) → {nextCheckIn, isEmergency}`. | Splitting "is there a next guest" from "how soon is the next guest" into two queries is how a host is shown `isEmergencyMode: true` on a claim the same route then refuses: the two queries can disagree about which booking is "next" when one filters on `now` and the other on this stay's check-out. One read, one answer. The route calls it once and uses both outputs. | APPROVED |
| D30 | `IncidentItemSchema` and `IncidentItemWithTokenSchema` are derived from a shared `IncidentItemBaseSchema` (`SelectIncidentItemSchema.extend({asset, evidence})`), never by re-extending an `.omit()`. | A verified `TS2353`: Zod's `.omit()` returns an object whose inferred output has the key removed, and `.extend()` on it will not accept that key back. The plan's first draft wrote `IncidentItemSchema.extend({cleanerToken})` and **does not compile**. Deriving both shapes from one base is also what makes "the token appears in exactly one response schema" structural rather than a comment. | APPROVED |
| D31 | Every phase's file is proved by assembling the tree from the plan file and running `npm run gate` against it, at planning time. Measured: P3 alone → **508 tests**, 34 routes, 27 paths; P3+P4 → **520 tests**, 36 routes, 29 paths; P3+P4+P5 → **558 tests**, 37 routes, 30 paths, all `GATE PASSED`. | The skill's Stage 6 requires a green baseline; it does not require proving the *plan*. Two of the defects above (D29's logic, D30's compile error) were invisible to review and only surfaced when the plan's own code was built. Doing this at planning time costs one gate run per phase and removes the entire class of "the plan does not compile" round trips. | APPROVED |

---

## Checklist — close every one of these before approval

**Shape**
- [x] Route paths and methods — D1, and the six rows in the spec's Behaviour table
- [x] Success statuses — `201` create, `200` everywhere else
- [x] Request strictness — Zod object schemas; unknown keys are stripped by default, not rejected
- [x] Pagination — n/a: no list endpoint. `GET /incidents/{id}` returns one claim.

**Auth**
- [x] Guards per route, in order — `authGuard` → `rolesGuard(["admin","host"])`, then ownership (D21)
- [x] Roles — `admin`, `host`. `guest` gets `403 FORBIDDEN_ROLE`.
- [x] Deliberately unauthenticated — all three `/field/*` routes, by design (D17)

**Failure modes**
- [x] Registry code for each — D18; every one is either new-and-listed or already in the registry
- [x] Status for each — D18, confirmed against `ERROR_REGISTRY`
- [x] 400 vs 403 vs 409 split — 400 for input/state-of-the-world the caller cannot fix by waiting; 403 for ownership; 409 for "this claim is in the wrong state for that action"
- [x] Which errors expose an id — ids go to `meta` only; `message` stays readable (§8). `FIELD_TOKEN_INVALID` exposes nothing.

**Data**
- [x] Schema change — three tables, four enums (spec §Data changes)
- [x] Migration — one, `drizzle/0013`, hand-edited per D14
- [x] Foreign keys — D5
- [x] Unique constraints a client can trip — `incidents_reservation_id_unique` → `409 INCIDENT_ALREADY_EXISTS`; `incident_items_incident_asset_unique` → asserted in the domain layer first; `cleaner_token` / `storage_key` collisions fall through to `409 DUPLICATE_RECORD`

**Breaking changes**
- [x] Existing response shape changed — no
- [x] Existing status code changed — no
- [x] Client action required — no. Purely additive: 6 new paths on a baseline of 24.

**Process**
- [x] Commit granularity — D24
- [x] Where tests live — D25
- [x] `errorHandle.md` update needed — D26 (no)

---

## Rejected alternatives

| ID | Alternative | Why rejected |
| --- | --- | --- |
| R1 | One `src/modules/field/` module for the tokenized routes | The field routes are the same domain, share the service and the error file, and would need the incident schemas re-imported. D1's second route file keeps one module and one service. |
| R2 | `ON DELETE cascade` for `incident_items.asset_id` | Deleting an asset would silently delete the evidence that a claim rests on. Restrict turns it into a 409 the host can act on (D5). |
| R3 | `ON DELETE restrict` for `incidents.reservation_id` | Deleting a reservation would then fail forever once a claim existed. `reservations` cascade is already the repo's rule, and a deleted reservation's claim has nothing to reference. |
| R4 | Store `unfeasible` as a row instead of rejecting | `reservations_id UNIQUE` means one junk row permanently blocks the reservation. A rejected request leaves no trace, which is also what the blueprint's "policy block" describes (D6). |
| R5 | Recompute `aircover_escalation_deadline_at` from the reservation on read | The reservation can be edited after the claim is filed; the deadline the host was shown must not move under them. Stored once at creation (D7). |
| R6 | Let the token stay valid after `submit`, keyed off `status` instead | A second `submit` would then reach the write path and have to be refused there. Expiring the token makes the refusal happen in one place, before any evidence is touched (D11). |
| R7 | Accept any `evidence_type` for any item type | The database cannot express the pairing, so nothing would stop a theft claim being filed with damage close-ups. That is the standardisation this feature exists to provide (D13). |
| R8 | Make `GET /field/ingest/{token}` return the host's full incident payload | It would leak guest identity and money to an unauthenticated link. The field payload is a separate schema for that reason, and the spec's invariant is asserted by a test. |
| R9 | Add `waitUntil`/KV and do EXIF extraction now | No such binding exists in `wrangler.toml`; adding infrastructure mid-feature is how a small diff becomes an unreviewable one. The stored columns are identical when the job lands (D10). |
| R10 | Put `FIELD_TOKEN_INVALID` at 401 | The token is a path segment, not credentials. 401 would imply an auth scheme the field surface does not have, and would make `check-contracts.ts` demand a 401 on guard-less routes (D18). |
| R11 | Separate `incident_status` values for `party_resolution` style sub-states | The blueprint's six values are what the AirCover flow uses. Adding speculative states now means the enum and the UI both carry values nothing produces. |
| R12 | A `POST /incidents/{id}/items` route to add items after creation | The blueprint's flow creates the incident and its items together, and `UNIQUE(incident_id, asset_id)` makes a later add a separate idempotency problem. Out of scope; a host who forgot an asset creates a second incident — which the 1:1 constraint already prevents, so the omission is caught at creation instead. |
| R13 | Ship D14's `ALTER TABLE assets … SET NOT NULL` since the schema already says so | It would fail on any existing NULL row, and it is unrelated drift. A feature branch is the wrong place to tighten a constraint on production data. |
| R14 | Sort `incident_items` by `created_at` in JS | The list is assembled from a relational query; ordering belongs in the query's `orderBy`, and a JS sort passes a test that the query ordering was dropped. The service test pins the SQL. |

---

## Facts verified while writing this (with the command that verified them)

Guesses become wrong decisions executed at scale. Record what was checked.

| Fact | Verified by | Result |
| --- | --- | --- |
| Baseline gate is green | `npm run gate` | `GATE PASSED`, 435 tests, exit 0 |
| Baseline gate with OpenAPI is green | `npm run gate -- --openapi` | `GATE PASSED`, exit 0 |
| Baseline OpenAPI path count | `npx tsx --env-file=.env -e "…app.request('/openapi.json')…"` | **24** paths; none begin `/incidents` or `/field`. Expected after P1–P4: 30. |
| Registry size and the code-list test's shape | Read `src/core/errors/error.codes.ts`, `error.codes.test.ts` | 38 codes. `EXPECTED_STATUS` is a hand-written `Record<ErrorCode, number>` and one test asserts its keys equal the registry's — so D18's two-place edit is required, not optional. |
| The three proposed tables compile as Drizzle | Wrote them into `src/db/schema/`, ran `npx tsc --noEmit` | exit 0. `unique()` imported from `drizzle-orm/pg-core` works as a table-level constraint; `decimal("…", { precision: 9, scale: 6 })` type-checks. |
| `npm run db:generate` emits a clean single migration | Ran it with the scratch schema, then reverted | `drizzle/0013_incident_schema.sql`: 4 enums, 3 tables, 1 unique per table, 4 indexes, FKs exactly as D5 specifies. **Plus one unwanted statement** — see the next row. |
| The unwanted statement is pre-existing drift, not our schema | `node -e "require('./drizzle/meta/0012_snapshot.json')…"` | `asset_type_id.notNull` is **`false`** in snapshot 0012, while `assets.ts` declares `.notNull()` — so the generator wants `ALTER TABLE "assets" ALTER COLUMN "asset_type_id" SET NOT NULL`. Confirms D14. |
| `incidents` is absent from the baseline snapshot | same command | `s.tables['public.incidents']` is `false` in 0012 — table name is free. |
| No symbol collisions | `grep -rn "incident\|claim_evidence\|claimEvidence" src --include=*.ts` | No hits outside the two untracked prep docs. `incidents`, `incidentItems`, `claimEvidence`, `incidentErrors`, `incidentsService` are all free. |
| There is no background-job facility to reuse | `grep -rn "waitUntil\|executionCtx" src`; read `wrangler.toml` | No hits; `wrangler.toml` declares no KV, queue or durable object. Confirms D10. |
| The presign pattern to copy | Read `apartments.service.ts` (`generateUploadTokens`), `apartments.route.ts` | `new PutObjectCommand({Bucket, Key, ContentType})` → `getSignedUrl(s3, command, {expiresIn: 300})`. `GetObjectCommand` is importable from the same package (probed) and is the read side for D16's baseline photos. |
| `crypto.randomUUID()` is available without a new dependency | `npx tsx -e "…globalThis.crypto.randomUUID()…"` | Present; 32 hex chars after stripping dashes. Confirms D12. |
| The reservation time-resolution rule to reuse | Read `db-validator.ts` (`assertCanCreateInspection`, `assertNoOverlappingReservation`) | `alternativeCheckInDatetime > '1970-01-02'` → use it, else the primary. `isRealDate()` is the in-file helper. D7/D8/D9 follow this exact rule. |
| `resourceRegistry` is an explicit list a new table must join | Read `db-validator.ts` + `db-validator.test.ts` | 7 resources; the test's `expected` array lists all 7 by hand. Confirms D20. |
| Test harness has no real DB | Read `vitest.setup.ts`, `test-factory.ts`, `reservations.test.ts` | Dummy `DATABASE_URL`; `createTestApp` sets `db` to `{}`; every suite `vi.mock`s the service. Chainable-mock assertions are the established pattern (`apartments.service.test.ts`). |
| `expectError` enforces the §8 message rules | Read `src/core/utils/assert-error.ts` | Asserts no status prefix and no SQL keywords on every call — so D18's messages are checked for free. |
| Per-file test counts used in Accept lines | `npx vitest run` | 19 files, **435** tests total. The gate prints the total, not per-file, so each phase's Accept states its own expected delta. |
