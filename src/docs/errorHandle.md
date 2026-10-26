# Error Handling Guidelines

Every non-2xx response the API produces must be a **human readable, machine stable, uniformly shaped** payload. There is exactly one response envelope, one place that builds it, and one place that decides the HTTP status.

The goal of this document is that a client (or a human reading a log) can always answer three questions:

1. **What happened?** → `error.message` (human readable, safe to display)
2. **What kind of problem is it?** → `error.code` (stable, namespaced, branchable in code)
3. **Which part of my input caused it / where did it come from?** → `error.details` (per field) and `error.meta` (origin, resource, id)

---

## 1. The single response contract

Defined once in `src/core/errors/error.schema.ts` and referenced by every error response in every contract.

```ts
{
  "success": false,
  "error": {
    "code": "ASSET_LOCKED",                    // stable, SCREAMING_SNAKE, namespaced
    "message": "Cannot delete this asset because it is part of a shot in an active reservation.",
    "details": [                               // optional, per-field, only for input errors
      { "field": "body.assetTypeId", "message": "Asset type does not exist." }
    ],
    "meta": {                                  // optional, dev-facing, stripped in production
      "origin": "VALIDATION",                  // which layer produced it
      "resource": "Asset",
      "id": "123e4567-..."
    }
  }
}
```

Rules:

| Field     | Required | Rule                                                                                                            |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `success` | always   | Literal `false`. Never omit. Never `true` on an error.                                                          |
| `code`    | always   | From the code registry (§5). No free-form strings, no raw Zod codes, no SQLSTATE.                               |
| `message` | always   | One sentence, plain English, ends with a period. **Safe to show a user.** No stack, no SQL, no column names.    |
| `details` | when input-caused | `field` is the full request path (`body.x`, `query.y`, `param.z`). One entry per problem. Empty array = omit. |
| `meta`    | optional | Developer diagnostics (`origin`, `resource`, `id`, `driver`). **Omitted entirely when `NODE_ENV=production`.**   |

**Never** return a bare `{ message }`, a raw `ZodError`, a Postgres error object, or a plain string body. This is the exact inconsistency this document exists to remove.

---

## 2. The five origins of an error

Every failure in this codebase originates in one of six layers. Each layer has exactly one sanctioned mechanism, and each maps to a small set of statuses.

| # | Origin        | Typical cause                                                | Mechanism                                                            | Status |
| - | ------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- | ------ |
| 1 | **Routing**   | Unknown path, wrong method                                   | `app.notFound()` / `app.onError` `HTTPException` branch               | 404, 405 |
| 2 | **Validation**| Body/query/param fails the Zod schema in the contract        | `defaultHook` → shared `formatValidationError()`                      | 400 |
| 3 | **Guards**    | Missing token, wrong role, not the apartment owner            | `authGuard` / `rolesGuard` / `apartmentGuard` **throw**, never `c.json` | 401, 403, 404 |
| 4 | **Domain**    | Business rules: overlaps, locks, windows, state transitions   | `db-validator.ts` assertions throwing typed exceptions                | 400, 403, 404, 409 |
| 5 | **Persistence**| DB constraint violations the domain layer could not know about | `onError` unwraps `DrizzleQueryError` → SQLSTATE map (§4.4)            | 409, 400 |
| 6 | **Unexpected**| Bugs, `undefined`, upstream 500s                             | `onError` fallback                                                    | 500 |

The important structural rule: **layers 2–5 all converge on the same `onError` renderer.** No layer formats its own JSON.

---

## 3. The one renderer

`src/core/errors/error.handler.ts` (new) exports three functions used by *production, tests, and docs alike*:

```ts
// Builds the envelope. The ONLY place that knows the wire format.
export const renderError = (params: {
  code: string;
  message: string;
  status: ContentfulStatusCode;
  details?: ErrorDetail[];
  meta?: Record<string, unknown>;
}) => { /* returns { success: false, error: {...} } */ };

// Used by OpenAPIHono's defaultHook.
export const formatValidationError = (result: { success: false; error: ZodError }) => ...

// Used by app.onError.
export const toErrorResponse = (err: unknown) => { status, body };
```

Then:

```ts
// src/index.ts
const app = new OpenAPIHono<App>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const { status, body } = formatValidationError(result);
      return c.json(body, status);
    }
  },
});

app.onError((err, c) => {
  const { status, body } = toErrorResponse(err);
  if (status >= 500) console.error("[Unhandled Error]", err);
  return c.json(body, status);
});

app.notFound((c) => {
  const { body } = renderError({ code: "ROUTE_NOT_FOUND", message: `Route ${c.req.method} ${c.req.path} does not exist.`, status: 404 });
  return c.json(body, 404);
});
```

`src/core/utils/test-factory.ts` must import these same three functions rather than defining its own mini-handler. The per-test-file `testApp.onError(...)` overrides that currently return `{ message }` must be deleted — tests assert the real envelope, or they are not testing the API.

---

## 4. Handling each origin

### 4.1 Validation (Zod / contract)

The raw Zod output (`result.error.issues`) is developer-facing. It must be **translated**, never forwarded. Translation is declarative: a small map from Zod issue code to a human template, with the original `issue.message` as fallback.

```ts
const ISSUE_TEMPLATES: Record<string, (label: string, issue: z.core.$ZodIssue) => string> = {
  invalid_type:      (l, i) => `${l} must be a ${i.expected}.`,
  invalid_format:    (l) => `${l} has an invalid format.`,
  too_small:         (l, i) => i.origin === "string"
                                ? `${l} must be at least ${i.minimum} characters long.`
                                : `${l} must be at least ${i.minimum}.`,
  too_big:           (l, i) => `${l} must be at most ${i.maximum}.`,
  invalid_value:     (l, i) => `${l} must be one of: ${i.values.join(", ")}.`,
  unrecognized_keys: (l) => `${l} contains unknown fields.`,
  custom:            (l, i) => i.message || `${l} is invalid.`,
};
```

Rules for validation errors:

- `code` is always `VALIDATION_ERROR` and `details` is always populated — this is the only place `details` is mandatory.
- `field` uses the full request path: `body.checkInDatetime`, `query.limit`, `param.id`. Strip the leading `[]` array indices only when they add no information (`items.0.name` is fine to keep).
- `message` is a summary sentence: `"The request body failed validation (2 problems)."` — the specifics live in `details`.
- **Schema-level constraints deserve schema-level messages.** Where a rule is knowable at the schema layer, attach the human message at the field so `issue.message` is already good:

```ts
// reservations.schema.ts
checkOutDatetime: z.coerce.date().openapi({ description: "ISO 8601 check-out timestamp." }),
```

then use `.refine()` / `.superRefine()` with an explicit message for cross-field rules (check-out after check-in, etc.) so the reader never sees `"Invalid input"`.

- Cross-field business rules that need the database (overlap, locks) do **not** belong here. Those are §4.3.

### 4.2 Guards and middleware

Guards are not handlers: they must **throw**, so that a single renderer owns the response.

```ts
// middleware/authGuard.ts
const token = c.req.header("Authorization")?.replace("Bearer ", "");
if (!token) throw new UnauthorizedException("Authentication is required for this endpoint.");

const { data: { user }, error } = await supabase.auth.getUser(token);
if (error || !user) throw new UnauthorizedException("Your session has expired. Please sign in again.");
c.set("authUser", user);
```

```ts
// middleware/roleGuard.ts
if (!dbUser || dbUser.status !== "confirmed" || !allowedRoles.includes(dbUser.role))
  throw new ForbiddenException(
    `This endpoint is only available to: ${allowedRoles.join(", ")}. Your role is '${dbUser?.role ?? "unknown"}'.`
  );
```

Rules:

- Guard messages must be actionable: say what is required, not just "Forbidden".
- Never leak whether a record exists to an unauthorized caller with a different status. For ownership failures always use 403 with a neutral message (`"You do not have access to this apartment."`), not 404 with an id.
- `apartmentGuard`'s resolution fallback (apartment-id *or* reservation-id in the path) belongs in the guard, and its failure mode must be the same `NotFoundException` the handler would produce — one shape, one place.

### 4.3 Domain rules (`db-validator.ts`)

This is where the codebase already earns its keep; formalize the conventions:

1. **One assertion = one rule = one code.** `assertCanModifyAsset` → `ASSET_LOCKED`. `assertNoOverlappingReservation` → `RESERVATION_OVERLAP`.
2. **Assertions are pure `throw`ers.** They never return a boolean for the caller to interpret; the caller must not be able to forget to check.
3. **Order of checks is part of the contract** and must be deterministic: *existence → ownership → state → uniqueness*. The first violation wins, so the same input always produces the same error. Document the order in a comment at the top of each assertion.
4. **Messages state the rule, the offending value, and the remedy:**

```ts
throw new ConflictException({
  code: "RESERVATION_OVERLAP",
  message: `This apartment already has a reservation overlapping ${formatRange(newStart, newEnd)}. Choose dates outside that range or cancel the existing reservation.`,
  meta: { origin: "DOMAIN", resource: "Reservation", apartmentId },
});
```

5. **Existence assertions name the entity and the id**, and never echo the id into the user-facing string when the id is attacker-controlled garbage — put it in `meta.id` instead and keep `message` readable.

### 4.4 Persistence (Postgres via Drizzle)

Drizzle wraps driver errors in `DrizzleQueryError`; the real `PostgresError` (with `code`) is on `err.cause`. Only constraint classes the domain layer could not reasonably know about are handled here. Everything else falls through to 500.

```ts
// src/core/errors/error.mapper.ts
const SQLSTATE: Record<string, { status: ContentfulStatusCode; code: string; message: (t?: string) => string }> = {
  "23505": { status: 409, code: "DUPLICATE_RECORD",  message: () => "A record with these values already exists." },
  "23503": { status: 409, code: "RELATED_RECORD_INVALID", message: () => "A referenced record does not exist or is still in use." },
  "23502": { status: 400, code: "MISSING_REQUIRED_FIELD", message: () => "A required field was missing from the request." },
  "23514": { status: 400, code: "CONSTRAINT_VIOLATION",  message: () => "The submitted values violate a data rule." },
  "22P02": { status: 400, code: "INVALID_IDENTIFIER",    message: () => "One of the identifiers in the request is not a valid value." },
  "22007":
  "22008": { status: 400, code: "INVALID_DATETIME",      message: () => "One of the dates in the request is not a valid date." },
};
```

Two hard rules:

- **The database's own text never reaches the client.** `duplicate key value violates unique constraint "assets_pkey"` leaks schema. It goes into `meta.driver` (non-production only); the client gets the mapped sentence.
- **Constraint names can be mapped to better messages.** Optional but recommended — a flat registry keyed by constraint name overrides the SQLSTATE default:

```ts
const CONSTRAINT_MESSAGES: Record<string, { code: string; message: string }> = {
  assets_asset_type_id_asset_types_id_fk: {
    code: "ASSET_TYPE_INVALID",
    message: "The asset type you selected does not exist. Choose one from GET /assets/types.",
  },
};
```

**Transactions:** any multi-step write runs in `db.transaction()`. Domain assertions that run inside the transaction throw normally, which rolls it back — do not catch and convert them inside the callback, or partial writes survive a rejected request.

### 4.5 Unexpected errors

```ts
// toErrorResponse fallback
console.error("[Unhandled Error]", { message: err.message, stack: err.stack });
return renderError({
  code: "INTERNAL_SERVER_ERROR",
  message: "Something went wrong on our end. Please try again; if it keeps happening, contact support.",
  status: 500,
  meta: { origin: "UNEXPECTED", driver: err.message },
});
```

Rules:

- 500 messages are **always generic**. No message, class name, or table name from the underlying error reaches the client in production.
- Every 500 must be logged with the stack. A 500 that produces no log line is a bug in the error handling.
- `new Error("ASSET_TYPE_ID_REQUIRED")` (see `assets.service.ts:39`) is **not** an acceptable error. If a condition is reachable by a client, it is a domain exception with a code and a human message. If it is not reachable, it is an assertion failure and should say so.

---

## 5. Exception taxonomy and code registry

One base class, one constructor shape, one optional-options object.

```ts
// src/core/errors/error.exceptions.ts
export interface AppErrorOptions {
  code: string;                          // registry code, e.g. "ASSET_LOCKED"
  message: string;                       // final, human readable, safe to display
  details?: ErrorDetail[];
  meta?: Record<string, unknown>;        // { origin, resource, id, ... }
}

export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly details?: ErrorDetail[];
  readonly meta?: Record<string, unknown>;
  constructor(status: ContentfulStatusCode, opts: AppErrorOptions) { /* ... */ }
}

export class BadRequestException extends AppError { constructor(o: AppErrorOptions) { super(400, o); } }
export class UnauthorizedException extends AppError { constructor(o: AppErrorOptions) { super(401, o); } }
export class ForbiddenException extends AppError { constructor(o: AppErrorOptions) { super(403, o); } }
export class NotFoundException extends AppError { constructor(o: AppErrorOptions) { super(404, o); } }
export class ConflictException extends AppError { constructor(o: AppErrorOptions) { super(409, o); } }
```

> The existing single-string constructors (`new NotFoundException("Reservation")`) are the root cause of the current `"Conflict: This The apartment is already booked… already exists or conflicts with existing data."` double-wrapping. The options object removes the class of bug entirely: **the message a caller passes is the message the client sees, verbatim.** Keep `CustomException` as a deprecated alias during migration if needed.

**Code registry.** Codes are namespaced `MODULE_REASON`, stable across refactors, and narrow enough to branch on. Never a status name (`NOT_FOUND`) and never free-form.

| Status | Codes                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`, `INVALID_DATETIME`, `INVALID_IDENTIFIER`, `MISSING_REQUIRED_FIELD`, `CONSTRAINT_VIOLATION`, `RESERVATION_NOT_COVERED`, `RESERVATION_WINDOW_EXPIRED`, `INSPECTION_WINDOW_EXPIRED`, `INSPECTION_NO_PHOTO_PROOF` |
| 401    | `AUTH_TOKEN_MISSING`, `AUTH_TOKEN_INVALID`, `AUTH_SESSION_EXPIRED`                                                                           |
| 403    | `FORBIDDEN_ROLE`, `FORBIDDEN_APARTMENT_ACCESS`                                                                                              |
| 404    | `ROUTE_NOT_FOUND`, `APARTMENT_NOT_FOUND`, `RESERVATION_NOT_FOUND`, `INSPECTION_NOT_FOUND`, `ASSET_NOT_FOUND`, `ASSET_TYPE_NOT_FOUND`, `LOCATION_NOT_FOUND`, `USER_NOT_FOUND`, `FLAG_NOT_FOUND` |
| 409    | `RESERVATION_OVERLAP`, `INSPECTION_ALREADY_EXISTS`, `FLAG_ALREADY_EXISTS`, `ASSET_LOCKED`, `APARTMENT_SHOTS_LOCKED`, `DUPLICATE_RECORD`, `RELATED_RECORD_INVALID` |
| 500    | `INTERNAL_SERVER_ERROR`                                                                                                                     |

New codes require a row in this table and a contract entry (§6).

---

## 6. Wiring errors into the contract

The OpenAPI document is part of the API surface: **if a route can return a code, it must declare it.** Today `getStandardResponses(resource)` returns `400/401/404/409/500` while the guards return `403` and `apartmentGuard` returns 403 — so Swagger under-documents every apartment-scoped route.

Declaring errors must be one line per route and derive from the same registry the handler throws from.

```ts
// src/core/errors/error.helpers.ts
export const commonErrors = {
  validation: createErrorResponse("VALIDATION_ERROR", "Request failed validation."),
  notFound:    (resource: string) => createErrorResponse(`${resource.toUpperCase()}_NOT_FOUND`, `${resource} does not exist.`),
  conflict:    (code: string, description: string) => createErrorResponse(code, description),
  forbidden:   createErrorResponse("FORBIDDEN_ROLE", "Insufficient role."),
  // ...
};

// Bundle per route shape:
export const authedResponses  = { 401: ..., 500: ... };
export const roleResponses    = { 403: ... };
export const apartmentResponses = { 403: ..., 404: ... };
export const crudResponses    = (resource: string) => ({ 400, 404, 409, ... });
```

```ts
// assets.contract.ts — the shape every contract should have
const assetErrors = {
  ...authedResponses,                 // 401, 500
  ...roleResponses,                   // 403
  ...crudResponses("Asset"),          // 400, 404 (ASSET_NOT_FOUND), 409
  400: commonErrors.conflict("ASSET_TYPE_INVALID", "Asset type does not exist."),
  409: commonErrors.conflict("ASSET_LOCKED", "Asset is locked by an active reservation."),
};

export const deleteAssetRoute = createRoute({
  /* ... */
  responses: { 200: { /* ... */ }, ...assetErrors },
});
```

Every declared error response uses `StandardErrorSchema` via `createErrorResponse`, so the generated docs show one consistent shape with the real `code` as the example.

---

## 7. Declarative per-module error definitions (recommended pattern)

Hand-writing `code` + `message` + `status` + contract entry in four places is exactly the repetition that makes them drift. Define each module's errors **once**, and derive both the throwers and the contract entries from it.

```ts
// src/core/errors/error.define.ts
type ErrorSpec = {
  status: ContentfulStatusCode;
  code: string;
  message: string | ((ctx: Record<string, unknown>) => string);
  description: string;    // for OpenAPI docs
};

export function defineErrors<T extends Record<string, ErrorSpec>>(specs: T) {
  const responses = Object.fromEntries(
    Object.values(specs).map((s) => [s.status, createErrorResponse(s.code, s.description)]),
  );

  const throwers = Object.fromEntries(
    Object.entries(specs).map(([key, s]) => [
      key,
      (ctx: Record<string, unknown> = {}) => {
        const message = typeof s.message === "function" ? s.message(ctx) : s.message;
        return exceptionForStatus(s.status, { code: s.code, message, meta: { ...ctx } });
      },
    ]),
  );

  return { responses, ...throwers } as { responses: ResponsesMap } & {
    [K in keyof T]: (ctx?: Record<string, unknown>) => AppError;
  };
}
```

```ts
// src/modules/assets/assets.errors.ts
export const assetErrors = defineErrors({
  typeInvalid: {
    status: 400,
    code: "ASSET_TYPE_INVALID",
    description: "The referenced asset type does not exist.",
    message: "The asset type you selected does not exist.",
  },
  locked: {
    status: 409,
    code: "ASSET_LOCKED",
    description: "Asset is locked by an active reservation.",
    message: (ctx) =>
      `Cannot ${ctx.action} this asset because it is part of a shot in an active reservation. ` +
      `Wait until that reservation is closed, or remove the asset from the shot first.`,
  },
});
```

Usage — the same object feeds the docs and the handler, so they cannot disagree:

```ts
// assets.contract.ts
responses: { 200: { /* ... */ }, ...assetErrors.responses }

// db-validator.ts
throw assetErrors.locked({ action: "delete", assetId });

// assets.route.ts
if (!result) throw assetErrors.locked({ action: "delete", id });
```

The throwers give you declaration-merged typings for free: `assetErrors.locked` autocompletes and `assetErrors.typo` is a compile error.

---

## 8. Message writing rules

The message is the whole point of this exercise. Treat it as product copy.

| Do                                                                   | Don't                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `"Check-out must be after check-in."`                                | `"Invalid input"`, `"Validation failed"`, `"expected date"`  |
| `"Reservation 'a1b2…' was not found."`                               | `"Not Found: The requested Reservation with ID a1b2 was not found."` |
| `"This apartment already has a reservation overlapping 12–15 Oct. Choose different dates."` | `"Conflict: This The apartment is already booked… already exists."` |
| State the rule **and** the next step when a step exists.              | Blame the user (`"You sent bad data"`).                       |
| Plain, complete sentences, one idea each.                            | Stack traces, SQL, table/column names, internal codes in prose. |
| Name the resource in the client's vocabulary ("apartment", "asset"). | Name internals (`"row violates FK on assets.asset_type_id"`).  |

- Do not prefix messages with the status class (`"Not Found: "`, `"Conflict: "`). The status is already in the envelope; a prefix duplicates it and invites the double-wrap bug.
- Interpolate only values the caller supplied, and always in a readable form (a formatted date range, not two raw ISO strings).
- Ids, apartment ids, and internal statuses go in `meta` by default; include them in `message` only when the user needs them to act.

---

## 9. Testing rules

Error handling is only consistent if it is asserted.

1. Every code in the registry has at least one test asserting `status`, `error.code`, and that `error.message` matches a human-readable pattern (`expect(body.error.message).not.toMatch(/Error:/)`).
2. Tests use the **shared** `renderError` / `toErrorResponse` from `error.handler.ts` — see §3. A test-local `onError` that returns `{ message }` validates a contract the production app does not have.
3. One test per module asserts the envelope shape for a validation failure (`details[].field` present and fully qualified), because that is the most commonly regressed path.
4. Assert `details` for at least one request per module that has more than one field.

---

## 10. Definition of done for a new endpoint

- [ ] Request schemas carry `.openapi({ description })` on every field a client supplies.
- [ ] Cross-field input rules use `.refine()`/`.superRefine()` with an explicit human message.
- [ ] Each business rule that can reject the request is a named assertion in `db-validator.ts` with its own registry code.
- [ ] Errors are declared in the module's `*.errors.ts` via `defineErrors` and spread into the contract's `responses`.
- [ ] The contract declares every status the middleware chain can produce (401, 403, 404, 409, 500 as applicable).
- [ ] Handlers `throw` typed exceptions; no `return c.json({ message })` anywhere outside `error.handler.ts`.
- [ ] No raw Postgres/Drizzle/Zod object is ever returned or interpolated into a message.
- [ ] At least one test asserts the full error envelope for the module's most likely failure.

---

## 11. Current gaps to migrate (tracking)

| Location                                             | Problem                                                                                     | Target                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `error.exceptions.ts`                                | Auto-wrapping `"Not Found: The requested ${resource}"` / `"Conflict: This ${resource} already exists"` mangles already-complete messages | Options-object constructor (§5)                              |
| `db-validator.ts:48,70,74,119,159,185,190,197,204,221,259,263,279,330,366` | Passes full sentences into `ConflictException`/`NotFoundException`'s `resource` slot     | Module `*.errors.ts` throwers (§7)                           |
| `index.ts:18`                                        | `defaultHook` hand-builds the envelope; no translation of Zod issue text                   | `formatValidationError()` (§4.1)                             |
| `index.ts:40`                                        | No `DrizzleQueryError`/SQLSTATE branch; no `app.notFound()`                                 | `toErrorResponse()` + `notFound` handler (§3, §4.4)          |
| `authGuard.ts:9,16`, `roleGuard.ts:14,24`, `apartmentGuard.ts:13,19,31,49,55` | `return c.json({ message })` — bypasses the renderer, wrong shape, no `code`     | Throw typed exceptions (§4.2)                                |
| `assets.service.ts:39`                               | `throw new Error("ASSET_TYPE_ID_REQUIRED")` → opaque 500                                    | Domain exception with a code, or an assertion failure         |
| `error.helpers.ts:21`                                | `getStandardResponses` omits 403; `resource` interpolated into descriptions                 | Status bundles + registry-driven responses (§6)              |
| `test-factory.ts:26,34`                              | Test-only envelope (`{ message: "Validation Error" }`) diverges from production             | Import shared renderer (§3)                                  |
| `assets.test.ts:89`, `apartment_shots.test.ts:122`   | Local `onError` overrides with a different shape                                            | Delete; use `createTestApp` + real renderer                   |
| `error.schema.ts`                                    | No `meta` field; `details` requires `field`/`message` but response others never populate it | Add `meta`, document when `details` applies (§1)              |
