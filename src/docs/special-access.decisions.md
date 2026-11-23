# Special access links — decisions

Every choice the executor would otherwise make mid-flight. Approve the table in one pass, or edit
it in place; do not leave a row in `OPEN`.

**Status values:** `APPROVED` · `OPEN` (blocks execution) · `REJECTED` (kept for the record)

---

## Decisions

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D1 | One table, `special_access`, with `scope` as a pg enum of exactly two values: `inspection_proof`, `damage_evidence`. | The prep doc's "document all the instances ... maybe as enums" taken literally: a third instance is a new enum value + a registry row, not a new mechanism. Operator chose the unify option. | APPROVED |
| D2 | The credential column is `access_id varchar(64) UNIQUE`; the PK stays a separate `id uuid`. | Keeps the internal FK target stable if a token is ever rotated or a link re-minted, and matches `incident_items.cleaner_token`'s existing shape (a unique varchar credential beside a uuid PK). | APPROVED |
| D3 | `accessId` travels as the query parameter `?accessId=<token>`. | Operator's choice. Also the only transport that works unchanged for POST bodies, where the page param is not a body field the server already accepts. | APPROVED |
| D4 | The query schema is `accessId: z.string().min(1).max(64).optional()` — **not** a strict 32-hex regex. | A strict pattern would split "dead link" into 400 (malformed) and 403 (well-formed but unknown), forcing the client to handle two shapes for one user-facing condition. Any supplied value reaching the guard yields one uniform 403. | APPROVED |
| D5 | A request with **no** `accessId` is byte-for-byte today's behaviour on every touched route. The guard is either-or, never additive. | The prep doc's gotcha 2 ("needs to work with the current ones") read as the strongest possible constraint: the session path must be unreachable-by-accident from the token path and vice versa. | APPROVED |
| D6 | When `accessId` **is** present, the JWT/session path is not consulted at all — not even as a fallback. A bad token with a valid session is a 403. | "Additive" would mean a host with a valid session could test a token by observing whether it changed anything, and would make the token's window unenforceable. Either-or keeps one authority per request. | APPROVED |
| D7 | `inspection_proof` grants are **multi-use** for their window; `damage_evidence` grants are **single-use**. | The proof page makes a dozen calls (reservation, apartment, shots, photos, then POST inspection, then flags) before it is done, so single-use would break it on the second request. The field submit already burns its token (D11 of that feature) and that semantic is preserved. | APPROVED |
| D8 | New codes, all **403**: `SPECIAL_ACCESS_INVALID` (unknown, expired, or revoked), `SPECIAL_ACCESS_SCOPE_MISMATCH` (valid token, wrong scope or wrong target), `SPECIAL_ACCESS_NOT_FOUND` (**404**, unknown grant on the revoke route only). | The prep doc frames this as emulating *role* access, and `roleGuard` already answers 403 for "your credential does not open this". Reusing 403 keeps the two paths' failure shape identical. 404 is reserved for the id-scoped management route, mirroring every other `{id}` route in the repo. | APPROVED |
| D9 | Token validation happens **before** the target is resolved. A bad token 403s without a single read of the reservation, apartment, or inspection. | This is what makes 403 safe here: it confirms something about the caller's own credential and nothing about whether the resource exists. It is also the cheapest possible rejection (one indexed lookup on `access_id`). | APPROVED |
| D10 | The guard is a **single composed middleware**, `specialAccessGuard({ scope, bind })`, that *calls* `authGuard` and the role check internally for the no-token path. It does not sit beside them in the `middleware` array. | Two entries in the array would run `authGuard` first and 401 a token request before the token was ever seen. Calling them internally is also what keeps the session path from drifting: there is one code path, not a copy. | APPROVED |
| D11 | The guard takes an explicit, closed `bind` descriptor naming the path param, e.g. `{ kind: "apartmentParam", param: "apartmentId" }`. **Three** kinds: `reservationParam`, `apartmentParam`, `reservationBody`. | The routes do not agree on param names (`/apartments/{id}` vs `/apartment-shots/apartment/{apartmentId}`), so an implicit "look for an id" resolver is wrong on half of them. Naming the param makes each route's binding reviewable at its own declaration. There is no `inspectionParam` kind: `POST /inspections/{id}/flags` is the only route that binds an inspection, and D20 keeps it off the token surface entirely, so no route needs it. | APPROVED |
| D12 | The grant is bound to **one reservation**; `apartment_id` is denormalized onto the row and derived from that reservation server-side. | `assertCanCreateInspection` and both windows are reservation-scoped, and three of the seven routes are reserved-scoped while two are apartment-scoped. Storing the apartment avoids a join on every redemption for the two apartment routes. | APPROVED |
| D13 | Mint body is `{ scope, reservationId?, incidentItemId?, expiresInHours? }`; the server derives apartment and reservation from the subject. `expiresInHours` is an integer 1–72, default **12**. | 12 matches `TOKEN_TTL_MS`, so the two surfaces behave alike by default. The 72h cap keeps "small window" from becoming a standing grant. Server-side derivation means a client cannot bind a grant to an apartment it does not own. | APPROVED |
| D14 | The mint response is `201` and returns the full grant **including `accessId`** — the only response that ever carries it. | Same rule as `cleanerToken`: it is a credential the host relays once. Every read path omits it, so the safe hydration is the default and only two routes ask for it by name. | APPROVED |
| D15 | Revoke is `DELETE /special-access/{accessId}` → `200 { success: true, accessId }`, setting `revoked_at`. Revoking an already-revoked grant is **200** (idempotent); an id that never existed is **404**. | A retried revoke must not look like a failure to a client that cannot tell a lost response from a lost grant. Unknown ids still 404 so the route is not an existence oracle for garbage. | APPROVED |
| D16 | Management routes (`POST /special-access`, `DELETE /special-access/{accessId}`) are **session-only**: `authGuard` + `rolesGuard(["admin","host"])` + `assertApartmentOwnership`. A token can never mint or revoke a token. | A token that could mint tokens would be privilege escalation with extra steps. Ownership is asserted through the reservation's apartment, reusing `db-validator`, exactly as `incidents.route.ts` does (its D21). | APPROVED |
| D17 | The field surface keeps its path, its unauthenticated design, its single-use semantics, and its uniform `FIELD_TOKEN_INVALID` 404. Only the token's *storage* moves to `special_access`. | The field surface is deployed and working; changing its wire contract would be a breaking change with no benefit. Its 404-on-every-failure rule is preserved deliberately (it *is* reachable by token only, so 404 is not an oracle). | APPROVED |
| D18 | In P6, `incident_items.cleaner_token` and `token_expires_at` are **kept and still written** as a mirror while the new table becomes the read source. The columns are dropped in a later feature, not this one. | This is what makes the riskiest phase revertable by re-pointing one read (`getFieldContext`) instead of restoring data. Dropping columns is irreversible and buys nothing in this feature. | APPROVED |
| D19 | A new module directory `src/modules/special_access/` with the repo's standard files: `.schema.ts`, `.errors.ts`, `.service.ts`, `.contract.ts`, `.route.ts`, `.test.ts`, `.service.test.ts`. | The repo's convention; `locations/` is the smallest complete example. The guard lives in `src/middleware/specialAccessGuard.ts` beside the other three guards. | APPROVED |
| D20 | `POST /inspections/{id}/flags` gets **no** token support and **no** new guard. It is already unauthenticated today (`createInspectionFlagRoute` mounts no middleware), so it needs no credential and adding one would break existing guests. | Recorded because the operator named it in scope. It needs zero work; the pre-existing open write is raised in the spec's findings instead of being silently "fixed" mid-feature. | APPROVED |
| D21 | Adding the three new codes **requires** three new rows in `EXPECTED_STATUS` (`src/core/errors/error.codes.test.ts`) and the §5 registry table in `src/docs/errorHandle.md`. | `error.codes.test.ts` asserts `Object.keys(EXPECTED_STATUS).sort()` equals the registry's keys, so a new code fails the gate until mirrored. Making that an explicit step stops it surfacing as a mystery red gate at P1. | APPROVED |
| D22 | `src/docs/errorHandle.md` §5 table gains the three new codes in **P1**, alongside the registry edit; §12 gains a pointer to this feature's decision to reuse 403 for token failures. | §5 is the registry-of-record and would otherwise be wrong, and `error.codes.test.ts` already pins the registry — so the registry, its status test, and §5 are one reviewable unit in the same phase. The 403-for-tokens choice is the one a future reader would re-litigate. | APPROVED |
| D23 | Six phases, one commit each: P1 schema+codes+`errorHandle.md` §5, P2 module data layer (schemas, errors, service), P3 management routes, P4 guard, P5 wire the six routes, P6 unify the field surface. The spec/decisions/index are a pre-execution docs commit, separate from all six, and a step 0 resets the tree to the baseline first. | P2 needs P1's enum and codes; P3 needs P2's service; P4 needs P2's resolver; P5 needs P4's guard; P6 needs P2 only, and is ordered last so there is one landing order. P2 is split from P3 because the module's data layer and its HTTP surface fail for different reasons, and P6 is separable (index "Deferrable"). | APPROVED |
| D24 | Tests live in the module: `special_access.test.ts` (routes), `special_access.service.test.ts` (service), plus cases appended to the existing `inspections.test.ts` and `incidents.test.ts` for the guard's effect on their routes. | Route/service split follows `assets/`; the two existing suites already have the mock harness the guard tests need, and a new file would duplicate their mocks. | APPROVED |

---

## Checklist — close every one of these before approval

**Shape**
- [x] Route path and HTTP method — D15, D16; token-enabled routes keep their existing paths (D3, D11)
- [x] Success status and whether a body is returned — D14 (`201`, body carries `accessId`), D15 (`200`)
- [x] Request schema strictness — D4 (loose on purpose), D13 (mint body). Unknown keys: Zod strips by default in this repo; no `.strict()` added.
- [x] Pagination / filtering parameters — n/a: no list endpoint (spec out-of-scope)

**Auth**
- [x] Which guards run, in which order — D10 (one composed guard), D16 (management routes)
- [x] Every role that may call it — management: `admin`, `host` (D16). Token routes: no role; the token is the authority (D5, D6).
- [x] Deliberately unauthenticated — D17 (field surface, unchanged), D20 (flags route, unchanged)

**Failure modes** — one row per way it can fail
- [x] Registry code for each — D8 (`SPECIAL_ACCESS_INVALID`, `SPECIAL_ACCESS_SCOPE_MISMATCH`, `SPECIAL_ACCESS_NOT_FOUND`); D21 mirrors them into `EXPECTED_STATUS` and §5
- [x] Status for each, confirmed against the registry — 403, 403, 404; existing codes keep their existing statuses
- [x] 400 vs 403 vs 409 split — 400 only from the loose query/body schema; 403 for all token failures (D8); no 409 (a grant insert has one UNIQUE and the service checks it first)
- [x] Which errors expose an id or driver text — `SPECIAL_ACCESS_*` messages name no id and no target; the token, reservation id and apartment id go in `meta` only

**Data**
- [x] Schema change — new enum `access_scope`, new table `special_access` (spec's Data changes table)
- [x] Migration — P1 additive (safe before code, after code, or either). P6 step 6.0 backfills `damage_evidence` rows from `incident_items` and is the only step that must run in order relative to the code: 6.0 before 6.3.
- [x] Foreign keys and delete behaviour — `apartment_id`/`reservation_id`/`incident_item_id` `CASCADE` (a grant for a deleted subject is meaningless); `created_by` `SET NULL` (the grant outlives the host's account and the audit trail is worth keeping)
- [x] Unique constraints / SQLSTATEs a client can trip — UNIQUE(`access_id`) only. `makeToken()` collisions are a constraint failure, not a silent overwrite; the service does not pre-check it (matching `cleaner_token`).

**Breaking changes**
- [x] Existing response shape changed — no. `accessId` is echoed only in the mint response; every token-enabled route returns the payload it already returned.
- [x] Existing status code changed — no. New 403s are only reachable when `accessId` is supplied (D5), so no existing caller can observe them.
- [x] Client action required — no for existing clients. The `inspectionGuide` page is the new client and is out of scope (spec).

**Process**
- [x] Commit granularity — D23: one per phase, docs separate
- [x] Where tests live — D24
- [x] `errorHandle.md` update needed — D22 (yes: §5 table + §12 note)

---

## Rejected alternatives

| ID | Alternative | Why rejected |
| --- | --- | --- |
| R1 | A `cleanerToken`-style token per *endpoint group*, minted ad hoc, with no table. | The prep doc explicitly wants a record ("we can have a table, record where we can add all this info"), revocation, and a queryable window. A token that encodes its own scope is also one signing-key rotation away from mass invalidation with no audit trail. |
| R2 | A short-lived JWT signed with the grant's claims, needing no table lookup. | Faster per request, but revocation then requires either a denylist (the table, again) or waiting out the TTL. The prep doc requires the host to be able to cut access off, and gotcha 3's efficiency requirement is already met by one indexed lookup on a UNIQUE column. |
| R3 | Add `accessId` support to `rolesGuard` itself rather than a third guard. | `rolesGuard` is mounted on ~20 routes that must not gain a token path, and its signature (`allowedRoles`) has nowhere to put a scope or a target binding. Widening it edits every one of those routes' authority in one commit. |
| R4 | Put the token in the path (`/special-access/{accessId}/reservations/{id}`) as the field surface does. | Explicit and log-friendly, but it duplicates all six route declarations and their contracts, and the operator asked for the page param form (D3). The field surface is the exception because its whole path *is* the token. |
| R5 | Make `inspection_proof` grants single-use for symmetry with the field surface. | Breaks the page on its second request (D7). Symmetry was not worth an unusable feature. |
| R6 | Enforce the token's window *and* the domain windows (`INSPECTION_WINDOW_EXPIRED`, `FLAG_WINDOW_EXPIRED`) in one place. | They are different rules with different owners: the grant's window is the host's grant, the domain windows are the business rule a real host is also subject to. Collapsing them would make a token able to extend a business rule. Independence is stated in the spec instead. |
| R7 | Add a guard to `POST /inspections/{id}/flags` while touching it. | It is unauthenticated today; adding one is a breaking change to a shipped surface that this feature does not need (D20). |
| R8 | Drop `incident_items.cleaner_token` in the same migration that adds the table. | Irreversible, and it removes the mirror that makes P6 revertable by a one-line re-point (D18). |
| R9 | Return 404 instead of 403 for an invalid token, matching `FIELD_TOKEN_INVALID`. | On the field surface the token is the whole path, so 404 leaks nothing. On these routes the path is a real resource id, and 404 would make "expired link" indistinguishable from "reservation deleted" — the exact distinction the user needs to act on (D8). D9's ordering is what makes 403 safe. |

---

## Facts verified while writing this (with the command that verified them)

Guesses become wrong decisions executed at scale. Record what you checked.

| Fact | Verified by | Result |
| --- | --- | --- |
| Baseline gate is green | `npm run gate` | GATE PASSED, **716 tests passing**, exit 0 |
| The damage-evidence surface already implements this pattern by hand | Read `src/modules/incidents/incidents.field.contract.ts`, `incidents.field.route.ts` | `/field/ingest/{token}`, **no guard on any route**, `requireFieldContext` throws `FIELD_TOKEN_INVALID` 404 on every failure; `cleanerToken` UNIQUE, `tokenExpiresAt`, burned at submit |
| `getFieldContext` resolves by token and is the single read to re-point | Read `incidents.service.ts` (`getFieldContext`) | One `select` joining `incident_items → incidents → reservations → apartments`, `where(eq(incidentItems.cleanerToken, token))`, then a `tokenExpiresAt <= now` guard |
| `makeToken()` shape and TTL | Read `incidents.service.ts` | `crypto.randomUUID().replace(/-/g,"")` → 32 hex; `TOKEN_TTL_MS = 12 * 60 * 60 * 1000` |
| `POST /inspections/{id}/flags` is already unauthenticated | Read the `createInspectionFlagRoute` declaration in `inspections.contract.ts` | **No `middleware` property at all** — no `authGuard`, no `rolesGuard`. D20 confirmed. |
| `GET /inspections/{id}` is already unauthenticated | Read `getInspectionByIdRoute` in `inspections.contract.ts`; read `app.openapi(getInspectionByIdRoute, …)` in `inspections.route.ts` | No middleware; the JSDoc says "Unauthenticated so guests can view without logging in." |
| The exact guard on each of the six token-enabled routes | Read `reservations.contract.ts`, `apartments.contract.ts`, `apartment_shots.contract.ts`, `inspections.contract.ts` | `/reservations/{id}` and `/{id}/photos`: `authGuard, rolesGuard(["admin","host"])`; `/apartments/{id}`: `authGuard` **only**; `/apartment-shots/apartment/{apartmentId}`: `authGuard, rolesGuard(["admin","host"])`; `/inspections/reservation/{reservationId}`: `authGuard, rolesGuard(["admin","host"])`; `POST /inspections`: `authGuard, rolesGuard(["host"])` |
| Path param names disagree across the six | Read the param schemas | `/reservations/{id}` → `id`; `/apartments/{id}` → `id`; `/apartment-shots/apartment/{apartmentId}` → `apartmentId`; `/inspections/reservation/{reservationId}` → `reservationId`; `/inspections/{id}/flags` → `id`. Hence D11's explicit param name. |
| `check-contracts.ts` requires statuses by **name-matching the middleware text** | Read `scripts/check-contracts.ts` | `new RegExp("\\b" + guard + "\\b").test(text)` for `authGuard`, `rolesGuard`, `apartmentGuard`. `specialAccessGuard` contains none of those substrings, so the check will require only 500 unless `rolesGuard` is also named — the six routes must therefore declare their 401/403/404 truthfully by hand. |
| `check-contracts.ts` scans **every** `*.contract.ts`, not just `<module>.contract.ts` | Read `scripts/check-contracts.ts` | Globs all `*.contract.ts` per module dir — so the new module's contract is covered automatically |
| `EXPECTED_STATUS` must mirror every registry key | Read `src/core/errors/error.codes.test.ts` | `expect(Object.keys(EXPECTED_STATUS).sort()).toEqual([...CODES].sort())` — a new code without a row fails the gate. D21 confirmed. |
| Registry currently has 38+ codes and the count is asserted | Read `error.codes.test.ts` | `expect(CODES.length).toBeGreaterThanOrEqual(38)` — additive, no edit needed |
| The 403 codes live together in the registry | Read `src/core/errors/error.codes.ts` | `FORBIDDEN_ROLE`, `FORBIDDEN_APARTMENT_ACCESS` under the `// ---- 403` comment — the three new codes join that block |
| Tests are mock-based; no real DB | Read `vitest.setup.ts`, `src/core/utils/test-factory.ts`, `inspections.test.ts` | `createTestApp` sets `db` to `{}`; suites `vi.mock` the service and `db-validator`. A guard test must therefore mock the resolver, not a connection. |
| `createTestApp` supports per-test context overrides | Read `src/core/utils/test-factory.ts` | `contextOverrides(c)` sets arbitrary context keys per test — the harness for seeding a resolved grant without a DB |
| `assertApartmentOwnership` is the reusable ownership assertion | Read `src/core/utils/db-validator.ts` | `(db, apartmentId, { userId, role, allowAdmin })`; throws `APARTMENT_NOT_FOUND` 404 then `FORBIDDEN_APARTMENT_ACCESS` 403. D16 reuses it. |
| `incidents.route.ts` asserts ownership through the reservation's apartment, not `apartmentGuard` | Read `resolveOwnedIncident` in `incidents.route.ts` | Its D21 comment states the reason: `apartmentGuard` resolves an unknown id through `apartments` first and reports `APARTMENT_NOT_FOUND` for a claim that does not exist. D16 mirrors this. |
| Most recent migration number | `ls drizzle/*.sql \| tail` | `0014_eminent_miracleman.sql` — the new one is `0015` |
| `apartments` and `reservations` both cascade-delete | Read `src/db/schema/reservations.ts`, `incident-items.ts` | `reservations.apartment_id` → `CASCADE`; `incident_items.incident_id` → `CASCADE`, `asset_id` → `restrict`. So a grant cascading off its subject is consistent with the tree. |
| `users` has `role` (`admin`/`host`/`guest`) and `status` (`confirmed` required to act) | Read `src/db/schema/users.ts`, `roleGuard.ts`, `apartmentGuard.ts` | `rolesGuard` refuses a `status !== "confirmed"` user — the session path's rule the composed guard must keep calling (D10) |
