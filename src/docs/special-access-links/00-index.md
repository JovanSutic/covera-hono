# Special access links — execution index

Spec: [../special-access-links.md](../special-access-links.md) · Decisions: [../special-access-links.decisions.md](../special-access-links.decisions.md)

Read the spec once. Read only the phase file you are about to execute. Every decision is closed;
if a step needs one that is not in `special-access-links.decisions.md`, **HALT** — do not decide it.

## Phases

| Phase | File | Touches | Outcome | Requires |
| --- | --- | --- | --- | --- |
| 1 | [p1.md](./p1.md) | `.github/workflows/deploy.yml` | Production schema restored; a deploy can no longer ship code that outruns its migrations | — |
| 2 | [p2.md](./p2.md) | `special_access.schema.ts`, `index.ts`, `reservations.contract.ts`, `apartments.contract.ts`, `apartment_shots.contract.ts`, `inspections.contract.ts`, `special_access.document.test.ts` (new) | `?accessId=` declared on the six existing token-enabled routes, the scheme registered, the two reservation reads' 403s documented, the create rule documented | — |
| 3 | [p3.md](./p3.md) | `specialAccessGuard.ts`, `specialAccessGuard.test.ts`, `special_access.service.ts`, `incidents.contract.ts`, `incidents.test.ts`, `assets.contract.ts`, `assets.test.ts` | A link-holder can read **and** write a claim's proofs (`GET /incidents/{id}`, evidence upload-tokens + attach, `GET /assets/apartment/{apartmentId}`) | 2 |
| 4 | [p4.md](./p4.md) | `scripts/check-contracts.ts`, `apartments.contract.ts`, `apartments.route.ts`, `apartments.test.ts`, `reservations.schema.ts`, `reservations.contract.ts`, `reservations.route.ts`, `reservations.test.ts` | A link-holder can submit the guide's proofs: the photo chain and the proof-completion `PATCH` | 2 |
| 5 | [p5.md](./p5.md) | `special_access.schema.ts`, `special_access.contract.ts`, `special_access.route.ts`, `special_access.service.ts`, `special_access.test.ts`, `special_access.document.test.ts` | A frontend route guard can validate a link before render; a host can list and revoke the links for a reservation | 2 |
| 6 | [p6.md](./p6.md) | `special-access-links.md`, `special-access-links/handoff.md` (new) | The frontend contract is written down, with the probe table and the regeneration steps | 1–5 |

## Dependency rules

State the reason, not just the edge. A legal landing order is **1 → 2 → 3 → 4 → 5 → 6**;
3, 4 and 5 are independent of each other and may land in any order once 2 has.

- **Do not start 2 before 1** — not because the code needs it, but because every acceptance in
  2–5 is unobservable in production until the table exists. Landing 1 first also answers the B3
  question (403 vs still-500) before anyone writes code for it (D4, D5).
- **Do not start 3, 4 or 5 before 2** — they import `AccessIdQuerySchema` from
  `special_access.schema.ts` and rely on the security scheme being declared. Phase 2 creates it;
  a phase that declares its own copy would defeat the single-spelling rule (D6).
- **Do not start 4 before 2** — phase 4 edits `scripts/check-contracts.ts` to require 403 on
  `specialAccessGuard` routes. That is only safe once phase 2 has given the four already-guarded
  contracts their access codes; run out of order and the gate goes red on routes phase 4 does
  not touch.
- **Do not start 3 before 2, and do not merge 3 and 4** — they are separate because 3 introduces
  the `incidentParam` bind kind (guard machinery + its own test suite) while 4 is
  ownership-preservation work on routes that already accept sessions. Merging them would put two
  independent hazards in one commit and one review.
- **Do not start 6 before 1–5** — it documents behaviour that must already have landed (the
  `ed4e94e` mistake: docs committed describing an unlanded rule).

## Verified counts — read this before trusting an `Accept` line

**Phases 2–5 were implemented and gated on 2026-11-26, then the counts below were read off the
running code.** They are what a correct execution produces; if your run differs, you have a real
difference rather than a typo.

| After phase | Tests | Paths |
| --- | --- | --- |
| baseline | 783 | 38 |
| 2 | 791 | 38 |
| 3 | 801 | 38 |
| 4 | 809 | 38 |
| 5 | 818 | 38 |

Two things the phase files used to get wrong, now corrected in place:

1. **`npm run gate:openapi` does not print the path count.** `gate.mjs` runs its OpenAPI check
   through `npx tsx -e "…"`, whose stdout it cannot read, so the check prints `ok openapi` and
   nothing more. `GATE PASSED` plus `ok openapi` is the acceptance; the 38 is recorded above and
   was confirmed with a one-off script reading `/openapi.json` directly.
2. **Thirteen operations declare the `accessId` query parameter, not eleven**, and `"accessId"`
   occurs 20 times in the document (up from 6). Counted from the built document.

## Corrections to the source docs — read before executing

The plan deliberately diverges from `backend-blockers-details.md` in four places. Each is a
verified code fact. Full rationale in `decisions.md` D9, D15, D16.

1. **The guard swap is not mechanical.** `specialAccessGuard`'s session branch calls `authGuard`
   + `rolesGuard` only — it never calls `apartmentGuard`. On `POST /apartments/{id}/photos/*` the
   ownership check currently comes *only* from `apartmentGuard(false)`, so replacing that chain
   would let any signed-in host mint upload tokens for any apartment. Phase 4 adds a handler-level
   `assertApartmentOwnership` to preserve it.
2. **`check-contracts.ts` finds guards by name.** Swapping the guard makes it stop requiring 401
   and 403 on the swapped routes. Phase 4 extends the checker in the same step.
3. **`PATCH /reservations/{id}` is narrowed for tokens.** `UpdateReservationSchema` is
   `CreateReservationSchema.partial()`, so a token holder could otherwise move the stay's dates.
   A token request is validated against `{ hasPhotoProof?, status? }` only (D17, D18).
4. **`damage_evidence` is not inert.** `incident_items.cleaner_token` is minted into
   `special_access` by `insertFieldGrant` and consumed by `getFieldContext` at `/field/ingest`.
   Do not add it to any `/incidents` route and do not remove it from the enum (D14).

## Invariants — check at every phase boundary

1. The envelope is built only in `renderError`; no other file constructs `{ success: false, … }`.
2. Guards, middleware and handlers throw; they never `return c.json(...)` for an error.
3. Every `code` comes from `ERROR_REGISTRY` — no string literal at a throw site.
4. Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids.
5. Driver text goes only to `meta.driver`.
6. **Feature-specific:** a request carrying `?accessId=` never falls back to a session, even a
   valid one.
7. **Feature-specific:** the session path of every route this feature touches does exactly what
   it did before. No signed-in caller gains or loses capability.
8. **Feature-specific:** the introspection response carries no row `id`, `revokedAt` or `usedAt`.
9. **Feature-specific:** no secret, credential or database URL is added to the repository.

## Execution protocol

```
You are executing a pre-written plan, one phase at a time. Do not design, redesign, or improve it.

SOURCES
- src/docs/special-access-links/00-index.md — read ONCE at the start (dependencies, invariants, halt conditions).
- src/docs/special-access-links/p<N>.md — read ONLY the phase file you are about to execute.
- src/docs/special-access-links.decisions.md — read ONCE. If a decision is missing, HALT; do not decide it.

SCOPE
- Execute phases 1–6 in order. Stop at the phase boundary.

PRECONDITION
- `npm run gate` must pass. If not, STOP and report.

PER STEP
1. Read the step's Touch / Do / Accept / Verify.
2. Make exactly the change in Do. Files outside Touch are off-limits.
3. Run Verify (`npm run gate` unless the step says otherwise).
4. Walk Accept bullets against real command output, not intent.
5. Report in the fixed format. Then the next step.

FIDELITY
- Do blocks are exact. Reproduce verbatim. If one does not compile or does not match its target
  file, STOP and report the mismatch — do not improvise a substitute.
- Do not rename, reformat, reorder, or "clean up" given code.
- Line numbers in the plan are hints measured on 2026-11-26. Locate by symbol.

BATCHING
- Group steps that touch the same file into one read + one write, unless a step's Accept must be
  observed before the next step runs. Say which steps you grouped.

HALT AND ASK — do not guess — when:
- the gate is red and one honest fix attempt does not clear it;
- the plan contradicts the actual code in a way that changes observable behaviour;
- completing a step needs a file outside Touch;
- a decision the plan does not cover changes observable behaviour.
Report: raw output, file and symbol, the options you see, your recommendation.

OUT OF SCOPE
- Anything no step asks for. Collect it in one `Noticed, untouched:` line. Do not fix it.
- In particular: do NOT edit `src/docs/backend-blockers-prep.md` or
  `src/docs/backend-blockers-details.md`, and do NOT edit anything under `src/api/generated/`
  (that is the frontend repo).

REPORT — one block per step, nothing longer
Step <N.M> — done | blocked
Touch:   <files>
Verify:  <command> → <result>
Accept:  <bullet> ✓ <evidence>   (one line each)
Noticed: <unrelated issues, untouched>

Do not summarize the plan back, restate code you wrote, or ask whether to continue between steps.
```

## Halt conditions specific to this feature

- **Phase 1, after the production migration:** if `GET /reservations/{id}?accessId=deadbeef` still
  answers 500, STOP. B3 is then a real code bug, not the missing table. Report the status code and
  the body's `meta.driver` (present outside production) and wait — the fix is new work the plan
  does not contain (D5).
- **Any phase, if a step's swap would remove `apartmentGuard` from a route whose handler does not
  assert ownership:** STOP and report. That is the D15 hazard; the plan names the four routes it
  applies to and no others.
- **Any phase, if the gate's `contracts` check goes red on a route the phase does not touch:**
  STOP. It means another route mounts a guard whose contract is short — a real finding, not a
  plan step.
