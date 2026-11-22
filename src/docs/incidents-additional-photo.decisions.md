# Incidents — additional damage photos — decisions

Every choice an executor would otherwise make mid-flight. Approve this table in one pass, or edit it
in place; do not leave a row `OPEN`.

**Status values:** `APPROVED` · `OPEN` (blocks execution) · `REJECTED` (kept for the record)

`APPROVED` here means "decided by the model under the operator's standing instruction to decide and
document" — this document *is* the record to review. Any row the operator disagrees with is a
one-line edit and a re-run of the phase that depends on it.

---

## Decisions

### The rule and what it counts

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D1 | "The asset photo proof requirement" is the incident item's required shots — `requiredPhotoTypes(type)`, i.e. 2 for `damage` and 1 for `theft`. It is **not** `assets.photo_proof_requirement` (`SWEEP_ONLY`/`CLOSEUP`/`FUNCTIONAL_ACTION`), which the incidents module never reads. | The intent's own arithmetic only closes on the item's types: "if it asks for 2 photos then he has 2 additional" is `2 + 2 = 4` for a `damage` item, and "asks for 1 → 3 additional" is `1 + 3 = 4` for `theft`. `photo_proof_requirement` is an inspection-side label with three values that do not map onto `damage_photo_wide`/`damage_photo_closeup`/`theft_empty_space_photo` at all, so reading it here would mean inventing a fourth mapping in a module that has never had one. Verified: `grep -rn photoProofRequirement src` hits only the assets, apartment-shots and apartment_shots modules. | APPROVED |
| D2 | One rule for every item: **`MAX_ITEM_PHOTOS = 4` photos per item**, added as a constant in `incidents.service.ts`. The required shots do not raise the ceiling. | The intent, verbatim: "up to 4 photos, no mater of the asset photo proof requirement". A `damage` item gets 4 (2 required + 2 additional) and a `theft` item gets 4 (1 + 3); a single constant satisfies both readings and keeps `max` a fact the client can render. Making the ceiling `required + 4` would contradict "no matter the requirement". | APPROVED |
| D3 | The cap counts **photos only**, by `EVIDENCE_KIND` — the same derived map `recomputeItemStatus` already trusts. Documents are bounded only by `MAX_EVIDENCE_PER_ITEM` (20). | The intent is about damage photos; a receipt is not one. Counting documents would refuse a fifth photo-shaped thing on an item that had spent its budget on receipts, which is not a rule anyone asked for. Deriving the half from `EVIDENCE_KIND` rather than a second list is what stops the two drifting when the enum grows. | APPROVED |
| D4 | The existing `MAX_EVIDENCE_PER_ITEM = 20` cap is **kept unchanged**, as a looser outer bound. | It is the unauthenticated field surface's floor of protection (S1). Removing it would trade a real bound for a tighter one that only covers photos, and a token-holder could then attach 20 documents per item with nothing else stopping them. Two nested caps: 20 things per item, of which at most 4 may be photos. | APPROVED |

### What it changes on the wire

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D5 | New field `photoAllowance` on the item payload: `{ max, required, attached, remaining }`, all integers. | Task 1 asks for a frontend instruction; the honest instruction is "read `remaining` and stop", not "hardcode 4 and hope". `required` is carried so the client can show the outstanding required shots without re-deriving the type mapping, and `attached` because the payload already carries the evidence array but a filtered count is a computation the client should not repeat differently. | APPROVED |
| D6 | It is computed by **one** exported function, `buildPhotoAllowance(type, evidence)`, attached at **all four** sites that build an item payload: `hydrateIncident` (incident read), `hydrateItem` (item read), `create`'s inline `items` map, and `addItem`'s inline return. | Verified there are four, not two: the create and addItem paths build their items inline (`{ ...item, asset, evidence: [] }`) and never pass through the hydrations, so deriving the allowance only in `hydrate*` would leave the create and add responses — the two that carry the freshly minted `cleanerToken` — reporting no allowance at all while `IncidentItemWithToken` says they do. One function at four call sites is what keeps the create response, the claim page and the attach response from disagreeing about the same item's headroom; it is the same reasoning that produced `activeEvidence` and `withKind`. | APPROVED |
| D7 | The allowance counts evidence **filtered to `status === 'active'`**, reusing `activeEvidence`. | A withdrawn photo must not keep spending the allowance: `DELETE …/evidence/{evidenceId}` soft-deletes, and the intent's "add up to 4" is about photos the claim actually holds. The rows the payload shows and the rows the count reads must be the same rows. | APPROVED |
| D8 | The field payload, `FieldIngestSchema`, gains `photoAllowance`; the two `upload-tokens` and the two write responses are unchanged in shape. | The field page is where the photo rule actually bites — the cleaner is the one shooting them — and its guidance block (`requiredEvidenceTypes`, `attachedEvidenceCounts`) is already the precedent. The mint responses carry tokens, not items, and the write responses report a status and a count; widening those would be payload for its own sake. | APPROVED |
| D9 | The field payload's `photoAllowance` carries the same four keys. It leaks no bucket layout and no money, so it is safe on the unauthenticated surface. | The field test asserts the serialised body against a forbidden-key list (`storageKey`, `cleanerToken`, `_cents`, …); three integers and a cap pass it, which is why the field page can show the rule rather than the client inventing it. No storage key is needed to count photos. | APPROVED |

### Enforcement

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D10 | Enforcement is at the two **writes** only: the host attach and the field submit. Both count the item's ACTIVE photos and refuse when `attached + submittedPhotos > MAX_ITEM_PHOTOS`. | Same shape as the existing evidence cap, which is enforced where the INSERT happens because the mint writes nothing: "the mint alone is bypassable by calling it once per photo, so the insert is where the real limit lives" (D37 in `incidents.decisions.md`). | APPROVED |
| D11 | New code `MAX_ITEM_PHOTOS_EXCEEDED`, **status 400**, message naming the limit and the count. Added to `ERROR_REGISTRY` and to `EXPECTED_STATUS` in `error.codes.test.ts`. | 400, not 409: a fifth photo is a bad request against a published limit, not a state conflict the caller resolves by waiting — the existing `MAX_EVIDENCE_EXCEEDED` and `MAX_PHOTOS_EXCEEDED` are both 400. A distinct code rather than reusing `MAX_EVIDENCE_EXCEEDED`, because a client told "you have exceeded a limit" when it has 4 photos and 0 documents would go looking for the wrong rule; `MAX_EVIDENCE_EXCEEDED` also must stay for documents. The registry test asserts `EXPECTED_STATUS`'s keys equal the registry's, so a one-place edit is a red gate. | APPROVED |
| D12 | Attaching the required types stays **advisory**; the cap never asserts that `damage_photo_wide` is present. | The intent says the requirement "stays as is", and today nothing enforces it — `recomputeItemStatus` writes `photos_collected` on the first photo of any type. Inventing enforcement here would change when an item becomes `photos_collected` and would refuse a cleaner who shot two close-ups but no wide, which is a different rule. Recorded in the spec's out-of-scope. | APPROVED |
| D13 | The two **mints keep** their existing `MAX_EVIDENCE_PER_ITEM` batch bound; they do not become photo-aware. | A mint writes nothing and sees a batch, not an item's history, so a photo-aware bound there would be a second, weaker copy of a rule enforced authoritatively one call later. Adding an item-count read to the mint to improve an error message is not worth a query on the unauthenticated path. Recorded so it is not "fixed" later. | APPROVED |
| D14 | The counts and the comparison are computed by one exported helper, `countActivePhotos(db, itemId)`, called from both write routes. | Two hand-written predicates over `claim_evidence` (one per route) is how the two surfaces end up disagreeing about what counts as a photo. The routes still own their own throw, so each can name the surface's context in the message. | APPROVED |
| D15 | The two write routes' error bundles gain `MAX_ITEM_PHOTOS_EXCEEDED`. `fieldSubmitErrors` also gains `EVIDENCE_KEY_INVALID` and `MAX_EVIDENCE_EXCEEDED`, which the submit handler already throws. | `check-contracts.ts` only requires the statuses a *guard* implies, so a handler-thrown code it cannot see was already invisible — naming them documents 400s the route produces today. Left as-is, the contract would omit the one code this feature introduces, which is the opposite of the point. The repo's other over-declared bundles are untouched (spec's out-of-scope). | APPROVED |
| D16 | No new route, path or method; no change to the mint request/response schemas and no change to `generateUploadTokens`. | Task 4, verbatim: "no new endpoints added but existing used". The cap and the allowance ride on the four payloads that already exist. | APPROVED |

### Shape, naming and process

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D17 | Names: constant `MAX_ITEM_PHOTOS`; function `buildPhotoAllowance`; type `PhotoAllowance`; method `countActivePhotos`; schema `PhotoAllowanceSchema`; thrower `maxItemPhotosExceeded`. | Verified free: `grep -rn` for each returns no hits in `src`. `MAX_ITEM_PHOTOS` sits beside `MAX_EVIDENCE_PER_ITEM` and reads unambiguously against it ("per item, photos" vs "per item, everything"). | APPROVED |
| D18 | `PhotoAllowanceSchema` is declared in `incidents.schema.ts` and the four counts are attached by the existing hydration, not by a new schema per surface. | `FieldIngest` is a deliberately separate schema from `IncidentWithItems` (D17 of the incidents feature) so a later widening cannot leak — so the field schema references the shared `PhotoAllowanceSchema` rather than copying four numbers into a second definition. | APPROVED |
| D19 | No change to `errorHandle.md`. | This feature adds one code to the registry, which §5's table already does not mirror exhaustively (`MAX_PHOTOS_EXCEEDED` is absent from it). It changes no rule. | APPROVED |
| D20 | Tests: route assertions in the existing `incidents.test.ts` and `incidents.field.test.ts`; the pure-function and SQL tests in `incidents.service.test.ts`. | The established placement (D25 in `incidents.decisions.md`). The allowance is a pure function of `(type, evidence)`, so its table is testable without a database, in the same file that already pins the readiness predicate via `PgDialect`. | APPROVED |
| D21 | **Four** phases: P1 the rule + registry code + wire field, P2 photo-cap enforcement on both writes, P3 the field surface, P4 documentation. One commit per phase, plus one for these docs. | P2 needs P1's constant, code and schema. P3 needs P1's schema and P2's helper to be consistent with the host surface — landing it after P2 is what lets its test assert the same rule the host surface enforces. P4 keeps docs out of code commits (skill Stage 7; the `ed4e94e` post-mortem). | APPROVED |
| D22 | Every existing test fixture that builds an item payload or mocks the field guidance is updated in the phase that breaks it — by symbol, not by chasing red. **Responses are not validated at runtime** (verified), so a stale fixture does not fail loudly; the failure mode here is a mock that keeps passing while it no longer resembles the payload, which the plan closes by updating the fixtures in the same step as the schema. | `incidents.field.test.ts` mocks `getFieldEvidenceGuidance` in three places and asserts the ingest body, so the new field appears there; `incidents.test.ts` and `incidents.service.test.ts` build item rows whose shape the new key joins. Because nothing validates the response, a fixture missing `photoAllowance` would pass a route test silently — so the assertions that matter are the new ones, not the absence of red. | APPROVED |

---

## Checklist — close every one of these before approval

**Shape**
- [x] Route paths and methods — **none added** (D16); six existing responses widen
- [x] Success statuses — unchanged (`201` attach, `200` everywhere else)
- [x] Request schemas — unchanged; no client sends anything new
- [x] Pagination — unchanged

**Auth**
- [x] Guards per route, in order — unchanged; no guard is touched
- [x] Roles — unchanged (`admin`, `host`); the new field and code are not role-scoped
- [x] Deliberately unauthenticated — the three `/field/*` routes stay guard-less (D17 of the incidents feature); D9 keeps the new field safe there

**Failure modes**
- [x] Registry code for each — D11, one new code, in the registry **and** `EXPECTED_STATUS`
- [x] Status for each — 400 (D11), confirmed against `ERROR_REGISTRY`'s 400 block
- [x] 400 vs 403 vs 409 split — 400: the request exceeds a published limit; nothing is unauthorized and nothing is in a conflicting state
- [x] Which errors expose an id — `meta.limit` and `meta.submitted` only, matching `maxEvidenceExceeded`; no row ids, no keys (§8)

**Data**
- [x] Schema change — **none** (spec §Data changes); the allowance is derived, the cap is a constant
- [x] Migration — **none**
- [x] Foreign keys — n/a
- [x] Unique constraints a client can trip — none new; `storage_key UNIQUE` is unchanged, and the guidance says to mint a fresh key per attempt

**Breaking changes**
- [x] Existing response shape changed — **additively** (one new field). No field is removed or renamed; no status changes for an existing request
- [x] Existing status code changed — no
- [x] Client action required — none to keep working. A client that ignores `photoAllowance` still works until it exceeds 4 photos. Purely additive: `36` paths before and after (D16)

**Process**
- [x] Commit granularity — D21
- [x] Where tests live — D20
- [x] `errorHandle.md` update needed — D19 (no)

---

## Rejected alternatives

| ID | Alternative | Why rejected |
| --- | --- | --- |
| R1 | Make the ceiling `required + 4` (so `damage` gets 6) | Contradicts the intent's "up to 4 photos, no mater of the asset photo proof requirement". Also makes `max` very slightly true: 6 photos for an item nobody asked for 6 on. |
| R2 | Read `assets.photo_proof_requirement` to decide the split | Three values (`SWEEP_ONLY`, `CLOSEUP`, `FUNCTIONAL_ACTION`) that do not name any `evidence_file_type`, in a module that has never read the column. It would need a fourth invented mapping and would answer a different question than the one asked. |
| R3 | Store a per-item photo counter, or a `sequence`/`is_additional` column on `claim_evidence` | A counter is a second source of truth for a fact the evidence rows already hold, and it drifts the first time a photo is soft-deleted — which is exactly the bug `recomputeItemStatus` exists to avoid. A per-photo flag stores a client concept the API has no rule for. |
| R4 | Enforce the cap at the token mint instead of the write | The mint writes nothing and cannot see the item's existing photos without a new read on the unauthenticated path (D13). Enforcing only there is bypassable, as the existing evidence cap's own comment records. |
| R5 | Reuse `MAX_EVIDENCE_EXCEEDED` for the photo cap | It would tell a client with 4 photos and 0 documents that it exceeded the evidence limit, and the limit it exceeded would be the photo one, 4, not 20. Two rules, two codes; the existing code keeps its document meaning. |
| R6 | Return 409 for the photo cap "because the item is in a state that refuses it" | Nothing needs to change for the request to succeed — deleting a photo lets the same request through, but that is true of every limit. `MAX_PHOTOS_EXCEEDED` and `MAX_EVIDENCE_EXCEEDED` are both 400; a third answer for the same class of failure would be inconsistency for its own sake. |
| R7 | Add a `GET …/photo-allowance` route so the client learns the headroom | Task 4 forbids new endpoints, and the item read already returns the item — a second call to learn a number the payload can carry is how a client ends up with two answers. |
| R8 | Return 400 at the mint when a caller asks for more photos than remain | Would need the item count at the mint (D13), and it still would not be the enforcement — the write is. It would also break the legitimate flow of minting tokens and confirming fewer of them. |
| R9 | Raise `MAX_EVIDENCE_PER_ITEM` and call it the photo cap | It counts everything, so it cannot express "4 photos"; and lowering it to 4 would cap documents as well, refusing a fifth receipt on an item with 3 photos. |
| R10 | Enforce that the required shot types are present before `photos_collected` | Changes when an item becomes collected and would refuse a cleaner who shot two valid close-ups. The intent says the requirement stays as is (D12); it is a separate feature with its own code. |

---

## Facts verified while writing this (with the command that verified them)

Guesses become wrong decisions executed at scale. Record what was checked.

| Fact | Verified by | Result |
| --- | --- | --- |
| Baseline gate is green | `npm run gate:openapi` | `GATE PASSED`, **697** tests, 36 routes, exit 0 — all eleven checks `ok` |
| Baseline OpenAPI path count, and that incidents/field contribute 12 | `npx tsx --env-file=.env` probe against `src/index` | `36` paths, `12` under `/incidents` or `/field`. Both remain 36/12 after this feature (D16) admits no route |
| `claim_evidence` has no uniqueness on `(incident_item_id, evidence_type)` | Read `src/db/schema/claim-evidence.ts`; grep the migration | The only constraint is `CONSTRAINT "claim_evidence_storage_key_unique" UNIQUE("storage_key")`. A second photo of the same type inserts cleanly — which is the whole finding of task 1 |
| `photoProofRequirement` is never read by the incidents module | `grep -rn "photoProofRequirement" src --include=*.ts` | Hits only `db/schema/assets.ts`, `db/schema/asset-enums.ts`, `db/schema/apartment-shots.ts`, `modules/apartment_shots/apartment_shots.schema.ts`. Confirms D1 |
| The required shots per type | Read `PHOTO_EVIDENCE_FOR_TYPE` in `incidents.service.ts` | `damage` → 2 types, `theft` → 1. `requiredPhotoTypes` returns exactly those, so 4/2/2 and 4/1/3 follow arithmetically |
| `EVIDENCE_KIND` classifies exactly three enum members as photos | Read `claim-evidence.ts`; probe filtering all five photo/document types through `evidenceKind` | `3` photos, `4` documents. Confirms D3's split, and that it is derivable without a second list |
| A photo-only counting predicate renders as assertable SQL | `new PgDialect().sqlToQuery(...)` over `and(eq(itemId), eq(status), inArray(evidenceType, PHOTO_EVIDENCE_TYPES))` | `("claim_evidence"."incident_item_id" = $1 and "claim_evidence"."status" = $2 and "claim_evidence"."evidence_type" in ($3, $4, $5))` — so the test can pin status **and** the type filter, not just the count |
| `PHOTO_EVIDENCE_TYPES` is exported from the schema barrel | Read `claim-evidence.ts`; probe importing it from `@/db` | Exported and importable; no other `src` file imports it yet, so using it here is additive |
| The item payload is built in **four** places, not two | Read `hydrateIncident`, `hydrateItem`, and the inline `items` maps in `create` and `addItem` | The two hydrations cover the reads; `create` and `addItem` build `{ ...item, asset, evidence: [] }` inline and never hydrate. Confirms D6 — deriving only in `hydrate*` would miss the two token-bearing responses |
| Responses are **not** validated at runtime | Probe: an `OpenAPIHono` route declaring `{a: string, b: number}` returning `{a: "x"}` answered **200** with `{"a":"x"}` | The contract's `responses` schema is documentation, not a check. This is why D22 updates fixtures deliberately and why the new assertions — not the absence of red — are the proof |
| `activeEvidence` is where active rows (and `kind`) are derived | Read `incidents.service.ts` near `withKind` | One function serves the incident read and the item read; the allowance counting the same filtered rows is D7 |
| The cap helpers would be new symbols | `grep -rn` for `MAX_ITEM_PHOTOS`, `PhotoAllowance`, `buildPhotoAllowance`, `photoAllowance`, `countActivePhotos` | `0` hits each in `src`. Confirms D17 |
| The registry test requires the two-place edit | Read `error.codes.test.ts` | `CODES.length` is asserted `>= 38` (a floor, so a 39th code passes it), and `Object.keys(EXPECTED_STATUS).sort()` must equal the registry's keys **exactly** — so D11's second edit is mandatory or the gate is red |
| `check-contracts.ts` cannot see handler-thrown codes | Read `scripts/check-contracts.ts` | It requires statuses only from `middleware` (`authGuard`→401, `rolesGuard`/`apartmentGuard`→403) plus a bare 500. So the field submit's existing `EVIDENCE_KEY_INVALID`/`MAX_EVIDENCE_EXCEEDED` are undeclared today — the pre-existing gap D15 fixes while editing the bundle |
| Both write routes throw the cap they enforce | Read `incidents.route.ts` (attach) and `incidents.field.route.ts` (submit) | Each compares `existingCount + submitted` against `MAX_EVIDENCE_PER_ITEM` and throws `maxEvidenceExceeded` — the exact sites D10 and D14 extend |
| The field test asserts the serialised body against a forbidden-key list | Read `incidents.field.test.ts` | Forbids `guest`, `email`, `_cents`, `payout`, `amount`, `storageKey`, `incidents/`, `cleanerToken`. Four integers and a cap trip none, which is what makes D9 safe |
| The field route's guidance is mocked in three places | `grep -n "requiredEvidenceTypes" incidents.field.test.ts` | Lines 90/94 (the `beforeEach`), 126/127, 172/173. A required key missing from the mocked object is a response-validation failure — D22 exists so the executor updates them deliberately |
| Existing cap tests pin `meta.limit` at 20 | Read `incidents.test.ts:1136`, `incidents.field.test.ts:299` | `expect(payload.error.meta.limit).toBe(20)` on the evidence cap. The new photo cap's `limit` is 4 and its code is distinct, so these stay green (D11) |
| The service test harness records calls and renders SQL | Read `fakeTx`/`fakeDb` and the `readiness predicate shape` block | `fakeTx` records `{op, values, set}` per call; `PgDialect().sqlToQuery(...)` is already used to pin predicates. D20's tests follow both |
| A pure `(type, evidence)` table is testable with no database | Read `describe("evidence classification")` and `describe("constants")` in `incidents.service.test.ts` | Both test pure exported helpers directly; `MAX_EVIDENCE_PER_ITEM` is pinned with a literal `toBe(20)`, which is the precedent for pinning `MAX_ITEM_PHOTOS` at 4 |

### The plan was built and gated before being written down (D31's practice)

Every step of phases 1–3 was applied to the working tree and run, then reverted — so the plan does
not merely read as if it compiles. The patch is kept at
[`incidents-additional-photo/reference-implementation.patch`](./incidents-additional-photo/reference-implementation.patch)
as the record; it is the exact diff the three phase files reproduce. Reverted rather than committed
because these documents are the deliverable and the phases are the operator's to run.

| Fact | Verified by | Result |
| --- | --- | --- |
| Phase 1 typechecks and gates green | Applied 1.1–1.4, ran `npm run gate:openapi` | `GATE PASSED`, **710** tests (baseline 697; +13). Two real compile errors in the first cut, both fixed in the plan: `PhotoAllowance` was not exported from `incidents.schema.ts`, and `buildPhotoAllowance`'s parameter could not accept a `Record<string, unknown>[]` from a relational read — the plan now exports the type and types the parameter as `ReadonlyArray<Record<string, unknown>>` |
| Phase 2 gates green | Applied 2.1–2.4, ran `npm run gate:openapi` | `GATE PASSED`, **714** tests (+4). The `countActivePhotos` SQL renders `… "status" = $2 and "evidence_type" in ($3, $4, $5)` |
| Phase 3 gates green | Applied 3.1–3.4, ran `npm run gate:openapi` | `GATE PASSED`, **716** tests (+2) |
| The new code is in the OpenAPI document for both writes | `app.request("/openapi.json")` against `src/index` | The attach's and the field submit's `400` descriptions both name `MAX_ITEM_PHOTOS_EXCEEDED`; `PhotoAllowance` is a registered component; `IncidentItem` and `FieldIngest` both carry `photoAllowance` |
| The path count is unchanged | Same probe | **36** paths after all three phases — invariant 9 holds; no endpoint was added |
| One existing test fixture was genuinely incomplete | Phase 1's first test run: `TypeError: PHOTO_EVIDENCE_FOR_TYPE[type] is not iterable` at `incidents.service.test.ts:857` | `reissueToken`'s hydrated fixture was `{ id, cleanerToken, asset: null, evidence: [] }` — no `type`, which a real row always has. Fixed by adding `type: "damage"` to the fixture (D22). This is the class of defect a plan review cannot see and a gate run can |
| Responses are not validated, so a stale fixture fails silently | Probed an `OpenAPIHono` route returning an object missing a declared key | Answered `200` with the incomplete body. Confirms D22's framing: fixtures must be updated deliberately, because nothing goes red to remind you |

