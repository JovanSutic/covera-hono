# Asset types list endpoint — decisions

Every choice the executor would otherwise make mid-flight. Approve the table in one pass, or edit
it in place; do not leave a row in `OPEN`.

**Status values:** `APPROVED` · `OPEN` (blocks execution) · `REJECTED` (kept for the record)

---

## Decisions

| ID | Decision | Rationale | Status |
| --- | --- | --- | --- |
| D1 | Path is `GET /assets/types`, mounted on the existing assets module. | Already published: `ASSET_TYPE_INVALID`'s message in `assets.errors.ts` tells callers to use `GET /assets/types`. Shipping any other path makes that message a lie. | APPROVED |
| D2 | Guards are `authGuard` + `rolesGuard(["admin","host"])`, in that order. | Matches the sibling read route `getAssetsByApartmentRoute`. Catalog is not secret, but the repo is authenticated-by-default and a picker is a host/admin screen. | APPROVED |
| D3 | Success is `200` with a **bare JSON array**. No envelope, no `total`, no cursor. | Operator: "just a list". Matches `GET /locations` and the assets list route. | APPROVED |
| D4 | Sort by `code` **ascending**, in SQL. | Operator's choice (the table has no `name` column to sort on). `code` is `UNIQUE NOT NULL`, so ordering is total and stable with no tiebreaker. | APPROVED |
| D5 | No query parameters at all — no pagination, no filter, no `sort` override. | Operator: "without any pagination". A catalog is a bounded, small set; a sort override would make the endpoint's contract conditional. | APPROVED |
| D6 | Reuse `AssetTypeSchema`; add one new response schema `AssetTypesListSchema = z.array(AssetTypeSchema).openapi("AssetTypesList")`. | `AssetType` is already registered in the OpenAPI document (as `$ref` from `Asset`), so `z.array(AssetTypeSchema)` alone would inline an anonymous array type with no component name. Naming it makes the array shape reviewable in Swagger. | APPROVED |
| D7 | Handler does not call `checkExistence` and does not verify the caller owns anything; the query is unconditional. | `asset_types` is global reference data — not apartment- or user-scoped. There is no ownership rule to enforce. | APPROVED |
| D8 | No new services file. `getAllTypes` is added to the existing `assetsService`, returning `Promise<AssetType[]>` with `AssetType` inferred from `AssetTypeSchema` (`z.infer`). | The module already has `assets.service.ts`; a second service file for one query is overhead. In the schema file, `z.infer` is the established convention (see the existing `export type Asset = z.infer<typeof AssetSchema>`). | APPROVED |
| D9 | Error bundle is `errorResponses([...AUTHED, ...ROLE])` — no `VALIDATION` (nothing to validate), no `ASSET_TYPE_NOT_FOUND` (nothing is looked up by id). | The route has no params and no body, so `VALIDATION_ERROR` is unreachable; declaring it would document a failure the route cannot produce. `check-contracts.ts` requires only 401/403/500 for this guard set, all three of which the bundle supplies. | APPROVED |
| D10 | The ordering assertion uses the `PgDialect` renderer inside a service test, not a live database. | There is no real-DB harness in this repo — every test mocks `db`. `drizzle-orm/pg-core`'s `PgDialect().sqlToQuery(asc(assetTypes.code).getSQL()).sql` renders `"asset_types"."code" asc` with no connection, so the sort direction becomes a real assertion instead of prose. The mock swallows `orderBy`, so this is the only way to pin direction. | APPROVED |
| D11 | Two phases: P1 endpoint + route tests, P2 service test (ordering). Two commits, plus a third for these three docs. | P2 needs P1's `assetsService.getAllTypes` to exist before it can be tested. Docs commit stays separate from code commits (skill Stage 7; the `ed4e94e` post-mortem). | APPROVED |
| D12 | Tests live in the existing `src/modules/assets/assets.test.ts` (route) and a new `src/modules/assets/assets.service.test.ts` (service). | Route tests belong with the module's existing suite; `apartments.service.test.ts` is the precedent for a service-level file with a chainable mock. | APPROVED |
| D13 | No update to `src/docs/errorHandle.md`. | This feature adds no error code, no failure mode, and no rule. Nothing in §1–§11 changes. | APPROVED |

---

## Checklist — close every one of these before approval

**Shape**
- [x] Route path and HTTP method — D1
- [x] Success status and whether a body is returned — D3 (`200`, body is a bare array)
- [x] Request schema strictness — n/a: no request schema, no params, no body
- [x] Pagination / filtering parameters — D5 (explicitly none)

**Auth**
- [x] Which guards run, in which order — D2
- [x] Every role that may call it — `admin`, `host` (D2). `guest` gets `403 FORBIDDEN_ROLE`.
- [x] Deliberately unauthenticated — n/a: this endpoint is authenticated

**Failure modes**
- [x] Registry code for each — `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`, `FORBIDDEN_ROLE`, `INTERNAL_SERVER_ERROR`; all already in `ERROR_REGISTRY`. No new code (invariant §5).
- [x] Status for each, confirmed against the registry — 401, 401, 403, 500
- [x] 400 vs 403 vs 409 split — n/a: no input to be malformed, no state conflict. The only 4xx are 401/403 from guards.
- [x] Which errors expose an id or driver text — none. `meta` carries `origin` only.

**Data**
- [x] Schema change — none
- [x] Migration — none
- [x] Foreign keys — n/a: no schema change. (`assets.asset_type_id` already `ON DELETE restrict`.)
- [x] Unique constraints / SQLSTATEs a client can trip — none: the endpoint performs no inserts or updates.

**Breaking changes**
- [x] Existing response shape changed — no
- [x] Existing status code changed — no
- [x] Client action required — no. Purely additive: one new path, and the baseline document has 22 paths with no `/assets/types` among them.

**Process**
- [x] Commit granularity — D11: one commit per phase
- [x] Where tests live — D12
- [x] `errorHandle.md` update needed — D13 (no)

---

## Rejected alternatives

| ID | Alternative | Why rejected |
| --- | --- | --- |
| R1 | `GET /asset-types` as its own top-level module | Contradicts D1: the error message already published `GET /assets/types`. A separate module also means a new `src/modules/asset-types/` tree for a single read route. |
| R2 | `GET /assets/asset-types` or `GET /assets/type` | Same contradiction as R1 — no published message names these. |
| R3 | Sort on `category`, then `code` | Considered during the interview. `code` alone is already a total order (UNIQUE), and category-first interleaves unrelated codes, which reads badly in a picker. |
| R4 | Add a `name` column and sort on it | The largest possible version of this change: migration + backfill of existing rows + a second sort-key decision. The operator scoped this feature to "read endpoint only" and chose `code`. Recorded in the spec's out-of-scope section so it is not re-proposed silently. |
| R5 | Sort ascending but fall back to `.sort()` in the handler | Would mask a broken `orderBy` — the live list would still come back sorted while the query ordering was ignored. D10 pins the SQL instead. |
| R6 | Declare `VALIDATION_ERROR` in the error bundle "for consistency" | The route has no params and no body, so it cannot produce a `VALIDATION_ERROR`. Declaring it makes the document lie about the endpoint. |
| R7 | Use `baseResponses` (auth + validation + 500) | Omits 403, which `rolesGuard` does produce, so `check-contracts.ts` would fail the gate. |
| R8 | Assert ordering with a live Postgres connection | No such harness exists in the repo (`vitest.setup.ts` only sets a dummy `DATABASE_URL`; every suite mocks `db`). Introducing one is a project-level change, not part of this feature. |

---

## Facts verified while writing this (with the command that verified them)

Guesses become wrong decisions executed at scale. Record what you checked.

| Fact | Verified by | Result |
| --- | --- | --- |
| `asset_types` has no `name` column | Read `src/db/schema/asset-types.ts`; read `drizzle/0012_fresh_gambit.sql` | Columns are `id, code, category, created_at, updated_at`. No name/label. D4 is therefore forced to sort on `code`. |
| `ASSET_TYPE_INVALID` already names `GET /assets/types` | Read `src/modules/assets/assets.errors.ts:16` | Message reads "…Choose one from GET /assets/types." |
| Baseline gate is green | `npm run gate` | GATE PASSED, 403 tests, exit 0 |
| Baseline gate with OpenAPI is green | `npm run gate:openapi` | GATE PASSED, exit 0 |
| Baseline document path count and shape | `npx tsx --env-file=.env -e "import app from './src/index'; …"` | 22 paths; `/assets/types` absent; asset paths are `/assets/apartment/{apartmentId}`, `/assets`, `/assets/{id}`; `AssetType` already a registered component |
| `asc(assetTypes.code)` renders predictable SQL | `new PgDialect().sqlToQuery(asc(assetTypes.code).getSQL()).sql` | `"asset_types"."code" asc` (and `… desc` for `desc`) — so D10's assertion has a real expected string |
| `/assets/types` is not shadowed by the existing `/{id}` route (different method) nor by `/apartment/{apartmentId}` | Hono router probe replicating the module's paths + methods | `GET /assets/types → 200 {"hit":"types"}`; `/apartment/abc` and `DELETE /:id` still resolve correctly |
| A Drizzle select row satisfies the Zod-inferred `AssetType`, and `orderBy(asc(...))` type-checks | Temp file compiled under `npx tsc --noEmit` | exit 0, no errors |
| `z.array(AssetTypeSchema).openapi("AssetTypesList")` coexists with the already-registered `AssetType` | Temp `OpenAPIHono` app building a doc with both routes | paths `["/assets/apartment/{id}","/assets/types"]`; schemas `AssetsList, Asset, AssetType, AssetTypesList`; list is `{"type":"array","items":{"$ref":"#/components/schemas/AssetType"}}` |
| `AUTH_SESSION_EXPIRED` exists and `authGuard` throws it, but `AUTHED` omits it | Read `src/core/errors/error.codes.ts:34`, `src/middleware/authGuard.ts:22`, `src/core/errors/error.responses.ts:7` | Confirmed. Pre-existing repo-wide gap; left untouched — see spec out-of-scope. |
| No name collisions for the new symbols | `grep -rn` for `AssetTypesListSchema`, `getAllTypes`, `getAssetTypesRoute`, `getAssetTypesErrors` | No hits |
| Test strategy is mock-based, no real DB | Read `vitest.setup.ts`, `src/core/utils/test-factory.ts`, `src/modules/locations/locations.test.ts` | `DATABASE_URL` is a dummy; `createTestApp` sets `db` to `{}`; suites `vi.mock` the service. D10 follows from this. |
| `assets.test.ts` per-test `authUser` override works | Read `src/modules/assets/assets.test.ts:65-82` | `setTestUser(role)` + `contextOverrides` sets `authUser` per test — so the 403 case needs no new harness |
| Baseline test counts used in the Accept lines | `npx vitest run src/modules/assets/assets.test.ts`; `npm run gate` | `assets.test.ts` has **8** tests (not 7 — corrected in p1.md); repo total 403. Phase 1 → 407 and 12; phase 2 → 412. |
| Phase 1's four source snippets compile together | Temp file under `npx tsc --noEmit` | First attempt failed `TS2305: assets.schema has no exported member 'AssetType'` — hence step 1.1 adds the type alias before step 1.2 imports it. Plan is ordered accordingly. |
| Phase 2's test passes, and the ordering assertion is load-bearing | Ran the p2 test body verbatim against a probe service | 5 assertions passed. A negative control against a `desc` implementation rendered `"asset_types"."code" desc`, so the assertion genuinely rejects the wrong direction — the test is not decorative. |
