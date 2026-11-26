# Access links — what `covera-hono` must do to unblock the frontend

**Prep for an execution plan.** Source: [`backend-blockers.md`](./backend-blockers.md) (written 2026-11-25).
Re-verified against the codebase and the live API on **2026-11-26**. Code anchors are symbols, not
line numbers. The repo under change is `covera-hono`; every `src/…` path below is relative to it.

**Companion:** [`backend-blockers-details.md`](./backend-blockers-details.md) — the per-item technical
spec (exact schemas, guard changes, test placement). Read this file to plan; read that one to execute.

---

## TL;DR — the list is mis-ordered, and item zero is not in the blockers doc

**The production database is missing the access-link migrations.** As of 2026-11-26, *every* endpoint
that reads the `special_access` table answers `500 INTERNAL_SERVER_ERROR`. That includes the five
guarded reads the whole feature depends on **and** the unauthenticated `GET /field/ingest/{token}`,
which is a shipped, working feature on `main`. Until migration `0015` (and the `0016` backfill) is
applied to the production database, no contract or code change alters what a guest sees — the 500
arrives before any of the logic in the blockers doc runs.

The evidence is a clean differential (full table in [§1](#1-the-real-blocker-production-is-missing-the-migration)):
the discriminator is **"does this request read `special_access`?"**, not "is there an `accessId`?".
Routes that don't touch the table are healthy (`GET /inspections/{id}` → 404, `GET /users` → 401);
routes that do touch it all 500. `?accessId=` empty → 401 (falsy, session path, no table read);
`?accessId=anything` → 500 (token path, table read).

**This changes three things in the plan:**

1. **B3 is probably not a code bug.** The guard already throws `SPECIAL_ACCESS_INVALID` (403) for an
   unresolvable token, and its test suite is green (14 tests). The 500 is almost certainly
   `relation "special_access" does not exist` surfacing through the generic 500 handler. Fix the
   database first, then re-probe B3 — it may close for free.
2. **There is a durable fix, and it is the point of the exercise:** `.github/workflows/deploy.yml`
   runs tests then `wrangler deploy` and **never runs a migration**. The missing table is a
   process bug, not a one-off. It will recur with the next migration unless a migrate step lands.
3. **B6 is wrong as written.** `damage_evidence` is *not* inert — it is the credential the field-intake
   surface already consumes. The details file has the correction and a recommendation.

---

## 1. The real blocker — production is missing the migration

### What is observed

| Request | Reads `special_access`? | Today |
| --- | --- | --- |
| `GET /inspections/{id}` | no | `404 INSPECTION_NOT_FOUND` ✓ healthy |
| `POST /inspections/{id}/ping` | no | `404 INSPECTION_NOT_FOUND` ✓ healthy |
| `GET /users` | no | `401 AUTH_TOKEN_MISSING` ✓ healthy |
| `GET /assets/types` | no | `401 AUTH_TOKEN_MISSING` ✓ healthy |
| `GET /reservations/{id}?accessId=` (empty) | no — falsy → session path | `401 AUTH_TOKEN_MISSING` ✓ healthy |
| `GET /reservations/{id}?accessId=deadbeef` | **yes** | **`500`** |
| `GET /reservations/{id}/photos?accessId=deadbeef` | **yes** | **`500`** |
| `GET /apartments/{id}?accessId=deadbeef` | **yes** | **`500`** |
| `GET /apartment-shots/apartment/{id}?accessId=deadbeef` | **yes** | **`500`** |
| `GET /inspections/reservation/{id}?accessId=deadbeef` | **yes** | **`500`** |
| `GET /field/ingest/bogustoken` | **yes** | **`500`** |

The last row is the tell: `/field/ingest` is unauthenticated and has nothing to do with `accessId`,
but it reads `special_access` (`incidentsService.getFieldContext`) and 500s exactly like the rest.
The deployed build is current — `origin/main` is `ea0b125`, the same commit as this branch's HEAD, and
the live OpenAPI already advertises the guard's 403 codes. So this is not a stale deploy.

### The one command that confirms it

```bash
# against the SAME database the worker uses (the DATABASE_URL secret in deploy.yml)
psql "$DATABASE_URL" -c "select to_regclass('public.special_access');"
# expect: NULL  → the table is missing, and that is the 500
```

### The fix

1. **Immediate (ops):** run the migrations against the production database.
   `npm run db:migrate` with the production `DATABASE_URL`. Verify the worker's `DATABASE_URL`
   secret points at the *same* database the migration targets — if they differ, that is the root
   cause and no local migration run will help.
2. **Durable (code):** add a migration step to `.github/workflows/deploy.yml` *before*
   `npx wrangler deploy`, so a deploy cannot ship code that outruns its schema.
3. **Re-probe B3 afterwards.** If `GET /reservations/{id}?accessId=deadbeef` becomes `403
   SPECIAL_ACCESS_INVALID`, B3 is closed with no code change. If it stays 500, escalate to the
   code-level checklist in the details file.

---

## 2. What each remaining blocker actually needs

Ordered by value. `FE` = the frontend work it unblocks.

| # | Blocker | Kind | Effort | Depends on | FE it unblocks |
| --- | --- | --- | --- | --- | --- |
| **B0** | Prod DB missing migrations | **Ops + CI** | S | — | Everything |
| **B1** | `?accessId=` undocumented; no `securitySchemes` | Contract | S | — | Generated client stops needing `as never` |
| **B2** | Two reservation reads document no access error | Contract | S | — | Error types for the guest's first two calls |
| **B3** | Invalid link answers 500 not 403 | **Likely closed by B0** | S | B0 | An honest "this link is invalid" screen |
| **B4** | No `/incidents*` endpoint accepts access | Capability | M | B1 | Guest mode on `/incident/:id/proofs` |
| **B5** | Submit path rejects access | Capability | M | B1 | A guest submitting the proofs they collected |
| **B7** | No introspection endpoint | New surface | S–M | — | A route guard that validates before render |
| **B8** | Grants can't be listed | New surface | S | — | Showing/revoking a link after the session ends |
| **B9** | Create requires only `scope` | Contract | XS | — | Confidence a minted link covers its target |
| **B6** | `damage_evidence` "opens nothing" | **Correction** | XS | — | (Prevents building the wrong thing) |

**If the list must be cut:** B0 → B1+B2 (cheap, make everything else legible) → B4+B5 (the
user-visible feature) → B7 (the routing design). B8 and B9 are quality; B6 is a decision, not work.

### B1 — declare the parameter and the scheme *(contract, cheap)*

Today `securitySchemes` is **absent** from the live document (components are only `schemas` and
`parameters`), and `accessId` appears 6 times — all of them a path param on `DELETE
/special-access/{accessId}` or inside a schema. It is a query param on **no** endpoint, which is why
the frontend casts `query: { accessId } as never` at every call site.

Two changes: add `accessId` as an optional `query` param on the six guarded routes, and register the
scheme. `registerComponent("securitySchemes", …)` is verified working in this stack (probe output in
the details file). Keep it to the scheme registration + the param — do **not** add a route-level
`security` array, which would read as "required" to a generator.

### B2 — document the access error on the two reservation reads *(contract, cheap)*

Both reservation reads mount `specialAccessGuard`, but `getReservationByIdErrors` in
`src/modules/reservations/reservations.contract.ts` omits `SPECIAL_ACCESS_INVALID` /
`SPECIAL_ACCESS_SCOPE_MISMATCH`. `scripts/check-contracts.ts` doesn't catch it because it only
requires a 403 for guards it recognises **by name** (`authGuard`, `rolesGuard`, `apartmentGuard`) —
`specialAccessGuard` is not in that list. One edit to the shared bundle fixes both routes.

### B3 — the 500 *(see §1)*

Do not plan code for this until B0 is verified. The guard's logic is already correct and tested; the
failure is upstream of it.

### B4 — let the incident reads accept access *(capability, medium)*

`GET /incidents/{id}` and `GET /assets/apartment/{apartmentId}` need to accept `?accessId=`, because
`/incident/:incidentId/proofs` cannot read a claim as a guest today (the page ships an honest
"not available yet" refusal — `IncidentProofsPage.tsx`).

This needs a **new bind kind**: the incident id is not a reservation id, so the existing
`reservationParam`/`apartmentParam` binds don't fit. The guard must resolve
incident → reservation and compare to the grant. That is the same join `damage_evidence` grants
already carry, which is what ties B4 and B6 together.

### B5 — the submit path *(capability, medium)*

`POST /apartments/{id}/photos/upload-tokens`, `POST /apartments/{id}/photos/confirm` and
`PATCH /reservations/{id}` reject access. **This is a decision, not a bug:** either accept
`?accessId=` on all three (the feature's original intent — a photographer collects *and submits*), or
document explicitly that guest submission is out of scope, which makes the frontend's read-only guest
guide permanent by design. Decide it; do not leave it ambiguous.

### B6 — correction: `damage_evidence` is already wired

The blockers doc says no endpoint accepts a `damage_evidence` link, and that a grant minted with it
opens nothing. **Both halves are wrong.** `damage_evidence` is the credential of the field-intake
surface: grants are minted by `insertFieldGrant`, consumed by `incidentsService.getFieldContext` at
the unauthenticated `/field/ingest/{token}` routes, and migration `0016` backfills existing cleaner
tokens into them. `getFieldContext` resolves by `special_access.incidentItemId` (not by
`cleaner_token`), so a host-minted `damage_evidence` grant from `POST /special-access` opens that
item's field page for real. There is no inert link.

What this means for planning: do **not** build a second damage-evidence mechanism for B4, and do not
treat B6 as a bug. The only open question is whether the public create should keep offering the
scope, which is a small deliberate choice — see the details file. It is not a phase.

### B7 — introspection *(new surface)*

There is no `GET /special-access/{accessId}` (live: `404 ROUTE_NOT_FOUND`), so a route guard cannot
validate a link before render without firing a real read and inheriting B3's 500. Add a
`GET /special-access/{accessId}` returning the grant's scope and target ids for a live link, `403
SPECIAL_ACCESS_INVALID` otherwise. **Decision:** anonymous (the `accessId` is the credential) or
bearer-only. Recommend anonymous, returning the minimum the link already grants.

### B8 — list grants *(new surface)*

Only `POST` and `DELETE` exist on `/special-access`; `revokedAt`/`usedAt` are stored but unreachable,
so a host who reloads loses the link they just minted. Add
`GET /special-access?reservationId=…` (host-authorized). **Decision:** the list must return
`accessId`, because the frontend needs it to rebuild the URL — a deliberate relaxation of the
"`accessId` is returned only at create" rule. Decide and document it.

### B9 — the per-scope rule *(contract, trivial)*

Live: `CreateSpecialAccess.required = ["scope"]`. The *code* already enforces the rule via
`superRefine` in `special_access.schema.ts`, so runtime returns `400 VALIDATION_ERROR` — the gap is
purely that JSON Schema cannot express a `superRefine`. Cheapest correct fix: document the rule as
runtime-only in the schema description. Do not rework to a discriminated union unless you also want
the generated client to enforce it.

---

## 3. Suggested phase shape

A shape, not the plan — the plan is `feature-kickoff`'s output.

| Phase | Contains | Why grouped |
| --- | --- | --- |
| **1 — Unbreak prod** | B0: run migrations, add the CI migrate step, re-probe B3 | Everything else is unobservable until the table exists; B3 may close here |
| **2 — Make the contract legible** | B1, B2, B9 | Pure contract edits, one regeneration on the FE side, no behaviour change |
| **3 — Let guests read a claim** | B4 (+ the B6 decision) | One new bind kind, shared by the incident read and the asset read |
| **4 — Let guests submit** | B5, after the accept/reject decision | Independent of phase 3; same guard machinery |
| **5 — Introspection & listing** | B7, B8 | New routes; B8 can reuse B7's shape |

**Every phase ends with `npm run gate`.** Phase 1's acceptance is a *probe*, not a test — the fix is
ops, so its proof is the probe table in §1 turning green.

---

## 4. Frontend contract (what "done" means for `covera`)

After a backend change, `covera` must run `npm run api:generate` (a network step, operator-run) and
then `npm run gate`. A change that is not regenerated is invisible to the frontend and will be planned
as if it never happened. The frontend work waiting on this:

| Frontend | Waiting on |
| --- | --- |
| `InspectionGuidePage` guest reads (reservation, shots, photos) | B0, B1, B2 |
| Its honest "link invalid" state | B3 (after B0) |
| `IncidentProofsPage` guest mode | B4 |
| `ReservationLinksSection` list + revoke-after-reload | B8 |
| A route guard that validates before render | B7 |
| `specialAccess.ts` losing its `as never` casts | B1 |

---

## 5. Not blockers — do not change

Carried forward from the source doc, still true:

- `POST /inspections` accepting access is **correct**, not a bug. It is the asymmetry with the photo
  path (B5) that needs a decision.
- Revoking by `accessId` with no list is not itself wrong — the missing list (B8) is the cost.
- The submit endpoints rejecting access is **not** a security hole; B5 is a feature request.
- The three submit endpoints, the reservation reads, and the guard's either-or semantics (a bad token
  never falls back to a valid session) are all deliberate and load-bearing.
