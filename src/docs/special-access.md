# Special access links

Status: DRAFT

## Intent

Today a resource is reachable either because the caller holds a valid session, or — for the
damage-evidence flow only — because they hold a single-use token in the path. Access is otherwise
a property of the *role*: a `host` may read an apartment, and nobody else may.

Operators need a third thing: the ability to hand one person a **link** that opens a small, named
set of resources for a bounded time, without making that person a host, and without that person
having an account at all. A host mints the link for one reservation, shares it with whoever is
doing the photo work, and after the window closes the link is dead.

The prep doc describes this as emulating role access "when some parameters are met". This feature
implements it as **one table of scoped, time-limited access grants**, resolved by **one guard**,
and reached through one opaque `accessId`. The two surfaces that need it are named by the prep doc
— initial proof collection (`inspectionGuide/:apartmentId/:reservationId`) and damage-evidence
collection after checkout — and they are two **scopes** of the same mechanism, not two mechanisms.

The damage-evidence surface already implements this pattern by hand (`cleanerToken` in the path at
`/field/ingest`, no guard, single-use). This feature **unifies** it: the same table, the same
resolution, the same failure shape. See `special-access.decisions.md` D14–D17 for how that
migration is made revertable.

## Behaviour

`accessId` travels as the query parameter `?accessId=<token>` on any route that opts in.

**Either-or, never additive.** When `accessId` is absent the route behaves *exactly* as it does
today — the same guard chain, run unchanged. When it is present the guard resolves the token and
the JWT path is not consulted. A token never widens what a session already permits, and a session
never rescues an invalid token: a request with a bad `accessId` and no session is refused.

### Token-enabled routes (scope `inspection_proof`)

Every route below resolves its target and requires it to belong to the grant. A grant is bound to
one **reservation**; apartment-scoped routes are satisfied by the grant's apartment, which is
derived from that reservation.

| # | Method | Path | Target bound | Success |
| --- | --- | --- | --- | --- |
| 1 | GET | `/reservations/{id}` | `id` = reservation | 200 |
| 2 | GET | `/reservations/{id}/photos` | `id` = reservation | 200 |
| 3 | GET | `/apartments/{id}` | `id` = apartment | 200 |
| 4 | GET | `/apartment-shots/apartment/{apartmentId}` | `apartmentId` | 200 |
| 5 | GET | `/inspections/reservation/{reservationId}` | `reservationId` | 200 |
| 6 | POST | `/inspections` | body `reservationId` | 201 |

Failure modes for all six: `VALIDATION_ERROR` (400), `SPECIAL_ACCESS_INVALID` (403, token
unknown/expired/revoked), `SPECIAL_ACCESS_SCOPE_MISMATCH` (403, token valid but not for this
scope or this target), `INTERNAL_SERVER_ERROR` (500). Routes 1, 2, 6 additionally keep the codes
they already declare for the session path (`AUTH_TOKEN_MISSING` 401, `FORBIDDEN_ROLE` 403,
`FORBIDDEN_APARTMENT_ACCESS` 403, `APARTMENT_NOT_FOUND` 404, `RESERVATION_NOT_FOUND` 404).

`POST /inspections/{id}/flags` is deliberately **not** on this list (D20). It is already
unauthenticated — it mounts no middleware at all — so it needs no credential, and adding one would
break the guests who can call it today. It is in scope for this feature only in the sense that the
operator named it; the work it needs is zero. The pre-existing open write is raised as a finding
below rather than silently "fixed" mid-feature.

### Management routes (session-only; a token cannot mint or revoke a token)

| # | Method | Path | Guards | Success |
| --- | --- | --- | --- | --- |
| 8 | POST | `/special-access` | `authGuard` + `rolesGuard(["admin","host"])` + apartment ownership | 201 |
| 9 | DELETE | `/special-access/{accessId}` | `authGuard` + `rolesGuard(["admin","host"])` + apartment ownership | 200 |

Failure modes: `VALIDATION_ERROR` (400), `AUTH_TOKEN_MISSING` (401), `FORBIDDEN_ROLE` (403),
`FORBIDDEN_APARTMENT_ACCESS` (403), `RESERVATION_NOT_FOUND` (404), `SPECIAL_ACCESS_NOT_FOUND`
(404), `INTERNAL_SERVER_ERROR` (500).

### The damage-evidence surface (scope `damage_evidence`, unified)

`/field/ingest/{token}` keeps its path shape, its unauthenticated design (D17 of that feature: the
token *is* the credential), its single-use semantics, and its uniform `FIELD_TOKEN_INVALID` 404.
What changes is where the token lives: from a column on `incident_items` to a row in
`special_access`. Payloads are unchanged — `tokenExpiresAt` is still returned.

## Data changes

One new table, `special_access`:

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid | no | PK, internal. Not the credential. |
| `access_id` | varchar(64) | no | UNIQUE. The credential. `makeToken()` format (32 hex). |
| `scope` | `access_scope` enum | no | `inspection_proof` · `damage_evidence`. |
| `apartment_id` | uuid | no | FK → `apartments` `ON DELETE CASCADE`. |
| `reservation_id` | uuid | yes | FK → `reservations` `ON DELETE CASCADE`. |
| `incident_item_id` | uuid | yes | FK → `incident_items` `ON DELETE CASCADE`. |
| `expires_at` | timestamptz | no | |
| `revoked_at` | timestamptz | yes | Host revocation. |
| `used_at` | timestamptz | yes | Single-use scopes only. |
| `created_by` | uuid | yes | FK → `users` `ON DELETE SET NULL`. |
| `created_at` | timestamptz | no | default now. |

Constraints: UNIQUE(`access_id`); indexes on `reservation_id` and `incident_item_id`; a CHECK that
the subject matches the scope — `inspection_proof` requires `reservation_id` and forbids
`incident_item_id`; `damage_evidence` requires `incident_item_id`.

Migration is **additive** in P1 (new enum, new table). The `damage_evidence` **backfill** lands in
P6 (step 6.0) and is the one step that must run in a fixed order relative to the code: it copies
every outstanding `incident_items.cleaner_token` into `special_access` *before* `getFieldContext`
is re-pointed at the new table (step 6.3), or those links die. P6 changes **no** `incident_items`
columns — `cleaner_token` and `token_expires_at` are kept and still written as a mirror (D18), so
the read move is revertable by re-pointing one query.

## Invariants this must not break

- The error envelope is built only in `renderError` (`errorHandle.md` §3)
- Guards and handlers throw; they do not return error JSON (§4.2)
- Every `code` comes from `ERROR_REGISTRY`
- Messages are one plain sentence: no status prefix, no SQL, no table/column names, no raw ids (§8)
- Driver text goes to `meta.driver` only, and is absent in production
- Every route declares every status it can actually produce
- **A request without `accessId` behaves exactly as it does today, on every route the feature
  touches.** The guard composes the existing `authGuard`/`rolesGuard` for that path rather than
  reimplementing them, so the session path cannot drift.

## Out of scope

- No guest-facing or end-user account model. A link grants access; it does not create a user.
- No list/read endpoint for a host's existing grants, and no "extend" or "re-mint" operation.
- Dropping the now-deprecated `incident_items.cleaner_token` / `token_expires_at` columns. That is
  a follow-up cleanup once the mirrored write has shipped (D17).
- Changing what any token-enabled route *returns*. Payloads are identical to the session path.
- Rate limiting and abuse controls on token redemption.
- Any frontend work: route shapes, the `inspectionGuide` page, and link construction.

## Open questions

None. Every choice is closed in `special-access.decisions.md`.
