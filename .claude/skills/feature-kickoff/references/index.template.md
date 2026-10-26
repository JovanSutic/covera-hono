# <Feature> — execution index

Spec: [../<feature>.md](../<feature>.md) · Decisions: [../<feature>.decisions.md](../<feature>.decisions.md)

## Phases

| Phase | File | Touches | Outcome | Requires |
| --- | --- | --- | --- | --- |
| 1 | [p1.md](./p1.md) | | | — |
| 2 | [p2.md](./p2.md) | | | 1 |

## Dependency rules

State the reason, not just the edge. Example: *phase 3 depends on phase 1 because every module
lies bundle imports `errorResponses`, which phase 1 creates.*

- A legal landing order: 1 → 2 → 3
- Do not start phase N before phase M — because:

## Invariants — check at every phase boundary

1. The envelope is built only in `renderError`; no other file constructs `{ success: false, … }`.
2. Guards, middleware and handlers throw; they never `return c.json(...)` for an error.
3. Every `code` comes from `ERROR_REGISTRY` — no string literal at a throw site.
4. Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids.
5. Driver text goes only to `meta.driver`.
6. Feature-specific: <add here, or delete>

## Execution protocol

Paste the `Stage 7` block from the skill here, with the phase range filled in.

### Division of labour

- **Executor:** edits, runs `npm run gate` per step, never commits.
- **Operator:** runs `npm run gate` at each phase boundary, makes one commit per phase.
  (`.husky/pre-commit` runs the full test suite, so per-step commits are expensive.)
- Clear context at phase boundaries, not mid-phase.
- Tier the model per step: cheap for transcription, strong for decision-heavy steps and review.

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
