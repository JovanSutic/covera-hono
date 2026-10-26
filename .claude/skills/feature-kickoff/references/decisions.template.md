# <Feature> — decisions

Every choice the executor would otherwise make mid-flight. Approve the table in one pass, or edit
it in place; do not leave a row in `OPEN`.

**Status values:** `APPROVED` · `OPEN` (blocks execution) · `REJECTED` (kept for the record)

---

## Decisions

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D1 | | | OPEN |
| D2 | | | OPEN |
| D3 | | | OPEN |

---

## Checklist — close every one of these before approval

Delete the rows that genuinely do not apply, but say why in one word (`n/a`).

**Shape**
- [ ] Route path and HTTP method
- [ ] Success status (200 / 201 / 204) and whether a body is returned
- [ ] Request schema strictness (unknown keys rejected or stripped)
- [ ] Pagination / filtering parameters, or explicitly none

**Auth**
- [ ] Which guards run, in which order (`authGuard`, `rolesGuard([...])`, `apartmentGuard`)
- [ ] Every role that may call it, named explicitly
- [ ] Whether it is deliberately unauthenticated (and the comment that says so)

**Failure modes** — one row per way it can fail
- [ ] Registry code for each (`ERROR_REGISTRY`; a new code means a new registry row)
- [ ] Status for each — confirm against the registry, not by intuition
- [ ] Which are 400 (malformed) vs 403 (authorization) vs 409 (state conflict)
- [ ] Which errors expose an id or driver text, and confirm they go to `meta`, not `message`

**Data**
- [ ] Schema change: new columns, nullable or not, defaults, backfill
- [ ] Migration: additive or destructive; safe to run before the code, after, or either
- [ ] Foreign keys and their delete behaviour (`CASCADE` / `NO ACTION` / `SET NULL` / `RESTRICT`)
- [ ] Unique constraints — and therefore which SQLSTATEs a client can trip

**Breaking changes**
- [ ] Does any existing response shape change? Named. Called out in the PR.
- [ ] Does any existing status code change? Named.
- [ ] Is a client action required? If so, it is not a silent change.

**Process**
- [ ] Commit granularity (default: one per phase)
- [ ] Where tests live (default: alongside the module, `*.test.ts`)
- [ ] Does this need a doc update to `src/docs/errorHandle.md`? If yes, which section.

---

## Rejected alternatives

Only where the rejection is non-obvious enough that someone would otherwise re-propose it.

| ID | Alternative | Why rejected |
| --- | --- | --- |
| R1 | | |

---

## Facts verified while writing this (with the command that verified them)

Guesses become wrong decisions executed at scale. Record what you checked.

| Fact | Verified by | Result |
| --- | --- | --- |
| | | |
