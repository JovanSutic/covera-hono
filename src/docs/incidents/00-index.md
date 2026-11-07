# Incidents — execution index

Spec: [../incidents.md](../incidents.md) · Decisions: [../incidents.decisions.md](../incidents.decisions.md)

## Phases

| Phase | File | Touches | Outcome | Requires |
| --- | --- | --- | --- | --- |
| 1 | [p1.md](./p1.md) | `incidents.ts`, `incident-items.ts`, `claim-evidence.ts`, `schema/index.ts`, `drizzle/0013_*.sql` | The three tables exist, are exported, and the migration applies | — |
| 2 | [p2.md](./p2.md) | `error.codes.ts`, `error.codes.test.ts`, `db-validator.ts`, `db-validator.test.ts`, `incidents.errors.ts`, `incidents.schema.ts` | Eight codes registered, two resources resolvable, the module's errors and payload shapes exist | 1 |
| 3 | [p3.md](./p3.md) | `incidents.service.ts`, `incidents.contract.ts`, `incidents.route.ts`, `index.ts`, `incidents.test.ts` | A host can create, read and file a claim | 2 |
| 4 | [p4.md](./p4.md) | `incidents.schema.ts`, `incidents.service.ts`, `incidents.field.contract.ts`, `incidents.field.route.ts`, `index.ts`, `incidents.field.test.ts` | A cleaner with a token can see the asset and get upload URLs | 3 |
| 5 | [p5.md](./p5.md) | `incidents.service.ts`, `incidents.field.contract.ts`, `incidents.field.route.ts`, `incidents.field.test.ts`, `incidents.service.test.ts` | A cleaner can submit photos; the claim aggregates to `ready_to_file` | 4 |

One file outside the module is also touched, once, in phase 2: **`scripts/check-contracts.ts`** —
its glob is broadened from `<module>.contract.ts` to every `*.contract.ts` in a module directory,
so the unauthenticated field contract is visible to the gate. See D28; it belongs in the PR
description because it changes an established rule.

## Dependency rules

- A legal landing order: 1 → 2 → 3 → 4 → 5. No other order compiles.
- **2 needs 1** — the `incidents` payload schema is built from `SelectIncidentSchema`, which phase 1
  exports from `@/db`. Phase 2 first is a `TS2305`.
- **3 needs 2** — every service and route in phase 3 imports `incidents.errors.ts` and
  `incidents.schema.ts`, both created in phase 2, and the contract spreads the registry codes
  phase 2 added.
- **4 needs 3** — phase 4's token lookup reuses `incidentsService` and the field payload extends
  `IncidentItemSchema`.
- **5 needs 4** — phase 5's submit counts the `storageKey`s that phase 4's upload-token route mints,
  and it edits the same two field files.
- Phases 4 and 5 are both field-surface work and share files. They are split because phase 4 is
  read-and-mint (no writes) and phase 5 is the write path **plus the aggregation predicate** — the
  one piece of state-machine logic in the feature. Landing them together would bury that logic in
  the same commit as the plumbing around it.

## Invariants — check at every phase boundary

1. The envelope is built only in `renderError`; no other file constructs `{ success: false, … }`.
2. Guards, middleware and handlers throw; they never `return c.json(...)` for an error.
3. Every `code` comes from `ERROR_REGISTRY` — no string literal at a throw site — and any new code is
   added to `EXPECTED_STATUS` in `error.codes.test.ts` in the same phase (D18).
4. Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids.
5. Driver text goes only to `meta.driver`.
6. Multi-step writes run in `db.transaction()`; assertions throw inside it and roll it back.
7. **Feature-specific:** no `/field/*` response carries a guest name, a guest email, or any
   `*_cents` field. Phase 4's test asserts this against the serialised body, not the schema — a
   schema-only check still passes if a handler spreads a rich row into the response.
8. **Feature-specific:** a `cleaner_token` is single-use — `submit` expires it, so a replay is
   `FIELD_TOKEN_INVALID` (D11).
9. **Feature-specific:** `incidents.status` is advanced only by an explicit transition, never
   computed on read. `ready_to_file` is set only from `draft` (D15).
10. **Feature-specific:** `drizzle/0013` contains no statement against a pre-existing table, and
    `assets.asset_type_id` is unchanged (D14).

## Execution protocol

```
You are executing a pre-written plan, one phase at a time. Do not design, redesign, or improve it.

SOURCES
- src/docs/incidents/00-index.md — read ONCE at the start (dependencies, invariants, halt conditions).
- src/docs/incidents/p<N>.md — read ONLY the phase file you are about to execute.
- src/docs/incidents.decisions.md — read ONCE. If a decision is missing, HALT; do not decide it.

SCOPE
- Execute phases 1–5 in order. Stop at the phase boundary.

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
- Line numbers in the plan are hints measured on a past date. Locate by symbol.

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

REPORT — one block per step, nothing longer
Step <N.M> — done | blocked
Touch:   <files>
Verify:  <command> → <result>
Accept:  <bullet> ✓ <evidence>   (one line each)
Noticed: <unrelated issues, untouched>

Do not summarize the plan back, restate code you wrote, or ask whether to continue between steps.
```

### Division of labour

- **Executor:** edits, runs `npm run gate` per step, never commits.
- **Operator:** runs `npm run gate` at each phase boundary, makes one commit per phase.
  (`.husky/pre-commit` runs `npx lint-staged` and `npm run test`, so per-step commits are expensive.)
- Clear context at phase boundaries, not mid-phase.
- Tier the model per step: cheap for transcription (phases 1 and 2 are almost entirely
  transcription), strong for phase 5 (the aggregation predicate) and for review.

### Batching note for this plan

- **Phase 1** steps 1.1–1.3 each create a different schema file and cannot be batched by file, but
  group them into one write pass: none of their Accepts must be observed before the next runs, and
  the three files only compile together (they import each other cyclically — expected; that is how
  `inspections.ts` / `inspection-flags.ts` are already arranged).
- **Phase 2** steps 2.1–2.4 are four edits to four files. Steps 2.1 and 2.2 must be observed in
  order (2.2's test asserts 2.1's registry by exact key set). Step 2.3 also edits
  `scripts/check-contracts.ts`; it is a one-line glob change, so it rides with 2.3. Steps 2.5 and
  2.6 are two new files — group into one write pass, verified once at the end.
- **Phase 3** steps 3.1 and 3.2 create three files between them (`incidents.service.ts`, then
  `incidents.contract.ts` + `incidents.route.ts`). Nothing compiles until all three exist, so write
  all three, then run 3.2's Accept and 3.4's test step. Do not stop between them to run the gate —
  it will be red on a missing import, which is expected and not a halt condition.
- **Phase 4** steps 4.1–4.3 touch `incidents.schema.ts`, `incidents.service.ts`, then the two field
  files; group per file into one write pass each. 4.5 is the test step.
- **Phase 5** edits `incidents.service.ts` (5.1), the two field files (5.2), the field test (5.3)
  and creates the service test (5.4). All four are independent writes; group them into one pass and
  gate once at the end, since every Accept here is a file-level grep rather than an intermediate
  state that must be observed.

## A note on phase-file size

The skill's checklist asks for phase files "under ~400 lines". Phases 1 and 2 comply (441 and 447,
including prose). Phases 3–5 do not: they are 1,276 / 1,230 / 1,648 lines, because each carries the
**verbatim final code** for the files it creates.

This is a deliberate trade, and the reasoning is worth stating so nobody "fixes" it by trimming:

- The fidelity rule (Stage 7) says a `Do` block is exact and is reproduced verbatim. A step that
  shows only a delta instead of the whole file reintroduces exactly the ambiguity that rule exists
  to remove — the executor has to reconstruct the file and guess at the seams.
- The cost the 400-line cap protects against is *re-reading a monolith*, and the failure mode last
  time was a 2,810-line file that forced either a full read or an unverifiable "read only my
  section" instruction. A 1,600-line file that is read once, for one phase, and never re-read is not
  that failure.
- Every one of these blocks was **assembled into the tree and gated** at planning time (D31), which
  a delta-shaped block could not have been.

The executor still reads exactly one phase file at a time; that property is intact.

## Halt conditions

- Gate red and one honest fix attempt does not clear it
- The plan contradicts the code in a way that changes observable behaviour
- The step needs a file outside its Touch list
- A decision the plan does not cover changes observable behaviour
- `drizzle-kit generate` emits DDL for any table other than the three new ones, beyond the single
  known `ALTER TABLE "assets"` statement phase 1 step 1.6 removes

Report raw output, file and symbol, the options, and a recommendation. Do not proceed past it.

## Definition of done

- [ ] `npm run gate -- --openapi` green on the feature branch
- [ ] Every phase's test step landed; no test work deferred to review
- [ ] Every decision in `incidents.decisions.md` is `APPROVED` and reflected in the code
- [ ] Every route declares every status each route can produce
- [ ] Docs commit is separate from code commits
- [ ] `drizzle/0013` contains no statement against a pre-existing table

## Baseline measurements (recorded at planning time, 2026-11-07)

| Measurement | Value | How |
| --- | --- | --- |
| `npm run gate` | `GATE PASSED`, 435 tests, exit 0 | `npm run gate` |
| `npm run gate -- --openapi` | `GATE PASSED`, exit 0 | `npm run gate -- --openapi` |
| Test files | 19 | `npx vitest run` |
| OpenAPI path count | 24 | `npx tsx --env-file=.env -e "import app from './src/index'; …"` |
| `/incidents` or `/field` present | no | same |
| `ERROR_REGISTRY` size | 38 | counted in `error.codes.ts` |
| `resourceRegistry` resources | 7 | `db-validator.ts` |
| Latest migration | `0012_fresh_gambit` | `drizzle/meta/_journal.json` |

### Measured after building each phase (the same session)

Every phase file in this plan was assembled into the working tree from its own `Do` blocks and
gated, so these are observed, not predicted. D31 has the reasoning.

| After | Tests | `check-contracts` | OpenAPI paths | Gate |
| --- | --- | --- | --- | --- |
| Phase 2 (schema + errors only) | — | — | — | `tsc --noEmit` exit 0 |
| Phase 3 | 508 | 34 routes | 27 | `GATE PASSED` |
| Phase 4 | 520 | 36 routes | 29 | `GATE PASSED` |
| Phase 5 (all) | 558 | 37 routes | 30 | `GATE PASSED` |

Per-file totals the Accept lines quote: `incidents.test.ts` **23**, `incidents.field.test.ts`
**12** after phase 4 and **21** after phase 5, `incidents.service.test.ts` **29**,
`db-validator.test.ts` **39**. The gate prints the suite total, not per-file counts, so each
phase's test step states its own expected total.

The migration is `drizzle/0013_pale_nightshade.sql` (the autogenerated name; do not rename it).
Line references in the phase files are hints measured on 2026-11-07; locate by symbol.
