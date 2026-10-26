# Asset types list endpoint

Status: DRAFT

## Intent

In the operator's words:

> I need to provide an endpoint that will return all asset types. This should be an asset module
> endpoint, and it should return the asset types without any pagination, just a list, but this list
> needs to be sorted A-Z.

The endpoint exists so a client can populate an asset-type picker. Today the only way to learn an
asset type's `id` is to already have an asset that references it, which makes `POST /assets`
unusable for a host creating their first asset. `ASSET_TYPE_INVALID` in
`src/modules/assets/assets.errors.ts` already instructs the caller to use `GET /assets/types`, so
this endpoint closes a promise the API has already published.

Sorting is by `code`, ascending — the operator's decision, recorded as D4.

## Behaviour

| # | Method | Path | Guards | Success | Failure modes |
| --- | --- | --- | --- | --- | --- |
| 1 | GET | `/assets/types` | `authGuard`, `rolesGuard(["admin","host"])` | `200` bare JSON array of `AssetType`, ordered by `code` ASC | `401` `AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID`; `403` `FORBIDDEN_ROLE`; `500` `INTERNAL_SERVER_ERROR` |

`AssetType` is the existing schema: `{ id, code, category, createdAt, updatedAt }`
(`src/db/schema/asset-types.ts`). The list is a bare array — no envelope, no `total`, no `page`.

No query parameters of any kind: no pagination, no filter, no sort override. The ordering is fixed
server-side.

## Data changes

**None.** No schema change, no migration, no backfill. `asset_types` already exists (migration
`drizzle/0012_fresh_gambit.sql`) with `code varchar(100) NOT NULL UNIQUE` and a `category` enum, and
`ORDER BY code ASC` on a UNIQUE column is already deterministic — no tiebreaker is required.

The table is empty in this repository: there is no seed script anywhere in the tree, so this
endpoint returns `[]` until catalog rows are inserted by some other process. That is correct
behaviour for this feature, not a defect.

## Invariants this must not break

- The error envelope is built only in `renderError` (`errorHandle.md` §3)
- Guards and handlers throw; they do not return error JSON (§4.2)
- Every `code` comes from `ERROR_REGISTRY` — this feature adds no codes (§5)
- Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids (§8)
- Every route declares every status it can actually produce (§6)
- Feature-specific: the A-Z ordering is expressed as SQL (`ORDER BY "asset_types"."code" asc`) and
  never re-sorted in JavaScript. A handler that sorts its own result would pass a live test while
  silently ignoring the index.
- Feature-specific: the response body is a bare array. No endpoint in this codebase wraps a list in
  a `data` envelope.

## Out of scope

- **Writing to the catalog.** No create/update/delete for asset types. Read only.
- **Seeding `asset_types`.** The empty table is accepted; populating it is a separate task.
- **A `name` / human-readable label column.** The branch name is `feature/43_assets-name-table`, but
  `asset_types` currently has no name column and this feature deliberately does not add one. Sorting
  therefore uses `code`, which is what D4 records. If a display name is wanted later it is a
  migration plus a backfill plus a sort-key change — a separate feature.
- **Changing `ASSET_TYPE_INVALID`'s message or the `assets.name`/`assets.category` legacy columns.**
- **The `?category=` filter** a picker might eventually want.
- **Noticed but untouched:** `AUTHED` (`src/core/errors/error.responses.ts`) omits
  `AUTH_SESSION_EXPIRED`, which `authGuard` does throw on an expired session. That under-documents
  401 bodies on *every* authed route in the repo. Pre-existing, repo-wide, and out of scope here;
  this route follows the existing `[...AUTHED, ...ROLE]` convention rather than diverging.

## Open questions

None.
