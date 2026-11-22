# Incidents — additional damage photos — execution index

Spec: [../incidents-additional-photo.md](../incidents-additional-photo.md) · Decisions: [../incidents-additional-photo.decisions.md](../incidents-additional-photo.decisions.md)

> **Phases 1–3 were applied and gated green before this plan was written** (the skill's Stage 6
> practice: 710 → 714 → 716 tests, `GATE PASSED`, 36 paths unchanged), then reverted — these docs are
> the deliverable. [`reference-implementation.patch`](./reference-implementation.patch) is that exact
> diff, so a Do block that does not match what compiled is a transcription bug rather than a design
> question.

## Phases

| Phase | File | Touches | Outcome | Requires |
| --- | --- | --- | --- | --- |
| 1 | [p1.md](./p1.md) | `error.codes.ts`, `error.codes.test.ts`, `incidents.errors.ts`, `incidents.schema.ts`, `incidents.service.ts`, `incidents.service.test.ts`, `incidents.test.ts` | `MAX_ITEM_PHOTOS = 4`, the new code, `buildPhotoAllowance`, and `photoAllowance` on every host item payload | — |
| 2 | [p2.md](./p2.md) | `incidents.service.ts`, `incidents.route.ts`, `incidents.contract.ts`, `incidents.test.ts`, `incidents.service.test.ts` | The host attach refuses a fifth photo with `400 MAX_ITEM_PHOTOS_EXCEEDED` | 1 |
| 3 | [p3.md](./p3.md) | `incidents.service.ts`, `incidents.schema.ts`, `incidents.field.route.ts`, `incidents.field.contract.ts`, `incidents.field.test.ts` | The field page reads the allowance and its submit enforces the same cap | 1, 2 |
| 4 | [p4.md](./p4.md) | `incidents.md`, `incidents.decisions.md` | The shipped rule is recorded where the incidents feature is read | 1–3 |

## Dependency rules

State the reason, not just the edge.

- A legal landing order: **1 → 2 → 3 → 4**.
- Do not start phase 2 before phase 1 — because phase 2 throws `MAX_ITEM_PHOTOS_EXCEEDED` and compares against `MAX_ITEM_PHOTOS`, both of which phase 1 creates; the contract bundle it edits resolves codes through the real `ERROR_REGISTRY`, so an unregistered code is a gate failure.
- Do not start phase 3 before phase 2 — because phase 3 makes the field surface enforce the *same* rule, and its test asserts the equivalence by reading `MAX_ITEM_PHOTOS` and `countActivePhotos`. Landing it first would let the two surfaces drift and no test would say so.
- Do not start phase 4 before 1–3 — because it documents behaviour, and a docs commit that describes an unlanded rule is the `ed4e94e` mistake.

## Invariants — check at every phase boundary

1. The envelope is built only in `renderError`; no other file constructs `{ success: false, … }`.
2. Guards, middleware and handlers throw; they never `return c.json(...)` for an error.
3. Every `code` comes from `ERROR_REGISTRY` — no string literal at a throw site.
4. Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids.
5. Driver text goes only to `meta.driver`.
6. Feature-specific: `max`/`required`/`attached`/`remaining` are computed **only** by `buildPhotoAllowance`; no call site filters evidence for a count of its own.
7. Feature-specific: the photo cap counts PHOTOS only — a document must never be refused because the photo allowance is spent.
8. Feature-specific: `photoAllowance` is derived, never stored; no column and no counter is added.
9. Feature-specific: no route, path or method is added (task 4). `36` paths before and after.

## Execution protocol

```
You are executing a pre-written plan, one phase at a time. Do not design, redesign, or improve it.

SOURCES
- src/docs/incidents-additional-photo/00-index.md — read ONCE at the start (dependencies, invariants, halt conditions).
- src/docs/incidents-additional-photo/p<N>.md — read ONLY the phase file you are about to execute.
- src/docs/incidents-additional-photo.decisions.md — read ONCE. If a decision is missing, HALT; do not decide it.

SCOPE
- Execute phases 1–4 in order. Stop at the phase boundary.

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
- Tier the model per step: cheap for transcription, strong for the decision-heavy steps
  (1.4's four build sites, 3.1's guidance change) and for review.

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
- [ ] OpenAPI declares every status each route can produce, including `MAX_ITEM_PHOTOS_EXCEEDED` on both writes
- [ ] Path count is still `36` (invariant 9)
- [ ] Docs commit is separate from code commits
