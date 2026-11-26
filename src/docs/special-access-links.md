# Special access links — spec

What is true after this lands. The only document a reviewer needs to read.

Sources: [`special-access-check.md`](./special-access-check.md) (the FE use cases),
[`backend-blockers-prep.md`](./backend-blockers-prep.md) (the ordered work list),
[`backend-blockers-details.md`](./backend-blockers-details.md) (per-item detail).
Companions: [`special-access-links.decisions.md`](./special-access-links.decisions.md),
[`special-access-links/00-index.md`](./special-access-links/00-index.md).

---

## Intent

A host mints a short-lived `accessId` and sends the resulting URL to someone with no
account — a photographer collecting inspection proofs, or a cleaner collecting damage
evidence. Today that link half-works: it opens the inspection guide's *reads*, and nothing
else. It cannot read a claim, cannot submit the proofs it collected, and when it is expired
or misspelled the API answers **500** so the frontend cannot even say "this link is invalid".

Production is additionally **outage-broken**: migration `0015` (the `special_access` table)
was never applied to the deployed database, so every endpoint that reads that table — five
of the six access-enabled routes *and* the shipped, unrelated `GET /field/ingest/{token}` —
answers 500. The deploy workflow runs `wrangler deploy` with no migration step, so the next
migration will do the same thing again.

This feature closes the blockers end to end: it restores the schema, makes a deploy unable to
outrun it, finishes the guest capability for both pages the link serves (read **and** write),
documents the credential so `covera` can stop casting it, and adds the two missing surfaces
(introspection, listing) the frontend's route guard and link manager need.

## Behaviour

Legend: **S** = session path (unchanged unless noted), **T** = token path (`?accessId=`).

### Existing routes whose token path changes

| Endpoint | Method | Auth | Success | Failure modes |
| --- | --- | --- | --- | --- |
| `GET /reservations/{id}` | GET | S: `authGuard`+`host/admin`; T: `inspection_proof` grant on this reservation | 200 | 403 `SPECIAL_ACCESS_INVALID`, 403 `SPECIAL_ACCESS_SCOPE_MISMATCH` (now documented) |
| `GET /reservations/{id}/photos` | GET | as above | 200 | as above |
| `GET /apartments/{id}` | GET | S: `authGuard`; T: `inspection_proof` grant on this apartment | 200 | unchanged codes, `accessId` now declared |
| `GET /apartment-shots/apartment/{apartmentId}` | GET | S: `authGuard`+`host/admin`; T: as above | 200 | unchanged codes, `accessId` now declared |
| `GET /inspections/reservation/{reservationId}` | GET | S: `authGuard`+`host/admin`; T: `inspection_proof` grant on this reservation | 200 | unchanged codes, `accessId` now declared |
| `POST /inspections` | POST | S: `authGuard`+`host`; T: `inspection_proof` grant for the **body**'s `reservationId` | 201 | unchanged codes, `accessId` now declared |
| `GET /incidents/{id}` | GET | S: `authGuard`+`host/admin`; **T: new** — `inspection_proof` grant on the claim's reservation | 200 | 403 `SPECIAL_ACCESS_INVALID` / `SPECIAL_ACCESS_SCOPE_MISMATCH` |
| `GET /assets/apartment/{apartmentId}` | GET | S: `authGuard`+`host/admin`; **T: new** — `inspection_proof` grant on this apartment | 200 | 403 access codes added |

### Write routes that gain the token path (use case 2: the link-holder posts from both pages)

| Endpoint | Method | Auth | Success | Failure modes |
| --- | --- | --- | --- | --- |
| `POST /apartments/{id}/photos/upload-tokens` | POST | S: `authGuard`+`host/admin`+apartment ownership; T: `inspection_proof` grant on this apartment | 200 | 403 access codes; 401/403/404 as today |
| `POST /apartments/{id}/photos/confirm` | POST | as above | 200 | as above, plus 400 `MAX_PHOTOS_EXCEEDED` |
| `PATCH /reservations/{id}` | PATCH | S: `authGuard`+`host`; T: `inspection_proof` grant on this reservation, **photo-proof fields only** | 200 | 403 access codes; 400 `VALIDATION_ERROR` if a token request carries a field outside the allow-list |
| `POST /incidents/{id}/items/{itemId}/upload-tokens` | POST | S: `authGuard`+`host/admin`; T: `inspection_proof` grant on the claim's reservation | 200 | 403 access codes; existing 400/404/409 unchanged |
| `POST /incidents/{id}/items/{itemId}/evidence` | POST | as above | 201 | as above |

`GET /incidents/{id}` and the `PATCH`/photo routes keep asserting apartment ownership
*through the impersonated owner*, so adding the token path widens nothing for a signed-in
caller.

### New routes

| Endpoint | Method | Auth | Success | Failure modes |
| --- | --- | --- | --- | --- |
| `GET /special-access/{accessId}` | GET | **anonymous** — the `accessId` is the credential | 200 `SpecialAccessIntrospection` = `{ scope, apartmentId, reservationId, incidentItemId, expiresAt }` | 403 `SPECIAL_ACCESS_INVALID` (unknown, expired, revoked, or spent — one code, no oracle), 400 `VALIDATION_ERROR`, 500 |
| `GET /special-access?reservationId=` | GET | `authGuard`+`host/admin`, ownership asserted against the grant's apartment | 200 `SpecialAccessList` = array of `SpecialAccess` **including `accessId`, `revokedAt`, `usedAt`** | 401, 403 `FORBIDDEN_ROLE`/`FORBIDDEN_APARTMENT_ACCESS`, 404 `RESERVATION_NOT_FOUND`, 400, 500 |

### Document changes (no behaviour change)

- `components.securitySchemes.specialAccess` — `{ type: "apiKey", in: "query", name: "accessId" }`,
  with a description saying the guard's session-**or**-token semantics cannot be expressed in
  OpenAPI 3.0 and that no route requires the scheme.
- `accessId` declared as an optional `query` parameter on all **thirteen** token-enabled routes
  (six existing + four claim routes + three submit routes). Verified on 2026-11-26 by reading the
  built document: 13 operations carry it, and `"accessId"` occurs 20 times.
- `SPECIAL_ACCESS_INVALID` / `SPECIAL_ACCESS_SCOPE_MISMATCH` added to
  `getReservationByIdErrors` (fixes both reservation reads at once).
- `CreateSpecialAccess` gains a `description` stating the per-scope rule that `superRefine`
  enforces at runtime and JSON Schema cannot express.
- No route-level `security: [...]` array anywhere — in OpenAPI that means "required", which
  would document the opposite of the truth.

## Data changes

**None.** Migration `0015` (`special_access` + `access_scope`) and `0016` (backfill of live
cleaner tokens) already exist in `drizzle/` and are already in `drizzle/meta/_journal.json`.
No schema file changes, no new migration, no backfill. This feature *applies* them to
production and adds the deploy step that makes applying them automatic.

## Invariants this feature must not break

`errorHandle.md` §0 global rules, plus:

1. The envelope is built only in `renderError`; guards/handlers throw, never `c.json` an error.
2. Every code comes from `ERROR_REGISTRY`; messages name no id, target, table or token.
3. Guards and handlers must never widen what a **signed-in** caller can do. The token path is
   gated; the session path is byte-for-byte today's behaviour.
4. `src/api/generated/` is generated — never hand-edited (frontend repo).
5. Feature-specific: a request carrying `?accessId=` **never** falls back to a session, even
   a valid one. Either-or is load-bearing (guard D5/D6).
6. Feature-specific: `accessId` is a query parameter on every token-enabled route, and the
   security scheme is declared but never marked required.
7. Feature-specific: the introspection response is narrower than `SpecialAccess` — it omits
   the row `id`, `revokedAt`, `usedAt` and `createdAt`, so an anonymous caller cannot learn
   the grant's internal identifier.
8. Feature-specific: no new secret, credential or database URL enters the repository. The
   production migration is an operator action.

## Out of scope

- **Frontend changes.** All seven items are `covera`-side and land in that repo's own plan:
  regenerate the client, drop the `as never` casts, move `incident/:incidentId/proofs` and
  `inspection-guide/:apartmentId/:reservationId` into the host route table with an
  access-aware guard, enable `IncidentProofsPage` guest mode, offer guest submit, and build
  `ReservationLinksSection`'s list. This plan writes the contract they consume (Phase 5).
- Removing or restricting the `damage_evidence` scope on the public create. It is not inert
  (see `decisions.md` D12) — `POST /special-access` mints the same credential `/field/ingest`
  already consumes. Leaving it offered is the recommendation; it is not a code change either way.
- `src/docs/backend-blockers*.md` are left as written. Phase 5 records the three corrections in
  the index instead, so the record of what was believed stays intact.
- Any change to `GET /field/ingest/*`, `POST /inspections/*/flags`, or `/apartments` reads.
- Email delivery of any link. The host copies the URL and sends it themselves.

## Open questions

None. Every choice is closed in [`special-access-links.decisions.md`](./special-access-links.decisions.md).
