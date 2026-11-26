# Access links — per-item technical detail

**Companion to [`backend-blockers-prep.md`](./backend-blockers-prep.md).** That file says what to do
and in what order; this one says exactly how, for an executor. Paths are relative to `covera-hono`.
Verified against the codebase on 2026-11-26.

Baseline on this branch (`feature/53_special-access-fixes`, HEAD `ea0b125`):
`npm run gate` green — typecheck, lint, **783 tests**, contracts (49 routes). The guard's own suite
is `src/middleware/specialAccessGuard.test.ts`, **14 tests, all passing**.

---

## B0 — restore the schema in production

### The differential, as run

```bash
BASE=https://covera-api.josutic-sutic.workers.dev

# Healthy — no special_access read:
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/inspections/770e8400-…"        # 404 INSPECTION_NOT_FOUND
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/users"                          # 401 AUTH_TOKEN_MISSING
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/reservations/$RES?accessId="    # 401 (falsy → session path)

# Broken — reads special_access:
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/reservations/$RES?accessId=deadbeef"  # 500
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/field/ingest/bogustoken"              # 500  ← the tell
```

`/field/ingest` is unauthenticated, has no `accessId`, and reads `special_access` in
`incidentsService.getFieldContext` (`eq(specialAccess.accessId, token)`). It 500s identically. That
is what rules out an `accessId`-handling bug and points at the table.

### Confirm, then fix

```bash
# 1. Confirm against the worker's own database.
psql "$DATABASE_URL" -c "select to_regclass('public.special_access'), to_regtype('public.access_scope');"

# 2. Apply. Migrations are 0015 (table) and 0016 (backfill of live cleaner tokens).
npm run db:migrate

# 3. Re-probe the headline case.
curl -s -w "\n%{http_code}\n" "$BASE/reservations/$RES?accessId=deadbeef"
#   403 SPECIAL_ACCESS_INVALID → B3 closed, no code change needed.
#   500 still                 → B3 is a real code bug; see below.
```

**The failure mode to rule out first:** the worker's `DATABASE_URL` secret and the `DATABASE_URL` you
migrate with may be *different databases*. `deploy.yml` injects the secret into `wrangler deploy`;
`drizzle.config.ts` reads `process.env.DATABASE_URL` from the local `.env`. If they diverge, a
successful local migration changes nothing in production. Compare hosts (redacted) before concluding.

### Durable fix — `.github/workflows/deploy.yml`

Today the deploy job runs `npm ci` → `npm run test` → `npx wrangler deploy`. No migration. Add a
migrate step **before** deploy, using the same `DATABASE_URL` secret:

```yaml
      - name: Migrate database
        run: npx drizzle-kit migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

This is the item that stops the *next* migration from producing the same outage.

---

## B1 — the parameter and the scheme

### Today (live document, `2026-11-26`)

- `components` = `{ schemas, parameters }` — **no `securitySchemes` key at all**.
- `accessId` occurs 6 times: 1 path param (`DELETE /special-access/{accessId}`) and 5 schema
  references. **Zero query params.**

### The scheme — verified to work in this stack

`app.openAPIRegistry.registerComponent("securitySchemes", name, component)` is the API
(`@asteasolutions/zod-to-openapi`), and this exact call was run against the repo's own dependency
versions:

```ts
app.openAPIRegistry.registerComponent("securitySchemes", "specialAccess", {
  type: "apiKey",
  in: "query",
  name: "accessId",
});
// produced: components.securitySchemes.specialAccess = { type: "apiKey", in: "query", name: "accessId" }
```

Place it in `src/index.ts` next to `app.doc("/openapi.json", …)`.

**Do not add a route-level `security: [{ specialAccess: [] }]`.** In OpenAPI that array means
"required"; every guarded route must remain usable by a bearer session, so marking the scheme
required would document the opposite of the truth. The scheme is a declaration for the generator;
the guard's either-or semantics (session **or** token) cannot be expressed in OpenAPI 3.0 anyway —
say so in the scheme's `description` instead.

### The parameter

Add an optional `accessId` query param to the **six** guarded routes:

| Route | Contract file |
| --- | --- |
| `GET /reservations/{id}` | `reservations.contract.ts` |
| `GET /reservations/{id}/photos` | `reservations.contract.ts` |
| `GET /apartments/{id}` | `apartments.contract.ts` |
| `GET /apartment-shots/apartment/{apartmentId}` | `apartment_shots.contract.ts` |
| `GET /inspections/reservation/{reservationId}` | `inspections.contract.ts` |
| `POST /inspections` | `inspections.contract.ts` |

Note two of these already carry a `request.query` (`apartment_shots` uses `GetShotsQuerySchema`;
`/inspections/{id}` uses `GetInspectionQuerySchema` — but that is a *different* route, not guarded).
Add `accessId` to the existing query object rather than replacing it. A shared
`AccessIdQuerySchema` exported from `special_access.schema.ts` keeps the spelling in one place.

**Why this is the cheap win:** the frontend's `accessQuery = (accessId) => ({ accessId }) as never`
(`covera/src/lib/api/specialAccess.ts`) exists only because the generated type says `query?: never`.
Declaring the param deletes the cast and the silent-rename risk it hides.

---

## B2 — the two reservation reads

`src/modules/reservations/reservations.contract.ts` defines one bundle used by both reads:

```ts
const getReservationByIdErrors = errorResponses([
  ...AUTHED, ...ROLE, ...VALIDATION,
  "RESERVATION_NOT_FOUND", "APARTMENT_NOT_FOUND", "FORBIDDEN_APARTMENT_ACCESS",
]);
```

Add `"SPECIAL_ACCESS_INVALID"` and `"SPECIAL_ACCESS_SCOPE_MISMATCH"`. Both routes already mount
`specialAccessGuard`, so both can produce them; the bundle is shared, so this is a two-line edit that
fixes `GET /reservations/{id}` and `GET /reservations/{id}/photos` together. Match the wording the
apartment route already produces (it comes from `ERROR_REGISTRY`, so it will).

**Why `check-contracts.ts` did not catch this:** it requires a 403 only for guards it finds by name —
`["authGuard", "rolesGuard", "apartmentGuard"]` (`scripts/check-contracts.ts`). `specialAccessGuard`
is absent from that list, so a guarded route with no 403 passes. Two options, pick one:

- **(recommended)** leave the checker alone and treat this as a one-off contract fix; or
- extend the checker's guard list to include `specialAccessGuard` **and** accept either 403 code —
  note it would then also require 403 on routes that legitimately have it already, which is a
  stricter gate on all 49 routes. Only do this if you want the gate to enforce it going forward.

---

## B3 — the 500, if B0 does not close it

Only if the post-B0 probe still 500s. Then the code-level checklist, in order:

1. **`specialAccessService.resolveByToken`** (`src/modules/special_access/special_access.service.ts`)
   — confirm the query is well-formed and `expiresAt` parsing cannot throw on a real row.
2. **`specialAccessGuard`** (`src/middleware/specialAccessGuard.ts`) — the `!grant` branch already
   throws `specialAccessErrors.invalid({})` → 403. Confirm nothing between the query and that throw
   can raise.
3. **`error.mapper.ts`** — a Postgres error carrying a 5-char SQLSTATE is mapped; an *undefined table*
   is SQLSTATE `42P01`, which is **not** in `SQLSTATE_MAP`, so it falls through to the generic 500.
   That is consistent with the table-missing theory and is why the 500 has no useful body.
4. **Check `meta` in a non-production run** — `renderError` includes `meta.driver` outside
   production, which would name the real cause. If you can run the API locally against the production
   database, `curl` once and read `error.meta.driver`.

The guard's own tests (`src/middleware/specialAccessGuard.test.ts`) already pin 403 for unknown,
expired, scope-mismatched, wrong-target, and ownerless grants — so if B3 persists, the bug is not in
the guard's decision logic and the tests should stay green while you hunt.

---

## B4 — a new bind kind for incident-scoped access

### What is missing

`GET /incidents/{id}` and `GET /assets/apartment/{apartmentId}` mount
`[authGuard, rolesGuard(["admin","host"])]` and accept no `accessId`
(`incidents.contract.ts`, `assets.contract.ts`). The proofs page cannot read a claim as a guest.

### The mechanism

`AccessBind` in `specialAccessGuard.ts` has three kinds — `reservationParam`, `apartmentParam`,
`reservationBody`. An incident id is none of them. Add a fourth:

```ts
| { kind: "incidentParam"; param: string }
```

and resolve it in `targetMatches`: the grant already carries `reservationId` (the `damage_evidence`
grants minted by `insertFieldGrant` pass both `reservationId` and `incidentItemId`), so the check is
"the incident named by this param belongs to the grant's reservation". That is one extra lookup —
`incidents.reservationId` by `incidents.id` — the same join `resolveSubjectApartment` already does
for the incident-item branch.

**Why not just bind by apartment:** the grant's `apartmentId` would match, but the handler asserts
apartment ownership, not incident identity — so an apartment-wide bind would let a link scoped to one
reservation open a claim for a *different* stay in the same apartment. The reservation narrowing is
the whole point of `targetMatches` and must be preserved.

### Scope

These routes are `inspection_proof` links (the photographer/cleaner case). The `damage_evidence`
scope is already served by `/field/ingest` (see B6) — do **not** add it here.

### Contract consequences

Both routes gain `SPECIAL_ACCESS_INVALID` / `SPECIAL_ACCESS_SCOPE_MISMATCH` in their bundles, and
`accessId` in their query. `/assets/apartment/{apartmentId}` is apartment-scoped, so it can reuse the
existing `apartmentParam` bind — it only needs the param declared and the error codes added; the
*incident* read is the one that needs the new bind kind.

---

## B5 — the submit decision

Three routes reject access today:

| Route | Contract | Handler |
| --- | --- | --- |
| `POST /apartments/{id}/photos/upload-tokens` | `apartments.contract.ts` | `apartments.route.ts` |
| `POST /apartments/{id}/photos/confirm` | `apartments.contract.ts` | `apartments.route.ts` |
| `PATCH /reservations/{id}` | `reservations.contract.ts` | `reservations.route.ts` |

The first two already mount `apartmentGuard(false)`, which resolves the apartment and asserts
ownership — the same shape `specialAccessGuard` reproduces by impersonating the owner. Swapping
`[authGuard, rolesGuard, apartmentGuard(false)]` for `specialAccessGuard({ scope: "inspection_proof",
bind: { kind: "apartmentParam", param: "id" }, roles: ["admin","host"] })` is the mechanical change;
the guard then sets `user` to the owner and the existing handler code works unchanged.

**But decide first.** If guest submission is **wanted**, do the swap and add the two `SPECIAL_ACCESS_*`
codes to each bundle. If it is **not** wanted, the correct action is to say so in the contract
description (or the docs) and change no code — the frontend's read-only guest guide is then permanent
by design. Both are defensible; the failure mode is leaving it undecided, which is what the blockers
doc flags as the ambiguity.

**`PATCH /reservations/{id}` deserves separate scrutiny.** Letting a link-holder patch a reservation
is a wider capability than submitting photos (it can move dates, which can collide with other stays
via `assertNoOverlappingReservation`). Recommend **not** extending access to it in the same phase as
the photo path, if at all.

---

## B6 — correction and recommendation

### What the blockers doc says vs what the code does

> B6: "`damage_evidence` is in the scope enum but opens nothing."

Not so. `damage_evidence` is the credential of the field-intake surface:

- **Minted** by `insertFieldGrant` (`incidents.service.ts`) with `scope: "damage_evidence"`, the same
  token string as `incident_items.cleaner_token`.
- **Consumed** by `incidentsService.getFieldContext`, which queries
  `eq(specialAccess.accessId, token) AND eq(specialAccess.scope, "damage_evidence") AND revokedAt IS
  NULL AND usedAt IS NULL` at the unauthenticated `/field/ingest/{token}` routes.
- **Backfilled** by migration `0016_backfill_field_grants.sql`, which copies every live cleaner token
  into `special_access` as a `damage_evidence` grant.

So a `damage_evidence` link *is* usable — at `/field/ingest/{accessId}` (a **path** credential), not
at any `/incidents` endpoint (query param). The doc's "no endpoint accepts it" is true only of the
`/incidents` family.

**And a publicly-minted one works too.** `POST /special-access` with `scope: "damage_evidence"` +
`incidentItemId` stores a grant keyed by that item (`resolveSubjectApartment`'s incident branch, then
`specialAccessService.create`). `getFieldContext` resolves the field link by
`eq(specialAccess.accessId, token) AND eq(specialAccess.scope, "damage_evidence") AND
eq(specialAccess.incidentItemId, …)` — it reads `special_access`, and joins `incident_items` on
`specialAccess.incidentItemId`, **not** on `cleaner_token`. So a host-minted `damage_evidence` grant
opens the field-intake page for that item for real. The two mechanisms (item token and public grant)
share the `special_access` row shape and both resolve; there is no "dead link" here.

### The open question

The doc's premise is therefore wrong, but its *conclusion* — "leaving it accepted-but-inert is the
one option that guarantees a minted link that does nothing" — never applied. The remaining question is
only whether the public create should expose this scope, since the field-intake surface was designed
around the host relaying an item token, and a second way to mint the same credential widens that
surface. Decide it deliberately:

- **(recommended)** leave it offered — it works, it is host-authorized against the item's apartment,
  and it is the natural way to re-issue a link without touching the claim. Note the equivalence to
  the item token in the contract comment so the next reader does not treat it as inert.
- **(alternative)** restrict the public create to `inspection_proof` and keep `damage_evidence`
  internal to `insertFieldGrant`. Smaller surface; costs a host the ability to re-mint a field link.

Either way, **do not remove the enum member** — `0016` and `insertFieldGrant` depend on it.

---

## B7 — introspection

### Shape

```ts
export const getSpecialAccessRoute = createRoute({
  method: "get",
  path: "/{accessId}",
  tags: ["Special access"],
  // anonymous (recommended) — the accessId is the credential
  middleware: [] as const,
  request: { params: AccessIdParamSchema },
  responses: {
    200: { description: "The grant behind this link", content: { "application/json": { schema: SpecialAccessSchema } } },
    ...errorResponses([...VALIDATION, "SPECIAL_ACCESS_INVALID", "INTERNAL_SERVER_ERROR"]),
  },
});
```

**Reuse `AccessIdParamSchema`** — it already declares `{ param: { name: "accessId", in: "path" } }`.
Note this is the same path as the existing `DELETE /{accessId}`; they differ by method, which Hono
handles, but check `special_access.route.ts`'s route ordering comment applies.

### Resolution

Use `specialAccessService.resolveByToken` (the *redemption* lookup: revoked and expired both → null,
collapsing to `SPECIAL_ACCESS_INVALID`) — **not** `findByToken`, which is the management lookup and
returns revoked grants. Then `throw specialAccessErrors.invalid({})` on null.

### The leak question — decide it

If anonymous, the response must not exceed what the link already grants. `SpecialAccessSchema`
includes `id` (row id), `accessId`, and `createdAt`; the `accessId` is already the caller's
credential, so echoing it is not a leak, but `id` is an internal identifier with no use to the
caller. Recommend a **narrower response schema** for this route — `scope`, `apartmentId`,
`reservationId`, `incidentItemId`, `expiresAt` — rather than reusing `SpecialAccessSchema` wholesale.

---

## B8 — listing grants

### Shape

```ts
export const listSpecialAccessRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Special access"],
  middleware: [authGuard, rolesGuard(["admin", "host"])] as const,
  request: { query: ListSpecialAccessQuerySchema },   // { reservationId?: uuid, apartmentId?: uuid }
  responses: {
    200: { description: "Access links for a subject", content: { "application/json": { schema: SpecialAccessListSchema } } },
    ...errorResponses([...AUTHED, ...ROLE, ...APARTMENT_SCOPED, ...VALIDATION]),
  },
});
```

Ownership is asserted in the handler against the resolved apartment, exactly as
`createSpecialAccessRoute` and `revokeSpecialAccessRoute` already do via `assertApartmentOwnership` —
copy that pattern rather than inventing one.

### The decision that must be made

**The list must include `accessId`** or the frontend cannot rebuild the shareable URL, which is the
whole point of the list (a host reloads and wants the link back). That deliberately relaxes the
existing rule "the response carries `accessId` — the only payload that does" (the comment in
`special_access.contract.ts`). It is a safe relaxation *only* because the route is host-authorized
against the grant's own apartment. State that reasoning in the contract comment so the next reader
does not "fix" it back.

Also decide whether the list returns revoked grants. Recommend **yes**, with `revokedAt` populated —
the host needs to see that a link is dead, not have it silently vanish.

---

## B9 — the per-scope rule

Live: `CreateSpecialAccess.required = ["scope"]`. The rule *is* enforced — `CreateSpecialAccessSchema`
has a `superRefine` (`special_access.schema.ts`) that requires `reservationId` for `inspection_proof`,
`incidentItemId` for `damage_evidence`, and rejects both together. `superRefine` produces a Zod
refinement, which **cannot be expressed in JSON Schema**, so the generated document shows only
`required: ["scope"]`.

**Cheapest fix:** add the rule to the schema's `.openapi({ description })` as prose. The runtime
already returns `400 VALIDATION_ERROR`; this just makes the contract tell the truth.

**Only if the generated client must enforce it client-side:** rework to `z.discriminatedUnion("scope",
[…])`. That changes the generated type shape and the frontend's `CreateSpecialAccess` usage — a
bigger, more coupled change. Recommend the description-only fix unless there is a concrete need.

---

## Verification

### Static, per change

```bash
npm run gate            # typecheck + lint + 783 tests + contracts
npm run gate:openapi    # also builds the document (38 paths today)
```

`npm run gate` is the acceptance criterion for every code change in this work. `check-contracts.ts`
(49 routes) will fail the build if a route mounts `authGuard` without a 401, or a role/apartment
guard without a 403.

### The probe table — the acceptance gate for the whole feature

Run against the deployed API after each phase. Baseline is the §1 table; the target is:

| Probe | Target |
| --- | --- |
| `GET /reservations/{id}?accessId=deadbeef` | `403 SPECIAL_ACCESS_INVALID` (was 500) |
| `GET /reservations/{id}?foo=bar` | `401 AUTH_TOKEN_MISSING` (unchanged) |
| `GET /reservations/{id}?accessId=$VALID` | `200` (unchanged) |
| `GET /incidents/{id}?accessId=$VALID` | `200` for a matching link (was 401) |
| `POST /apartments/{id}/photos/upload-tokens?accessId=$VALID` | `200/201` if B5 is accepted (was 401) |
| `GET /special-access/$VALID` | `200` with the grant (was 404) |
| `GET /special-access?reservationId=…` (bearer) | `200` with the list (was 404) |
| `grep -c '"accessId"' openapi.json` | > 6, and it appears under `parameters` |
| `openapi.json` `components.securitySchemes` | present, containing `specialAccess` |
| `GET /field/ingest/bogustoken` | `404 FIELD_TOKEN_INVALID` (was 500 — B0's proof) |

**After any backend change, `covera` must re-run `npm run api:generate` then `npm run gate`.** A
change that is not regenerated is invisible to the frontend.

---

## Execution protocol (from `feature-kickoff`)

Hand this to the executor unchanged, filling in the phase range:

```
You are executing a pre-written plan, one phase at a time. Do not design, redesign, or improve it.

SOURCES
- src/docs/<feature>/00-index.md — read ONCE at the start (dependencies, invariants, halt conditions).
- src/docs/<feature>/p<N>.md — read ONLY the phase file you are about to execute.
- src/docs/<feature>.decisions.md — read ONCE. If a decision is missing, HALT; do not decide it.

PRECONDITION
- `npm run gate` must pass. If not, STOP and report.

PER STEP
1. Read the step's Touch / Do / Accept / Verify.
2. Make exactly the change in Do. Files outside Touch are off-limits.
3. Run Verify (`npm run gate` unless the step says otherwise).
4. Walk Accept bullets against real command output, not intent.

HALT AND ASK — do not guess — when the gate is red and one honest fix does not clear it; when the
plan contradicts the code in a way that changes observable behaviour; when a step needs a file
outside Touch; when a decision the plan does not cover changes observable behaviour.
```

**Note for this feature specifically:** the decisions in B5 (does a guest submit?), B7 (anonymous or
bearer-only introspection?), B8 (does the list carry `accessId`? does it include revoked grants?) and
B6 (drop `damage_evidence` from the public create?) **must be closed in the decisions document before
execution.** They change observable behaviour and the executor is instructed to halt on exactly that.
