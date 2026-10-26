---
name: feature-kickoff
description: Start-of-feature process for the covera-hono API. Turns a prose feature intent into a decisions-locked spec, per-phase plan files, and an executable gate BEFORE any implementation. Invoke when the user describes a feature or migration to build, asks for a plan or spec, or says "kick off", "spec out", "plan feature X", "start feature X".
---

# Feature kickoff — spec before code

This skill exists because of a measured post-mortem on the error-handling migration
(`src/docs/errorHandlePlan.md`): the planning was cheap and excellent, the *execution* was not,
and almost every wasted dollar came from a decision that was left open until execution time or a
verification step that was prose instead of a command.

Read this whole file once at the start of a feature. Do not re-read it per phase.

---

## The cost model (why the process is shaped this way)

| What | Cost | Why |
| --- | --- | --- |
| Deciding something while writing the plan | ~free | no code, no context churn |
| Deciding it during execution | a full round trip | user must answer, context must be re-sent |
| Prose verification ("Accept: the response looks right") | a full check pass later | it is unverifiable, so it defers to review |
| Executable verification (`npm run gate`) | ~free | fails loudly at the step that broke it |
| Per-step full test suite | dominant | `.husky/pre-commit` runs `npm run test` on **every commit** |
| A monolith plan file | per-step re-reads | you cannot cheaply load 2,800 lines |

Two rules follow, and they are not negotiable:

1. **Every decision is closed before execution starts.** If the plan says "either X or Y — decide
   when you get there", the plan is not done.
2. **Every acceptance criterion is a command.** If it cannot be run, it is not a criterion.

---

## Stage map

Run stages in order. Each has a required artifact and a cost target. Do not begin the next stage
until the prior artifact exists on disk.

| Stage | Artifact | Cost target |
| --- | --- | --- |
| 1. Interview | (answers in conversation) | $0.03 |
| 2. Rules check | (delta notes only) | $0.02 |
| 3. Spec | `src/docs/<feature>.md` | $0.05 |
| 4. Decisions | `src/docs/<feature>.decisions.md` | $0.05 |
| 5. Plan | `src/docs/<feature>/p<N>.md` per phase + `00-index.md` | $0.30 |
| 6. Gate | `npm run gate` passes on the baseline | $0.02 |
| 7. Execute | code on a branch, one commit per phase | $1.00–$1.50 |
| 8. Review | `npm run gate` + a diff read | $0.10 |

Total target: **$1.50–$2.00**. If execution exceeds twice the plan's cost, the plan was
under-specified — stop and fix the plan, do not push through.

---

## Stage 1 — Interview (ask, do not infer)

Ask the operator for exactly these things. Ask once, in a single message, as a numbered list.
Do not proceed until you have answers, and do not ask follow-ups individually — batch them.

**What I need from you (the operator):**

1. **Intent** — 1–3 paragraphs of prose: what the feature does and why. No implementation detail.
2. **Acceptance** — how *you* will know it works. Concrete: example request/response pairs, a user
   story, or a failing behaviour that must change.
3. **Out-of-scope** — what this feature explicitly does *not* do. This is the single highest-value
   input: it prevents the executor from "helpfully" expanding the diff.
4. **Decisions you have already made** — anything you do not want re-litigated (naming, status
   codes, whether something is a breaking change, migration vs flag-day).
5. **Definition of done** — is this "merged and green", "deployed", or "documented"? Default:
   merged, green, OpenAPI updated.

**Do not ask the operator about implementation.** If a choice exists, it goes in the Decisions
document (Stage 4) with your recommendation, and they approve it in one pass.

---

## Stage 2 — Rules check

Read the existing rules before writing anything new:

- `src/docs/errorHandle.md` — the error contract. Any feature that adds an endpoint, a guard, or
  a failure mode must comply.
- Existing module code for the closest analogue (`src/modules/locations/` is the smallest complete
  example; `src/modules/assets/` is the most complete).

Produce **delta notes only** — what this feature needs that the rules do not already say. Do not
restate the rules in the spec; link to them.

If the feature requires changing an established rule, that is a decision, not an edit. It belongs
in Stage 4 with the rationale, and it must be called out in the PR.

---

## Stage 3 — Spec (`src/docs/<feature>.md`)

The spec says **what is true after this lands**. It is short — aim for under 150 lines. It is the
only document a reviewer needs to read.

Use `references/feature-spec.template.md`. Required sections:

- Intent (from Stage 1, in the operator's words)
- Behaviour: a table of endpoint → method → auth → success → failure modes
- Data changes (schema, migration, backfill) or "none"
- Invariants this feature must not break (link to `errorHandle.md` §0 global rules)
- Out of scope
- Open questions → **must be empty**; anything here moves to Stage 4 as a decision

A spec with a non-empty "Open questions" section cannot proceed.

---

## Stage 4 — Decisions (`src/docs/<feature>.decisions.md`)

**This is the stage that pays for the whole process.** Every choice the executor would otherwise
have to make mid-flight gets an ID, a recommendation, and a one-line rationale. The operator
approves the table in one pass.

Use `references/decisions.template.md`. Rules:

- One row per decision. ID (`D1`, `D2`, …). Decision. Rationale. Status.
- **Prefer the option that keeps the tree green** and say so.
- Include the boring ones: naming, route path, status code, whether a field is nullable, whether
  to delete or deprecate, commit granularity, test placement.
- Include a **rejected alternatives** line only where the rejection is non-obvious enough that
  someone would otherwise re-propose it.
- Never write "decide later", "either X or Y", or "flag it and move on". Those are the exact
  phrases that cost round trips in the last migration.

Search the codebase for the facts these decisions depend on *now* (constraints in `drizzle/*.sql`,
existing status codes, whether a route is mounted). A wrong fact here becomes a wrong decision
executed 20 times.

---

## Stage 5 — Plan (a directory, never a monolith)

Write one file per phase:

```
src/docs/<feature>/
  00-index.md          # dependency graph, invariant list, execution protocol
  p1.md … pN.md        # one phase each, self-contained
```

Why a directory: the executor needs exactly one phase file in context at a time. A 2,800-line
monolith forces either a full read (expensive) or "read only the step section" (an instruction
that cannot be verified and was violated repeatedly in the last migration).

**`00-index.md` must contain:**

- Phase table: phase → files touched → outcome → prerequisite phases
- The dependency graph, explicit. If phase 4 needs phase 1, say so and say *why*.
- Invariants to check after every phase (link `errorHandle.md` §0.3, plus any feature-specific ones)
- The execution protocol (Stage 7 block below, verbatim)
- Halt conditions (verbatim from Stage 7)

**Each `p<N>.md` must contain:**

- A phase-level `Prerequisite:` line and a `Gate:` line (`npm run gate`)
- Steps with exactly four fields: **Touch**, **Do**, **Accept**, **Verify**
  - No `Goal` field. The heading is the goal. Restating it was 33 redundant fields last time.
  - **Do** carries exact code where code is what's wanted. Verbatim. No paraphrase.
  - **Accept** is a command whose output proves it, or a grep with its expected result. Never
    "looks correct", never "the JSON shows …" — if the proof is a JSON dump, make it a check.
  - **Verify** is `npm run gate` for most steps. Only write a delta when the step needs a
    narrower check (e.g. one file's tests).
- **A test step per phase.** Tests are never deferred to review. If a phase adds behaviour, its
  file ends with a step whose Do is the actual test code.
- Anchors are **symbols, not line numbers**: "the `...userErrors` spread in `getUsersRoute`
  responses", not "line 33". Line numbers go stale inside a phase.

Per-step size rule: if two consecutive steps touch the same file and neither needs the other's
output to be observed first, **merge them**. Four small edits to one file are one step.

---

## Stage 6 — Gate

`npm run gate` already exists in this repo. It must pass on the baseline branch *before* execution
starts. One line per check, exits non-zero on the first failure, `--openapi` adds the last two:

```
  ok    typecheck                         npx tsc --noEmit
  ok    lint                              npx eslint . --quiet  (errors only; warnings are not a gate)
  ok    tests                             npx vitest run        (not `vitest` — that is watch mode)
  ok    one envelope: no hand-built …     no `success: false` outside src/core/errors/ or tests
  ok    guards/middleware throw …         no `c.json(` in src/middleware/ (tests excluded)
  ok    no legacy error helper            no getStandardResponses / commonErrors / error.helpers
  ok    no bare `new Error(`              outside src/core/errors/ and tests
  ok    no test-local onError override    outside src/modules/ *.test.ts
  ok    contracts                         28 routes declare the statuses their guards imply
  ok    openapi        (--openapi)        the document builds and has paths
```

Comments are stripped before the structural regexes run, so prose that *quotes* a forbidden
pattern does not trip the check. `scripts/check-contracts.ts` parses the contract files with the
TypeScript AST, resolves `...bundle` spreads through the real `ERROR_REGISTRY`, and fails if it
*cannot* resolve a spread — a check that silently passes on unreadable input is worse than none.

**When a prompt says "Accept: `npm run gate`", that is the whole acceptance criterion.** Do not
add prose acceptance on top of it.

If the baseline is not green, stop and fix it before planning. Never plan against a red tree.

---

## Stage 7 — Execute

Hand off with this block, filling in the phase range. It is the contract; the executor gets
nothing else.

```
You are executing a pre-written plan, one phase at a time. Do not design, redesign, or improve it.

SOURCES
- src/docs/<feature>/00-index.md — read ONCE at the start (dependencies, invariants, halt conditions).
- src/docs/<feature>/p<N>.md — read ONLY the phase file you are about to execute.
- src/docs/<feature>.decisions.md — read ONCE. If a decision is missing, HALT; do not decide it.

SCOPE
- Execute phases <A>–<B> in order. Stop at the phase boundary.

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

**Division of labour during execution:**

- The executor edits and runs `npm run gate` per step. It does **not** commit.
- The operator runs the gate at the phase boundary and makes **one commit per phase** — never per
  step, because `.husky/pre-commit` re-runs the entire suite.
- Docs commits are separate from code commits.
- Clear context at phase boundaries, not mid-phase.
- Tier the model: most steps are literal reproduction gated by a compile — use a cheap model.
  Reserve the strong model for steps whose content is a decision table or reasoning about
  existing code, and for the final review.

---

## Stage 8 — Review

Run `npm run gate`. Then read the diff for what a gate cannot see:

- Scope creep (files changed that no step names)
- Messages that leak internals (ids, driver text, table names) — `errorHandle.md` §8
- Contract declares a status the handler cannot produce, or omits one it can

Review findings become a follow-up phase file, not ad-hoc edits. If review finds work the plan
promised would be done, the plan's definition-of-done section is what needs fixing next time.

---

## Anti-patterns (each one cost money last time)

| Anti-pattern | Evidence | Instead |
| --- | --- | --- |
| Discovering the cheap execution mode mid-run | batch-verify was introduced at step 0.5 of 40, after 26 steps ran per-step | decide execution mode in `00-index.md` before step 1 |
| "Either X or Y — decide when you get there" | 1.8, 5.4, 3.2 | resolve in `*.decisions.md` |
| Prose acceptance checked by eyeballing JSON | 3.1/3.2 verified by dumping `/openapi.json` | `npm run gate` — `check-contracts.ts` does it statically |
| Tests discovered at review | registry-wide test requirement surfaced only in the final check; cost two follow-up commits | a test step in every phase |
| `Goal:` restating the heading | 33 of 40 steps | delete the field |
| Identical verify line copy-pasted | 21 of 39 steps | `npm run gate` |
| Line-number anchors | "line 33", "lines 122–127" | symbol anchors |
| One monolith plan | 2,810 lines, 1,452 of them code | one file per phase |
| Docs committed with code | `ed4e94e` mixed 3,778 insertions of plan text into a code commit | separate commits |

---

## Definition of ready-to-execute

Every box must be true before Stage 7 starts. If any is false, the plan is not done.

- [ ] Spec exists, "Open questions" is empty
- [ ] Every decision has an ID and an approved status; no "decide later" anywhere
- [ ] `00-index.md` has the phase table, dependency graph, invariants, and this protocol
- [ ] Every phase file is self-contained and under ~400 lines
- [ ] No step has a `Goal` field; every step has Touch / Do / Accept / Verify
- [ ] Every Accept is a command or a grep with a stated expected result
- [ ] Every phase ends with a test step whose Do is the actual test code
- [ ] `npm run gate` is green on the baseline
