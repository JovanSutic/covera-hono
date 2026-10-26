# Asset types list endpoint — execution index

Spec: [../asset-types-list.md](../asset-types-list.md) · Decisions: [../asset-types-list.decisions.md](../asset-types-list.decisions.md)

## Phases

| Phase | File | Touches | Outcome | Requires |
| --- | --- | --- | --- | --- |
| 1 | [p1.md](./p1.md) | `assets.schema.ts`, `assets.service.ts`, `assets.contract.ts`, `assets.route.ts`, `assets.test.ts` | `GET /assets/types` serves the catalog A-Z, with route tests | — |
| 2 | [p2.md](./p2.md) | `assets.service.test.ts` (new) | The ordering is a real assertion, not prose | 1 |

## Dependency rules

- A legal landing order: 1 → 2
- Do not start phase 2 before phase 1 — because phase 2's test imports
  `assetsService.getAllTypes`, which phase 1 creates. Running phase 2 first is a `TS2305`
  ("no exported member"), not a test failure.

Phase 1's five steps are not independently shippable in a meaningful order, but they are split by
file so that a compile error localises to the file that caused it. All four source-file steps must
land before the phase's test step can pass.

## Invariants — check at every phase boundary

1. The envelope is built only in `renderError`; no other file constructs `{ success: false, … }`.
2. Guards, middleware and handlers throw; they never `return c.json(...)` for an error.
3. Every `code` comes from `ERROR_REGISTRY` — no string literal at a throw site.
4. Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids.
5. Driver text goes only to `meta.driver`.
6. Feature-specific: the response is a **bare array** — never `{ data: [...] }`, never `{ items, total }`.
7. Feature-specific: the A-Z ordering lives in SQL (`orderBy(asc(assetTypes.code))`). No handler or
   service may re-sort in JavaScript, which would hide a broken/unused `orderBy`.

## Execution protocol

```
You are executing a pre-written plan, one phase at a time. Do not design, redesign, or improve it.

SOURCES
- src/docs/asset-types-list/00-index.md — read ONCE at the start (dependencies, invariants, halt conditions).
- src/docs/asset-types-list/p<N>.md — read ONLY the phase file you are about to execute.
- src/docs/asset-types-list.decisions.md — read ONCE. If a decision is missing, HALT; do not decide it.

SCOPE
- Execute phases 1–2 in order. Stop at the phase boundary.

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
  (`.husky/pre-commit` runs the full test suite, so per-step commits are expensive.)
- Clear context at phase boundaries, not mid-phase.
- Tier the model per step: cheap for transcription, strong for decision-heavy steps and review.

### Batching note for this plan

Phase 1's four source steps each touch a **different** file, so they cannot be batched by file. They
*may* be grouped into one read + one write pass, because no step's Accept must be observed before the
next runs — the route file will not compile until the contract exports exist, so the group compiles
once at the end. Phase 1 step 1.5 does depend on 1.1–1.4 (`TS2305`), so it runs last.

## Halt conditions

- Gate red and one honest fix attempt does not clear it
- The plan contradicts the code in a way that changes observable behaviour
- The step needs a file outside its Touch list
- A decision the plan does not cover changes observable behaviour

Report raw output, file and symbol, the options, and a recommendation. Do not proceed past it.

## Definition of done

- [ ] `npm run gate:openapi` green on the feature branch
- [ ] Every phase's test step landed; no test work deferred to review
- [ ] Every decision in `*.decisions.md` is `APPROVED` and reflected in the code
- [ ] OpenAPI declares every status each route can produce
- [ ] Docs commit is separate from code commits

## Baseline measurements (recorded at planning time)

| Measurement | Value | How |
| --- | --- | --- |
| `npm run gate` | PASSED, 403 tests, exit 0 | `npm run gate` |
| `npm run gate:openapi` | PASSED, exit 0 | `npm run gate:openapi` |
| OpenAPI path count | 22 | `npx tsx --env-file=.env -e "import app from './src/index'; …"` |
| `/assets/types` present | no | same |
| Registered `Asset*` components | `Asset`, `AssetType`, `AssetsList`, `CreateAsset`, `DeleteAssetResponse`, `ShotWithAssets` | same |

Expected after phase 1: **23** paths, and `AssetTypesList` added to components.
Line references in the phase files are hints measured on 2026-10-26; locate by symbol.
