# Special access links — execution index

Spec: [../special-access.md](../special-access.md) · Decisions: [../special-access.decisions.md](../special-access.decisions.md)

## Phases

| Phase | File | Touches | Outcome | Requires |
| --- | --- | --- | --- | --- |
| 0 | step 0 below | nothing (a git reset) | The prototype is parked on `proto/special-access` and the tree is back at the 716-test baseline | — |
| 1 | [p1.md](./p1.md) | `src/db/schema/special-access.ts` (new), `src/db/schema/index.ts`, `src/core/errors/error.codes.ts`, `src/core/errors/error.codes.test.ts`, `src/docs/errorHandle.md`, `drizzle/0015_*.sql` (generated) | The `access_scope` enum, the `special_access` table, its migration, and the three new 403/404 codes exist and are registered | 0 |
| 2 | [p2.md](./p2.md) | `src/modules/special_access/special_access.schema.ts`, `.errors.ts`, `.service.ts`, `.service.test.ts` (all new) | The module's data layer: request/response schemas, the three throwers, and the resolver/mint/revoke service | 1 |
| 3 | [p3.md](./p3.md) | `src/modules/special_access/special_access.contract.ts`, `.route.ts`, `.test.ts` (all new), `src/index.ts` | A host can mint and revoke a grant over HTTP at `/special-access` | 2 |
| 4 | [p4.md](./p4.md) | `src/middleware/specialAccessGuard.ts`, `specialAccessGuard.test.ts` (both new) | One composed guard resolves a token, checks scope and target, and delegates to today's session chain when there is no token | 3 |
| 5 | [p5.md](./p5.md) | the four contract files (`reservations`, `apartments`, `apartment_shots`, `inspections`) + `src/modules/inspections/inspections.test.ts` | The six `inspection_proof` routes open with `?accessId=`; without it they are byte-for-byte unchanged | 4 |
| 6 | [p6.md](./p6.md) | `src/modules/incidents/incidents.service.ts`, `incidents.route.ts`, `incidents.service.test.ts`, `drizzle/0016_*.sql` (generated) | The field surface reads its token from `special_access`, backfilled from `incident_items.cleaner_token`; the column is kept as a mirror | 2 |

## Dependency rules

- A legal landing order: 0 → 1 → 2 → 3 → 4 → 5, and 2 → 6.
- Do not start phase 1 before step 0 — **because** the tree already holds a working prototype of
  phases 1–5, so phase 1's steps would find their work already done and D23's per-phase commit would
  have nothing to record. Step 0 is what makes the phases executable at all.
- Do not start phase 2 before phase 1 — **because** `special-access.service.ts` imports
  `specialAccess` and `AccessScope` from `@/db`, and `1` is what puts them there. The
  `ErrorCode` union is likewise derived from the registry, so phase 2's `defineErrors` call does
  not compile until phase 1's codes exist.
- Do not start phase 3 before phase 2 — **because** the route's handlers and its tests both drive
  `specialAccessService`; writing the route first means inventing a second service for the phase-2
  tests to contradict.
- Do not start phase 4 before phase 3 — **because** the guard resolves through
  `specialAccessService.resolveByToken`, which phase 2 created, and its tests load the module's
  errors, which phase 2 wrote.
- Do not start phase 5 before phase 4 — **because** phase 5's only content is putting
  `specialAccessGuard(...)` into six `middleware` arrays across four contract files; the guard must
  exist and its own tests must be green first, or a red gate at phase 5 has two possible authors.
- Phase 6 needs 2 but not 3, 4 or 5. It is ordered last only so there is one landing order to
  state. **It is also the one phase that can be deferred without weakening phases 1–5** — see the
  note under "Deferrable" below. If it *is* deferred, land 1–5 and stop: do not run step 6.0's
  backfill migration without 6.3, and do not run 6.3 without 6.0.

## Deferrable

Phases 1–5 are purely additive and verified green as a unit. Phase 6 is different in kind: it
changes a **deployed** surface (`/field/ingest`), and its only user-visible effect is that a token
lives in a new table instead of a column. If a smaller first release is wanted, land 1–5, ship the
new capability, and take phase 6 as its own feature later. Nothing in 1–5 depends on it.

Phase 6's steps are ordered so that the migration (6.0) is a **precondition** of the read move
(6.3), not a sibling of it: 6.0 backfills, 6.1–6.2 keep new grants mirrored, 6.3 moves the read.
Running 6.3 without 6.0 kills every outstanding field link.


## Invariants — check at every phase boundary

1. The envelope is built only in `renderError`; no other file constructs `{ success: false, … }`.
2. Guards, middleware and handlers throw; they never `return c.json(...)` for an error.
3. Every `code` comes from `ERROR_REGISTRY` — no string literal at a throw site.
4. Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids.
5. Driver text goes only to `meta.driver`.
6. Feature-specific: **a request with no `accessId` is unchanged.** Phase 4's tests must include a
   no-token case per touched route proving the pre-existing session behaviour still holds.
7. Feature-specific: **no `SPECIAL_ACCESS_*` message names an id, a target, or a token** — all
   three go in `meta` only.

## Execution protocol

```
You are executing a pre-written plan, one phase at a time. Do not design, redesign, or improve it.

SOURCES
- src/docs/special-access/00-index.md — read ONCE at the start (dependencies, invariants, halt conditions).
- src/docs/special-access/p<N>.md — read ONLY the phase file you are about to execute.
- src/docs/special-access/reference/ — the tested files. Where a step's inline block and a reference
  file disagree, THE REFERENCE FILE WINS: it is the version the gate was run green on. Say so in
  your report when you hit one.
- src/docs/special-access.decisions.md — read ONCE. If a decision is missing, HALT; do not decide it.

SCOPE
- Execute step 0, then phases 1–6 in order. Stop at the phase boundary.

PRECONDITION
- Step 0 has been run and `npm run gate` passes at the baseline count in the table below. If not,
  STOP and report.

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
- a test count in an Accept line does not match what you observe (report observed vs expected —
  the counts were recomputed from a prototype, not from a fresh run);
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

### Step 0 — Establish the baseline (operator, run once, before phase 1)

**This is an operator step, not an executor one** — it makes two commits, and the executor never
commits (see "Division of labour"). It runs before phase 1 and is not repeated.

The branch currently holds a **working prototype of phases 1–5** in the working tree, uncommitted:
every file those phases create or edit is already present and byte-identical to its `reference/`
copy, and `npm run gate:openapi` is green at **780 tests / 38 paths**. Executing phases 1–5 on top
of it would be a no-op, and the plan's per-phase commits (D23) would have nothing to commit.

**Order matters, and the obvious version is destructive.** The plan's own docs
(`special-access.md`, `special-access.decisions.md`, `special-access/`, …) are **untracked** right
now, alongside the prototype's untracked source files. So:

- a bare `git clean -fd src/` **deletes this plan**, and
- `git branch proto/special-access` **does not** park the prototype — a branch is a pointer to a
  commit, and none of the prototype's work is committed yet.

The docs commit therefore comes **first** (which also makes the plan tracked and safe), and the
prototype is parked by committing it to its own branch.

```bash
# 1. The pre-execution docs commit (D23). This is what makes the plan files tracked,
#    so the reset in step 3 cannot delete them. Docs only — no code.
git add src/docs/special-access.md src/docs/special-access.decisions.md \
        src/docs/special-access-prep.md src/docs/special-access/
git commit -m "docs(53): spec, decisions and phased plan for special access links"

# 2. Park the prototype on its own branch so it survives the reset.
git checkout -b proto/special-access
git add -A src/
git commit -m "proto(53): special access phases 1-5, built green (780 tests)"

# 3. Return to the feature branch. The prototype is now only on proto/, so the working
#    tree returns to the baseline.
git checkout feature/53_photo-like-access

# 4. Confirm the baseline.
npm run gate
```

**Accept.**

- `git status --short src/` → **empty** (nothing modified, nothing untracked under `src/`)
- `git log --oneline -1` → the docs commit from step 1 (its message starts `docs(53):`)
- `npm run gate` → GATE PASSED, **716** tests
- `git branch --list proto/special-access` → the branch exists, and
  `git show --stat proto/special-access | tail -3` lists the prototype's files

Three things to know about the reset:

- **The unrelated doc deletions disappear.** The working tree also has ~2,700 lines of deletions
  (`src/docs/incidents*.md`, `incident_management_backend_blueprint.md`) that are not part of this
  feature. Step 2 commits them to `proto/`, and step 3 restores them on the feature branch — so
  after step 3 they are simply *present and unmodified*. That is the right outcome (they belong in
  no commit of this feature); if they were deliberate deletions you want kept, make that its own
  commit on `main` first.
- **If step 1 fails because a path is already tracked**, you are not on the state this plan was
  written against — stop and report rather than forcing it.
- The prototype branch is the fastest way to pre-verify any count in this plan: check it out, apply
  the step you are unsure about, measure, and return. It is also the only place phase 6's work can
  be diffed against a known-green tree, since phase 6 has no reference files.

**Precondition for phase 1:** step 0's Accept lines all hold. If `git status --short src/` is not
empty after step 3, stop — an executor starting from a dirty tree cannot tell its own edits from
what was already there.

### Division of labour

- **Executor:** edits, runs `npm run gate` per step, never commits.
- **Operator:** runs `npm run gate` at each phase boundary, makes one commit per phase.
  (`.husky/pre-commit` runs the full test suite, so per-step commits are expensive.)
- Clear context at phase boundaries, not mid-phase.
- Tier the model per step: cheap for transcription, strong for decision-heavy steps and review.

## Model tiering for this feature

- **Strong model:** p1 step 1.1 (the check constraint and FK behaviour), p2 step 2.3 (the
  resolver and the revoke idempotency), p4 in full (the composed guard is the one place a wrong
  choice is a security hole), p6 (the field-surface migration).
- **Cheap model:** p3 and p5 — literal transcription gated by a compile, plus test code the phase
  files carry verbatim.
- **Strong model:** the final review, which is a `/code-review` pass over the whole feature diff,
  not a plan step. It has no phase number; it runs after phase 6 and before the PR.

## Verified baseline (measured 2026-11-22)

Phases 1–5 were built and run green on the `proto/special-access` branch before this plan was
written, so the `reference/` files are transcriptions of a working tree rather than code written
hopefully. The counts below were measured **on that prototype**. They are the plan's expectations,
not results the executor should assume: after step 0 the tree is at the baseline row, and each
phase's Accept line is what the executor must actually observe.

| Measurement | Command | Result |
| --- | --- | --- |
| Baseline gate (after step 0) | `npm run gate` | GATE PASSED, **716** tests, **36** paths |
| Full feature (phases 1–5, prototype) | `npm run gate:openapi` | GATE PASSED, **780** tests, **38** paths |
| New codes' effect on the suite | `npx vitest run src/core/errors/error.codes.test.ts` | **343** → **361** (6 `it.each(CODES)` blocks × 3 codes; the 7th grep hit is a comment) |
| Guard suite | `npx vitest run src/middleware/specialAccessGuard.test.ts` | **14** pass |
| Module route suite | `npx vitest run src/modules/special_access/special_access.test.ts` | **16** pass |
| Module service suite | `npx vitest run src/modules/special_access/special_access.service.test.ts` | **13** pass |
| Wired modules, no test edited | `npx vitest run src/modules/{reservations,apartments,apartment_shots}` | **26 / 15 / 12** pass |
| Inspections suite after step 5.6 | `npx vitest run src/modules/inspections` | **19** pass (16 pre-existing + 3 new) |

### The per-phase gate counts, derived

The prototype's 780 is `716 + 18 + 13 + 16 + 14 + 3`, and the 18 is step 1.5's six
`it.each(CODES)` blocks × the three new codes. Step 1.7 adds two more tests, so the totals the
Accept lines should be checked against are:

| After | Running total | Notes |
| --- | --- | --- |
| step 0 | **716** | the baseline |
| step 1.5 | **734** | 716 + 18 |
| step 1.7 | **736** | 716 + 18 + 2 |
| phase 2 | **749** | + 13 |
| phase 3 | **765** | + 16 |
| phase 4 | **779** | + 14 |
| step 5.6 | **782** | + 3 |
| phase 6 | **782** | 6.5 adds a test but 6.2/6.4 edit existing ones; measure it, do not assume |

If an observed count differs from this table by more than the step's own additions, the step is
wrong or a prior step is — report both numbers rather than adjusting the expectation.

The one thing **not** verified end-to-end is phase 6: it was reasoned about against the code and
its single read site (`getFieldContext`) was read in full, but no migration of the field surface
was executed, and its backfill (step 6.0) was designed during this review, not prototyped. Its
steps say so, and its Accept lines are checks the executor runs, not results already observed.

## Halt conditions

- Gate red and one honest fix attempt does not clear it
- An Accept line's test count does not match the run (report observed vs expected)
- The plan contradicts the code in a way that changes observable behaviour
- The step needs a file outside its Touch list
- A decision the plan does not cover changes observable behaviour

Report raw output, file and symbol, the options, and a recommendation. Do not proceed past it.

## Definition of done

- [ ] Step 0 ran: `proto/special-access` exists and the tree was reset
- [ ] `npm run gate:openapi` green on the feature branch at **782** tests / **38** paths
- [ ] Every phase's test step landed; no test work deferred to review
- [ ] Every decision in `special-access.decisions.md` is `APPROVED` and reflected in the code
- [ ] OpenAPI declares every status each route can produce
- [ ] A no-`accessId` request on all six phase-5 routes returns exactly what it returned before
- [ ] Phase 6's field-surface tests are the *existing* ones, unmodified, and they pass
- [ ] `drizzle/0015_*.sql` and `drizzle/0016_*.sql` both exist, and 0016 was run against a copy of
      the data before it was run against anything that matters
- [ ] Docs commit is separate from code commits
