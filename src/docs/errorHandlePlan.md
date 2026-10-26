# Error Handling Migration — Step-by-Step Execution Plan

Companion to [`errorHandle.md`](./errorHandle.md). That document defines the **target** ("the rules").
This document defines the **execution order** ("the steps"). Every step below is self-contained: say
*"execute step 2.1"* and the work is fully specified — files to touch, exact code, acceptance criteria,
and the command that proves it.

---

## 0. How to use this document

### 0.0 Terminology note

`errorHandle.md` §2 is titled *"The five origins of an error"* but its table lists **six** rows
(Routing, Validation, Guards, Domain, Persistence, Unexpected). The heading is a typo in the source
document; the table is authoritative and this plan follows it. Fix the heading when convenient —
this plan does not depend on it.

### 0.1 Step contract

Every step has the same five fields:

| Field | Meaning |
| --- | --- |
| **Goal** | One sentence: what is true after this step that was not before. |
| **Touch** | Exact files created/modified. |
| **Do** | The precise change, with code. |
| **Accept** | Observable, checkable conditions. |
| **Verify** | The command(s) to run. |

A step is **done** only when `npm run test` passes **and** `npx tsc --noEmit` is clean **and** every
Accept bullet is demonstrably true. Do not batch steps; land each one green so a failure is always
attributable to the step that caused it.

> **Amended by §0.5.** In batch-verify mode the operator owns `npm run test` and the commit;
> the executor runs only a silent per-step typecheck. Where this paragraph and §0.5 disagree,
> §0.5 governs.

### 0.2 Baseline (verified 2026-10-24, before any step)

```
branch:  feature/43_assets-name-table
tsc:     clean (exit 0)
tests:   7 files, 63 tests, all passing
```

> **Updated after phase 1:** 9 files, 83 tests (step 1.7 added two suites). Treat the count as a
> floor — compare against `≥ 83` rather than an exact number for the rest of the migration.

Re-confirm before starting any step:

```bash
npx tsc --noEmit && npm run test
```

If the baseline is not green, **stop** — fix that first. Every step below assumes a green start.

### 0.3 Global rules (apply to every step)

1. **One envelope.** `{ success: false, error: { code, message, details?, meta? } }` is built in
   exactly one place (`renderError`, step 1.4). No other file may construct that object literal.
2. **No `return c.json(...)` for errors.** Guards and middleware **throw**; handlers **throw**.
   The only `c.json` calls left in the codebase are the 2xx responses in route handlers and the
   single `c.json` inside `app.onError`/`app.notFound`.
3. **No free-form codes.** Every `code` comes from `ERROR_REGISTRY` (step 1.1). A new error means a
   new registry row — never a string literal at the throw site.
4. **Messages are product copy.** One sentence, plain English, ends with a period, no status prefix
   (`"Not Found: "`), no SQL, no table/column names, no raw ids. See `errorHandle.md` §8.
5. **Never leak the driver.** Postgres text goes to `meta.driver` (stripped in production) only.
6. ~~**Commit per step** on a branch off `main`; never commit to `main` directly.~~
   **Superseded by §0.5:** the operator commits once per phase, on a branch off `main`.
   The executor never commits. Never commit to `main` directly.

### 0.4 Step index

| Phase | Steps | Outcome |
| --- | --- | --- |
| **1 — Core** | 1.1 – 1.9 | The whole error subsystem exists and is unit-tested. No module touched yet. |
| **2 — Wiring** | 2.1 – 2.5 | `index.ts` + guards use the core. One envelope everywhere. |
| **3 — Contracts** | 3.1 – 3.3 | Contracts declare every code they can return, including 403. |
| **4 — Domain** | 4.1 – 4.7 | `db-validator` throws registry codes; services typed; legacy call sites burned down. |
| **5 — Modules** | 5.1 – 5.8 | Each module gets `*.errors.ts`; routes throw; tests assert the envelope; migration overloads removed. |
| **6 — Persistence** | 6.1 – 6.3 | SQLSTATE map + constraint map + a DB-error test. |
| **7 — Guardrails** | 7.1 – 7.4 | Rules enforced mechanically so they cannot regress. |

**Dependencies.** Phase 1 is a hard prerequisite for everything else. After it:
- Phase 2 (2.1 – 2.5) depends only on phase 1.
- Phase 3 (3.1 – 3.3) depends only on phase 1.
- Phase 4 (4.1 – 4.7) depends only on phase 1.
- Phase 5 (5.1 – 5.8) depends on **3.2** (for the contract bundles) and **4.7** (for the route call
  sites); the per-module work itself only needs phase 1. Step 5.8 must be **last** in phase 5.
- Phases 6 and 7 depend on everything before them.

So a legal landing order is 1 → 2 → 3 → 4 → 5 → 6 → 7, or 1 → 3 → 4 → 2 → 5 → 6 → 7. Do **not**
start phase 5 before 3.2 — otherwise the module `.errors.ts` responses have nothing to attach to.

### 0.5 Execution mode — batch-verify

Division of labour: **the executor edits; the operator verifies and commits.** This exists because
per-step `npm run test` output and per-step commit hooks (lint-staged re-runs the full suite) are
the dominant token cost of executing a phase, not the edits.

Supersedes §0.3 rule 6 and the `npm run test` half of every step's **Verify**.

- **Per step.** Make exactly the edit in **Do**. Run `npx tsc --noEmit && echo OK || echo FAIL` —
  typecheck only, output suppressed to one line. No `npm run test`. No commit.
- **Per step, report.** Accept bullets are marked `claimed` (code written as specified, not executed
  against a running system), or `✓` **only** where the step itself writes the test or command that
  asserts them. Never present a `claimed` bullet as verified evidence.
- **Per phase boundary.** Stop and hand off. The operator runs `npx tsc --noEmit && npm run test`,
  then commits the phase as one commit.
- **On red at the boundary.** The per-step report order is the bisect map. Report the failing test
  name and which step's file it implicates; do not silently re-run steps.

The per-step typecheck is retained deliberately: steps in a phase often create files (`*.errors.ts`)
that later steps in the same phase import, so an unnoticed compile error in step *n* invalidates the
work of *n+1 … end-of-phase* and costs far more than one line of output.

> Phase 4 was executed under the original per-step mode (one commit per step, full verify each step).
> That record is unamended; §0.5 applies from phase 5 onward.

---

## 1. Core — build the error subsystem

Nothing in this phase changes observable API behaviour. All 63 existing tests must still pass after
each step. This is deliberate: it means phase 1 can land without a flag day.

### Step 1.1 — Add the error code registry

**Goal.** Every error code in the system, with its status and doc description, is declared in one
typed table; using a code that is not in the table is a compile error.

**Touch.** Create `src/core/errors/error.codes.ts`.

**Do.** Create the file with exactly this content:

```ts
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * The single source of truth for every error code the API can emit.
 *
 * Rules (see docs/errorHandle.md §5):
 *  - Codes are namespaced SCREAMING_SNAKE, never a status name, never free-form.
 *  - `status` is the ONLY place a code's HTTP status is decided.
 *  - `description` is the OpenAPI description (developer-facing, no trailing period needed).
 *
 * Adding a code here is the only way to use it: `ErrorCode` is derived from this table,
 * so an unknown code at a throw site or in a contract is a compile error.
 */
export const ERROR_REGISTRY = {
  // ---- 400 -----------------------------------------------------------------
  VALIDATION_ERROR:        { status: 400, description: "The request failed validation." },
  INVALID_DATETIME:        { status: 400, description: "A date value in the request is not valid." },
  INVALID_IDENTIFIER:      { status: 400, description: "An identifier in the request is not a valid value." },
  MISSING_REQUIRED_FIELD:  { status: 400, description: "A required field was missing from the request." },
  CONSTRAINT_VIOLATION:    { status: 400, description: "The submitted values violate a data rule." },
  RESERVATION_INVALID_RANGE: { status: 400, description: "Check-out must be strictly after check-in." },
  RESERVATION_NOT_COVERED:   { status: 400, description: "The reservation is not in the COVERED state." },
  INSPECTION_NO_PHOTO_PROOF: { status: 400, description: "The reservation has no satisfied photo proof." },
  INSPECTION_WINDOW_EXPIRED: { status: 400, description: "The inspection creation window has expired." },
  FLAG_WINDOW_EXPIRED:       { status: 400, description: "The flag submission window has expired." },
  MAX_PHOTOS_EXCEEDED:       { status: 400, description: "The apartment photo limit would be exceeded." },
  ASSET_TYPE_INVALID:        { status: 400, description: "The referenced asset type does not exist." },
  AUTH_PROVIDER_ERROR:       { status: 400, description: "The authentication provider rejected the request." },
  INVITATION_ERROR:          { status: 400, description: "The invitation could not be dispatched." },

  // ---- 401 -----------------------------------------------------------------
  AUTH_TOKEN_MISSING:   { status: 401, description: "No authentication token was supplied." },
  AUTH_TOKEN_INVALID:   { status: 401, description: "The authentication token is invalid." },
  AUTH_SESSION_EXPIRED: { status: 401, description: "The session has expired and must be renewed." },

  // ---- 403 -----------------------------------------------------------------
  FORBIDDEN_ROLE:              { status: 403, description: "The caller's role cannot access this endpoint." },
  FORBIDDEN_APARTMENT_ACCESS:  { status: 403, description: "The caller does not own this apartment." },

  // ---- 404 -----------------------------------------------------------------
  ROUTE_NOT_FOUND:      { status: 404, description: "The requested route does not exist." },
  APARTMENT_NOT_FOUND:  { status: 404, description: "Apartment does not exist." },
  RESERVATION_NOT_FOUND:{ status: 404, description: "Reservation does not exist." },
  INSPECTION_NOT_FOUND: { status: 404, description: "Inspection does not exist." },
  ASSET_NOT_FOUND:      { status: 404, description: "Asset does not exist." },
  ASSET_TYPE_NOT_FOUND: { status: 404, description: "Asset type does not exist." },
  LOCATION_NOT_FOUND:   { status: 404, description: "Location does not exist." },
  USER_NOT_FOUND:       { status: 404, description: "User does not exist." },
  FLAG_NOT_FOUND:       { status: 404, description: "Flag does not exist." },

  // ---- 409 -----------------------------------------------------------------
  RESERVATION_OVERLAP:      { status: 409, description: "Reservation overlaps an existing reservation." },
  INSPECTION_ALREADY_EXISTS:{ status: 409, description: "An inspection already exists for this reservation." },
  FLAG_ALREADY_EXISTS:      { status: 409, description: "A flag already exists for this shot." },
  ASSET_LOCKED:             { status: 409, description: "Asset is locked by an active reservation." },
  APARTMENT_SHOTS_LOCKED:   { status: 409, description: "Shots are locked by an active reservation." },
  DUPLICATE_RECORD:         { status: 409, description: "A record with these values already exists." },
  RELATED_RECORD_INVALID:   { status: 409, description: "A referenced record does not exist or is still in use." },

  // ---- 500 / other ---------------------------------------------------------
  INTERNAL_SERVER_ERROR: { status: 500, description: "An unexpected error occurred." },
  METHOD_NOT_ALLOWED:    { status: 405, description: "The HTTP method is not allowed for this route." },
  HTTP_ERROR:            { status: 500, description: "The request could not be completed." },
} as const satisfies Record<string, { status: ContentfulStatusCode; description: string }>;

/** Union of every valid error code. Derived — never hand-written. */
export type ErrorCode = keyof typeof ERROR_REGISTRY;

/** Status for a code, as a literal type. */
export type StatusFor<C extends ErrorCode> = (typeof ERROR_REGISTRY)[C]["status"];
```

> **Why the three "provider" codes.** `AUTH_PROVIDER_ERROR` and `INVITATION_ERROR` replace the
> current string literals at `users.route.ts:76,97`. `MAX_PHOTOS_EXCEEDED` replaces the literal at
> `apartments.service.ts:92,125`. The registry is the destination for every code that currently
> exists as a bare string.

**Accept.**
- File exists; `ErrorCode` is a union of the keys.
- `ERROR_REGISTRY.X.status` is a numeric literal (not `number`).
- No file imports it yet; nothing else changed.

**Verify.** `npx tsc --noEmit` → exit 0.

---

### Step 1.2 — Add the wire schema

**Goal.** The response envelope has exactly one Zod definition, including `meta`, matching
`errorHandle.md` §1.

**Touch.** Rewrite `src/core/errors/error.schema.ts`.

**Do.** Replace the file's contents:

```ts
import { z } from "@hono/zod-openapi";

/** One per-field validation problem. `field` is a full request path, e.g. "body.password". */
export const ErrorDetailSchema = z
  .object({
    field: z.string().openapi({ example: "body.password" }),
    message: z.string().openapi({ example: "Password must be at least 8 characters long." }),
  })
  .openapi("ErrorDetail");

/**
 * The one and only error envelope. Every non-2xx response in every contract uses this.
 * See docs/errorHandle.md §1.
 */
export const StandardErrorSchema = z
  .object({
    success: z.literal(false),
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z
        .string()
        .openapi({ example: "The request body failed validation (2 problems)." }),
      details: z
        .array(ErrorDetailSchema)
        .optional()
        .openapi({ description: "Present only when the failure was caused by request input." }),
      meta: z
        .record(z.string(), z.unknown())
        .optional()
        .openapi({ description: "Developer diagnostics. Omitted entirely in production." }),
    }),
  })
  .openapi("StandardError");

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof StandardErrorSchema>;
```

**Accept.**
- `StandardErrorSchema` has `meta`; `ErrorDetail` is exported.
- `error.helpers.ts` still compiles (it imports `StandardErrorSchema` — unchanged name).

**Verify.** `npx tsc --noEmit` → exit 0; `npm run test` → 63 passing.

---

### Step 1.3 — Rewrite the exception taxonomy

**Goal.** Exceptions take one options object, so the message a caller passes is the message the
client sees — removing the `"Conflict: This The apartment is already booked…"` double-wrap class of
bug at the type level.

**Touch.** Rewrite `src/core/errors/error.exceptions.ts`.

**Do.** Replace the contents:

```ts
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ErrorCode } from "./error.codes";
import type { ErrorDetail } from "./error.schema";

export interface AppErrorOptions {
  /** Registry code. Not a status name, not free-form. */
  code: ErrorCode;
  /** Final, human-readable, safe to display. Rendered verbatim — never wrapped or prefixed. */
  message: string;
  /** Per-field problems. Only for input-caused failures. */
  details?: ErrorDetail[];
  /** Developer diagnostics: { origin, resource, id, ... }. Stripped in production. */
  meta?: Record<string, unknown>;
}

/** Base class for every error this application throws deliberately. */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];
  readonly meta?: Record<string, unknown>;

  constructor(status: ContentfulStatusCode, opts: AppErrorOptions) {
    super(opts.message);
    this.name = new.target.name;
    this.status = status;
    this.code = opts.code;
    this.details = opts.details;
    this.meta = opts.meta;
  }
}

export class BadRequestException extends AppError {
  constructor(opts: AppErrorOptions) { super(400, opts); }
}
export class UnauthorizedException extends AppError {
  constructor(opts: AppErrorOptions) { super(401, opts); }
}
export class ForbiddenException extends AppError {
  constructor(opts: AppErrorOptions) { super(403, opts); }
}
export class NotFoundException extends AppError {
  constructor(opts: AppErrorOptions) { super(404, opts); }
}
export class ConflictException extends AppError {
  constructor(opts: AppErrorOptions) { super(409, opts); }
}

/** Maps a status to its exception class. Used by the declarative `defineErrors` factory. */
export const exceptionForStatus = (
  status: ContentfulStatusCode,
  opts: AppErrorOptions,
): AppError => {
  switch (status) {
    case 400: return new BadRequestException(opts);
    case 401: return new UnauthorizedException(opts);
    case 403: return new ForbiddenException(opts);
    case 404: return new NotFoundException(opts);
    case 409: return new ConflictException(opts);
    default:  return new AppError(status, opts);
  }
};
```

**Consequence to expect (important).** This is a **breaking change** to every existing call site.
`new NotFoundException("Asset")` no longer compiles. That is intentional — it turns the silent
message-mangling sites into compile errors that step 4 and step 5 fix one by one.

**Measured scope (2026-10-24):** 39 exception call sites across 13 files. `db-validator.ts` alone
holds 15; the rest are 5 in `users.route.ts`, 3 each in `inspections.route.ts` and
`reservations.route.ts` and `apartments.service.ts`, 2 each in `apartments.route.ts` and
`assets.test.ts`, and 1 each in `apartment_shots.route.ts`, `apartment_shots.test.ts`,
`assets.route.ts`, `apartments.test.ts`, `inspections.test.ts`, `reservations.test.ts`.

> **Test files are call sites too.** `assets.test.ts:2`, `apartments.test.ts:1`,
> `inspections.test.ts:1`, `reservations.test.ts:1`, and `apartment_shots.test.ts:1` construct
> exceptions to simulate failures. Those are migrated in phase 5 alongside their module — usually
> by switching to the module's `<name>Errors` thrower, which is the whole point of phase 5.

To keep the tree green while phases 4–5 are in flight, add a **legacy overload** to each subclass.
This is what actually makes `new NotFoundException("Asset")` keep compiling — the string is treated
as the final message, and the code is a plausible default derived from the status.

> **This is deliberately a compile-time-only bridge, not a design.** The overloads exist so the tree
> stays green across the phase-4/phase-5 migration. They are removed in step 5.8, and the lint rule
> in step 7.2 keeps new string-form call sites from appearing. If you would rather not carry the
> bridge at all, the alternative is to land step 1.3 together with phases 4 and 5 in one commit —
> larger diff, no shim. Either is acceptable; the overload is the smaller-review option.

Replace the five subclass declarations with:

```ts
export class BadRequestException extends AppError {
  /** @deprecated MIGRATION SHIM — pass an AppErrorOptions object instead. Deleted in step 5.8. */
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  constructor(arg: AppErrorOptions | string) {
    super(400, typeof arg === "string" ? { code: "VALIDATION_ERROR", message: arg } : arg);
  }
}
export class UnauthorizedException extends AppError {
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  constructor(arg: AppErrorOptions | string) {
    super(401, typeof arg === "string" ? { code: "AUTH_TOKEN_MISSING", message: arg } : arg);
  }
}
export class ForbiddenException extends AppError {
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  constructor(arg: AppErrorOptions | string) {
    super(403, typeof arg === "string" ? { code: "FORBIDDEN_ROLE", message: arg } : arg);
  }
}
export class NotFoundException extends AppError {
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  constructor(arg: AppErrorOptions | string) {
    super(404, typeof arg === "string" ? { code: "ROUTE_NOT_FOUND", message: arg } : arg);
  }
}
export class ConflictException extends AppError {
  constructor(opts: AppErrorOptions);
  constructor(message: string);
  constructor(arg: AppErrorOptions | string) {
    super(409, typeof arg === "string" ? { code: "DUPLICATE_RECORD", message: arg } : arg);
  }
}
```

Note the two-argument legacy form `new BadRequestException(message, "MAX_PHOTOS_EXCEEDED")` still
will **not** compile — that is intentional, because it is exactly the ambiguous pattern the
migration removes, and it has only two call sites (`apartments.service.ts:90,123`) which step 4.6
rewrites directly.

**Accept.**
- All five subclasses accept a single options object.
- All five also still accept a single string (legacy).
- `new ConflictException({ code: "RESERVATION_OVERLAP", message: "…" })` type-checks.
- `error.message` equals the passed message exactly (no `"Conflict: "` prefix) in both forms.

**Verify.** With the overloads in place the tree must be green — that is their only job:
```bash
npx tsc --noEmit && npm run test
```
Record the legacy call-site count as your burn-down target:
```bash
grep -rcE "new (NotFoundException|ConflictException|BadRequestException|UnauthorizedException|ForbiddenException)\(" src/ --include=*.ts | grep -v ":0"
```
Target: every line of that output gone by the end of **step 5.8**, except the `*.errors.ts` files
that legitimately call `exceptionForStatus`.

---

### Step 1.4 — Add the single renderer

**Goal.** Exactly one function knows the wire format; Zod issues are translated to human sentences;
Postgres errors are unwrapped and sanitised.

**Touch.** Create `src/core/errors/error.handler.ts`.

**Do.** Create the file:

```ts
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { AppError } from "./error.exceptions";
import { ERROR_REGISTRY, type ErrorCode } from "./error.codes";
import type { ErrorDetail } from "./error.schema";

/** meta is developer-facing: never shipped in production. */
const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Builds the error envelope. THE ONLY PLACE that knows the wire format.
 * See docs/errorHandle.md §1 and §3.
 */
export const renderError = (params: {
  code: ErrorCode;
  message: string;
  status: ContentfulStatusCode;
  details?: ErrorDetail[];
  meta?: Record<string, unknown>;
}) => ({
  success: false as const,
  error: {
    code: params.code,
    message: params.message,
    ...(params.details && params.details.length > 0 ? { details: params.details } : {}),
    ...(params.meta && !isProduction() ? { meta: params.meta } : {}),
  },
});

// ---------------------------------------------------------------------------
// Validation translation (§4.1)
// ---------------------------------------------------------------------------

/** Maps the OpenAPI request target to the field prefix the client sees. */
const TARGET_PREFIX: Record<string, string> = {
  json: "body",
  form: "body",
  query: "query",
  param: "param",
  header: "header",
  cookie: "cookie",
};

const TARGET_LABEL: Record<string, string> = {
  body: "Request body",
  query: "Query parameters",
  param: "Path parameter",
  header: "Request header",
  cookie: "Request cookie",
};

const humanize = (segment: string) =>
  segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();

/**
 * Zod's own text is developer-facing and must never be forwarded. Each issue code gets a
 * human template; `issue.message` is only a fallback for `custom` issues, where the schema
 * author wrote the message on purpose.
 */
const ISSUE_TEMPLATES: Record<string, (label: string, issue: any) => string> = {
  invalid_type: (l, i) => `${l} must be a ${i.expected}.`,
  invalid_format: (l, i) => `${l} has an invalid format${i.format ? ` (expected ${i.format})` : ""}.`,
  too_small: (l, i) =>
    i.origin === "string"
      ? `${l} must be at least ${i.minimum} characters long.`
      : `${l} must be at least ${i.minimum}.`,
  too_big: (l, i) =>
    i.origin === "string"
      ? `${l} must be at most ${i.maximum} characters long.`
      : `${l} must be at most ${i.maximum}.`,
  invalid_value: (l, i) => `${l} must be one of: ${i.values.join(", ")}.`,
  unrecognized_keys: (l) => `${l} contains unknown fields.`,
  not_multiple_of: (l, i) => `${l} must be a multiple of ${i.divisor}.`,
  invalid_union: (l) => `${l} does not match any of the accepted shapes.`,
  invalid_key: (l) => `${l} has an invalid key.`,
  invalid_element: (l) => `${l} has an invalid element.`,
  custom: (l, i) => i.message || `${l} is invalid.`,
};

/**
 * Builds the 400 response for a failed contract validation.
 *
 * NOTE ON SCOPE: OpenAPIHono validates targets in a fixed order (params → query → headers →
 * cookies → body) and zValidator returns as soon as one target fails, so a single request
 * yields issues from exactly ONE target. `result.target` is what tells us which.
 */
export const formatValidationError = (result: {
  success: false;
  error: z.core.$ZodError;
  target: keyof typeof TARGET_PREFIX;
}) => {
  const prefix = TARGET_PREFIX[result.target] ?? "request";
  const baseLabel = TARGET_LABEL[prefix] ?? "Request";

  const details: ErrorDetail[] = result.error.issues.map((issue: any) => {
    const path = issue.path.map(String);
    const field = [prefix, ...path].join(".");
    const label = path.length === 0 ? baseLabel : `${baseLabel}: ${path.map(humanize).join(" ")}`;
    return {
      field,
      message: ISSUE_TEMPLATES[issue.code ?? ""]?.(label, issue) ?? issue.message,
    };
  });

  const n = details.length;
  return {
    status: 400 as ContentfulStatusCode,
    body: renderError({
      code: "VALIDATION_ERROR",
      message: `The request failed validation (${n} ${n === 1 ? "problem" : "problems"}).`,
      status: 400,
      details,
      meta: { origin: "VALIDATION", target: result.target },
    }),
  };
};

// ---------------------------------------------------------------------------
// Persistence translation (§4.4)
// ---------------------------------------------------------------------------

/** Walks the `cause` chain for a Postgres SQLSTATE (5 chars, e.g. "23505"). */
const findSqlState = (
  err: unknown,
): { code?: string; constraint?: string; message?: string } => {
  let current: any = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current.code === "string" && /^[0-9A-Z]{5}$/.test(current.code)) {
      return { code: current.code, constraint: current.constraint_name, message: current.message };
    }
    current = current.cause;
  }
  return {};
};

/** SQLSTATE → client-facing response. The DB's own text never reaches the client. */
const SQLSTATE_MAP: Record<string, { status: ContentfulStatusCode; code: ErrorCode; message: string }> = {
  "23505": { status: 409, code: "DUPLICATE_RECORD",        message: "A record with these values already exists." },
  "23503": { status: 409, code: "RELATED_RECORD_INVALID",  message: "A referenced record does not exist or is still in use." },
  "23502": { status: 400, code: "MISSING_REQUIRED_FIELD",  message: "A required field was missing from the request." },
  "23514": { status: 400, code: "CONSTRAINT_VIOLATION",    message: "The submitted values violate a data rule." },
  "22P02": { status: 400, code: "INVALID_IDENTIFIER",      message: "One of the identifiers in the request is not a valid value." },
  "22007": { status: 400, code: "INVALID_DATETIME",        message: "One of the dates in the request is not a valid date." },
  "22008": { status: 400, code: "INVALID_DATETIME",        message: "One of the dates in the request is not a valid date." },
};

// ---------------------------------------------------------------------------
// The one entry point used by app.onError
// ---------------------------------------------------------------------------

/**
 * Maps any thrown value to a status + envelope.
 * Order: deliberate app errors → persistence → unexpected.
 * See docs/errorHandle.md §3, §4.4, §4.5.
 */
export const toErrorResponse = (
  err: unknown,
): { status: ContentfulStatusCode; body: ReturnType<typeof renderError> } => {
  // 1. Deliberate, typed errors: rendered verbatim.
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: renderError({
        code: err.code,
        message: err.message,
        status: err.status,
        details: err.details,
        meta: err.meta,
      }),
    };
  }

  // 2. Hono's own exceptions. When a `res` was supplied it was deliberate — honour it verbatim.
  //    Otherwise map the status onto the envelope so a legitimate 405 is not reported as a 500.
  if (err instanceof HTTPException) {
    if (err.res) return { status: err.status, body: renderError({ code: "HTTP_ERROR", message: err.message, status: err.status, meta: { origin: "FRAMEWORK" } }) };
    const code: ErrorCode = err.status === 405 ? "METHOD_NOT_ALLOWED" : "HTTP_ERROR";
    return {
      status: err.status,
      body: renderError({ code, message: err.message || "The request could not be completed.", status: err.status, meta: { origin: "FRAMEWORK" } }),
    };
  }

  // 3. Constraint violations the domain layer could not know about.
  const pg = findSqlState(err);
  const mapped = pg.code ? SQLSTATE_MAP[pg.code] : undefined;
  if (mapped) {
    return {
      status: mapped.status,
      body: renderError({
        code: mapped.code,
        message: mapped.message,
        status: mapped.status,
        meta: { origin: "PERSISTENCE", sqlstate: pg.code, constraint: pg.constraint, driver: pg.message },
      }),
    };
  }

  // 4. Unexpected. Generic message only; the real detail is logged by the caller.
  return {
    status: 500,
    body: renderError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong on our end. Please try again; if it keeps happening, contact support.",
      status: 500,
      meta: { origin: "UNEXPECTED", driver: err instanceof Error ? err.message : String(err) },
    }),
  };
};

/** Convenience for handlers that want the status of a code without importing the registry. */
export const statusOf = (code: ErrorCode): ContentfulStatusCode => ERROR_REGISTRY[code].status;
```

**Accept.**
- `renderError` omits `details` when the array is empty and omits `meta` when `NODE_ENV=production`.
- `toErrorResponse(new ConflictException({...}))` returns that exception's status and exact message.
- A `{ code: "23505" }` nested two levels deep under `cause` maps to 409/`DUPLICATE_RECORD`.
- An unknown `Error("boom: table users")` returns 500 whose `message` does not contain `"boom"` or `"users"`.

**Verify.** `npx tsc --noEmit` → exit 0.

---

### Step 1.5 — Add the declarative error factory

**Goal.** A module declares its errors once and gets both the OpenAPI response entries and the
thrower functions from that single declaration.

**Touch.** Create `src/core/errors/error.define.ts`.

**Do.** Create the file:

```ts
import { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ERROR_REGISTRY, type ErrorCode } from "./error.codes";
import { AppError, exceptionForStatus } from "./error.exceptions";

/**
 * Builds one OpenAPI response entry. Multiple codes sharing a status are merged into a single
 * entry (OpenAPI allows only one response object per status) with every code named in the
 * description and the first code used as the example.
 */
export const createErrorResponse = (
  codes: ErrorCode | ErrorCode[],
  schema: z.ZodType<unknown>,
) => {
  const list = Array.isArray(codes) ? codes : [codes];
  const primary = list[0]!;
  return {
    description: list.map((c) => `${c}: ${ERROR_REGISTRY[c].description}`).join(" "),
    content: {
      "application/json": {
        schema,
        example: {
          success: false as const,
          error: { code: primary, message: ERROR_REGISTRY[primary].description },
        },
      },
    },
  };
};

/**
 * Declares one error. `message` may be a template over the context object the thrower receives;
 * typing that context explicitly is what gives call sites autocomplete and compile-time checking.
 */
export interface ErrorSpec<C = Record<string, unknown>> {
  status: ContentfulStatusCode;
  code: ErrorCode;
  /** OpenAPI description. */
  description: string;
  /** Final human message, or a template over the throw context. */
  message: string | ((ctx: C) => string);
}

type ErrorContext<S extends ErrorSpec<any>> =
  S["message"] extends (ctx: infer C) => string ? C : Record<string, unknown>;

/**
 * Declares a module's errors once, deriving:
 *   - `.responses`  → spread into `createRoute({ responses })`
 *   - `.someError()` → a thrower returning a real AppError subclass
 *
 * Usage (see docs/errorHandle.md §7):
 *   const assetErrors = defineErrors({ locked: {...} }, StandardErrorSchema);
 *   throw assetErrors.locked({ action: "delete" });
 */
export function defineErrors<const T extends Record<string, ErrorSpec<any>>>(
  specs: T,
  schema: z.ZodType<unknown>,
) {
  const responses = responsesForCodes(Object.values(specs).map((s) => s.code), schema);

  const throwers = Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [
      key,
      (ctx: Record<string, unknown> = {}) => {
        const message =
          typeof spec.message === "function"
            ? (spec.message as (c: Record<string, unknown>) => string)(ctx)
            : spec.message;
        return exceptionForStatus(spec.status, {
          code: spec.code,
          message,
          meta: { origin: "DOMAIN", ...ctx },
        });
      },
    ]),
  );

  return { responses, ...throwers } as {
    responses: ReturnType<typeof responsesForCodes>;
  } & { [K in keyof T]: (ctx?: ErrorContext<T[K]>) => AppError };
}

/**
 * Groups codes by status and builds one response entry per status.
 * Shared by `defineErrors` and the contract bundles in `error.responses.ts`.
 */
export function responsesForCodes(codes: ErrorCode[], schema: z.ZodType<unknown>) {
  const byStatus = new Map<ContentfulStatusCode, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_REGISTRY[code].status;
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return Object.fromEntries(
    [...byStatus.entries()].map(([status, list]) => [status, createErrorResponse(list, schema)]),
  ) as Record<number, ReturnType<typeof createErrorResponse>>;
}
```

> **Verified behaviour.** This exact shape was compiled and run against this repo's installed
> versions (`zod 4.4.3`, `@hono/zod-openapi 1.4.0`): a misspelled thrower key and a wrong context
> object are both **compile errors**, and the generated `/openapi.json` carries the real `code` as
> the response example. Two constraints are load-bearing:
> - `ErrorSpec` must be generic in its context type (`ErrorSpec<any>` at the constraint), otherwise
>   a template declared as `(ctx: { action: string }) => string` is not assignable.
> - Use `z.ZodType<unknown>` — `ZodType` is **not** re-exported from `@hono/zod-openapi`.

**Accept.**
- `defineErrors({...}, StandardErrorSchema).responses` has one key per distinct status.
- `assetErrors.locked({ action: "delete" })` returns a `ConflictException` instance.
- `assetErrors.lokced` and `assetErrors.locked({})` are both compile errors (verified in step 1.7).

**Verify.** `npx tsc --noEmit` → exit 0.

---

### Step 1.6 — Add the reusable response bundles

**Goal.** Routes compose their declared error responses from named, registry-derived bundles instead
of the current `getStandardResponses(resource)` that omits 403 and interpolates the resource name.

**Touch.** Create `src/core/errors/error.responses.ts`.

**Do.** Create the file:

```ts
import { z } from "@hono/zod-openapi";
import type { ErrorCode } from "./error.codes";
import { responsesForCodes } from "./error.define";
import { StandardErrorSchema } from "./error.schema";

/** Bundles are plain code lists, so they compose by concatenation. */
export const AUTHED = [
  "AUTH_TOKEN_MISSING",
  "AUTH_TOKEN_INVALID",
  "INTERNAL_SERVER_ERROR",
] as const satisfies readonly ErrorCode[];

export const ROLE = ["FORBIDDEN_ROLE"] as const satisfies readonly ErrorCode[];

/** For routes behind `apartmentGuard`: ownership failure + the apartment lookup failure. */
export const APARTMENT_SCOPED = [
  "FORBIDDEN_APARTMENT_ACCESS",
  "APARTMENT_NOT_FOUND",
] as const satisfies readonly ErrorCode[];

export const VALIDATION = ["VALIDATION_ERROR"] as const satisfies readonly ErrorCode[];

/** Builds `{ 400: {...}, 401: {...}, ... }` for a route from the codes it can return. */
export const errorResponses = (
  codes: readonly ErrorCode[],
  schema: z.ZodType<unknown> = StandardErrorSchema,
) => responsesForCodes([...codes], schema);

/** Convenience for the most common shape: auth + validation + 500. */
export const baseResponses = errorResponses([...AUTHED, ...VALIDATION]);
```

**Accept.**
- `errorResponses([...AUTHED, ...ROLE, ...APARTMENT_SCOPED])` yields exactly the keys `401, 403, 404, 500`.
- 403 is present (today's `getStandardResponses` omits it).
- Each entry's `content["application/json"].schema` is `StandardErrorSchema`.

**Verify.** `npx tsc --noEmit` → exit 0.

---

### Step 1.7 — Unit-test the core

**Goal.** The renderer's contract is pinned by tests before anything depends on it.

**Touch.** Create `src/core/errors/error.handler.test.ts` and `src/core/errors/error.define.test.ts`.

**Do.** Create `error.handler.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { z } from "@hono/zod-openapi";
import { formatValidationError, renderError, toErrorResponse } from "./error.handler";
import { ConflictException, NotFoundException } from "./error.exceptions";

/** Mimics Drizzle's wrapping: DrizzleQueryError.cause === PostgresError. */
class FakeDrizzleQueryError extends Error {
  constructor(public query: string, public params: any[], public cause?: Error) {
    super(`Failed query: ${query}`);
  }
}
class FakePostgresError extends Error {
  code = "23505";
  constraint_name = "asset_types_code_unique";
  constructor() {
    super('duplicate key value violates unique constraint "asset_types_code_unique"');
  }
}

describe("renderError", () => {
  it("omits details when the array is empty", () => {
    const b = renderError({ code: "ASSET_NOT_FOUND", message: "Asset does not exist.", status: 404, details: [] });
    expect("details" in b.error).toBe(false);
  });

  it("omits meta in production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const b = renderError({ code: "ASSET_NOT_FOUND", message: "Asset does not exist.", status: 404, meta: { origin: "DOMAIN" } });
    expect("meta" in b.error).toBe(false);
    process.env.NODE_ENV = prev;
  });

  it("always sets success to false", () => {
    expect(renderError({ code: "INTERNAL_SERVER_ERROR", message: "x", status: 500 }).success).toBe(false);
  });
});

describe("formatValidationError", () => {
  const parse = (schema: z.ZodType<unknown>, value: unknown, target: string) => {
    const r = schema.safeParse(value);
    if (r.success) throw new Error("expected a validation failure");
    return formatValidationError({ success: false, error: r.error, target: target as any });
  };

  it("qualifies fields with the request path and uses human sentences", () => {
    const schema = z.object({ password: z.string().min(8), guestCount: z.number().min(1) });
    const { status, body } = parse(schema, { password: "x", guestCount: 0 }, "json");

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("The request failed validation (2 problems).");
    expect(body.error.details?.map((d) => d.field).sort()).toEqual(["body.guestCount", "body.password"]);
    expect(body.error.details?.find((d) => d.field === "body.password")?.message)
      .toBe("Request body: password must be at least 8 characters long.");
  });

  it("never forwards raw Zod text", () => {
    const schema = z.object({ mode: z.enum(["a", "b"]) });
    const { body } = parse(schema, { mode: "z" }, "json");
    const msg = body.error.details![0]!.message;
    expect(msg).toMatch(/must be one of: a, b\./);
    expect(msg).not.toMatch(/Invalid|expected/i);
  });

  it("prefixes by target", () => {
    const schema = z.object({ limit: z.coerce.number().max(100) });
    const { body } = parse(schema, { limit: 500 }, "query");
    expect(body.error.details![0]!.field).toBe("query.limit");
  });

  it("keeps an author-written custom message", () => {
    const schema = z.string().refine(() => false, { message: "Check-out must be after check-in." });
    const { body } = parse(schema, "anything", "json");
    expect(body.error.details![0]!.message).toBe("Check-out must be after check-in.");
  });
});

describe("toErrorResponse", () => {
  it("renders an AppError verbatim, with no status prefix", () => {
    const err = new ConflictException({
      code: "RESERVATION_OVERLAP",
      message: "This apartment already has a reservation overlapping 12-15 Oct.",
    });
    const { status, body } = toErrorResponse(err);
    expect(status).toBe(409);
    expect(body.error.message).toBe("This apartment already has a reservation overlapping 12-15 Oct.");
    expect(body.error.message).not.toMatch(/^Conflict:/);
  });

  it("carries details through", () => {
    const err = new NotFoundException({
      code: "ASSET_NOT_FOUND",
      message: "Asset does not exist.",
      details: [{ field: "param.id", message: "Asset does not exist." }],
    });
    expect(toErrorResponse(err).body.error.details).toHaveLength(1);
  });

  it("unwraps DrizzleQueryError -> PostgresError and hides driver text", () => {
    const wrapped = new FakeDrizzleQueryError("insert ...", [], new FakePostgresError());
    const { status, body } = toErrorResponse(wrapped);
    expect(status).toBe(409);
    expect(body.error.code).toBe("DUPLICATE_RECORD");
    expect(body.error.message).toBe("A record with these values already exists.");
    expect(body.error.message).not.toMatch(/duplicate key|asset_types_code_unique/);
    expect((body.error as any).meta?.constraint).toBe("asset_types_code_unique");
  });

  it("maps unknown SQLSTATEs to 500", () => {
    const e: any = new Error("weird");
    e.code = "XX000";
    const { status, body } = toErrorResponse(e);
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("never leaks an unexpected error's message", () => {
    const { status, body } = toErrorResponse(new Error("kaboom: relation \"users\" does not exist"));
    expect(status).toBe(500);
    expect(body.error.message).not.toMatch(/kaboom|users/);
  });

  it("handles a thrown non-Error", () => {
    const { status, body } = toErrorResponse("just a string");
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
```

Create `error.define.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { StandardErrorSchema } from "./error.schema";
import { defineErrors } from "./error.define";
import { errorResponses, AUTHED, ROLE, APARTMENT_SCOPED } from "./error.responses";
import { ConflictException } from "./error.exceptions";

const assetErrors = defineErrors(
  {
    typeInvalid: {
      status: 400 as const,
      code: "ASSET_TYPE_INVALID" as const,
      description: "The referenced asset type does not exist.",
      message: "The asset type you selected does not exist.",
    },
    locked: {
      status: 409 as const,
      code: "ASSET_LOCKED" as const,
      description: "Asset is locked by an active reservation.",
      message: (ctx: { action: string }) =>
        `Cannot ${ctx.action} this asset because it is part of a shot in an active reservation.`,
    },
  },
  StandardErrorSchema,
);

describe("defineErrors", () => {
  it("groups responses by status", () => {
    expect(Object.keys(assetErrors.responses).map(Number).sort()).toEqual([400, 409]);
    expect(assetErrors.responses[409]!.content["application/json"].example.error.code).toBe("ASSET_LOCKED");
  });

  it("throwers return real exceptions with templated messages", () => {
    const err = assetErrors.locked({ action: "delete" });
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.status).toBe(409);
    expect(err.code).toBe("ASSET_LOCKED");
    expect(err.message).toBe("Cannot delete this asset because it is part of a shot in an active reservation.");
  });

  it("static messages ignore context", () => {
    expect(assetErrors.typeInvalid().message).toBe("The asset type you selected does not exist.");
  });

  it("throwers accept no argument when the message is static", () => {
    expect(() => assetErrors.typeInvalid()).not.toThrow();
  });
});

describe("errorResponses bundles", () => {
  it("includes 403, which the old helper omitted", () => {
    const r = errorResponses([...AUTHED, ...ROLE, ...APARTMENT_SCOPED]);
    expect(Object.keys(r).map(Number).sort()).toEqual([401, 403, 404, 500]);
  });

  it("names every code sharing a status in one entry", () => {
    const r = errorResponses(["APARTMENT_NOT_FOUND", "RESERVATION_NOT_FOUND"]);
    expect(Object.keys(r)).toEqual(["404"]);
    expect(r[404]!.description).toContain("APARTMENT_NOT_FOUND");
    expect(r[404]!.description).toContain("RESERVATION_NOT_FOUND");
  });

  it("uses StandardErrorSchema for every entry", () => {
    const r = errorResponses([...AUTHED]);
    expect(r[401]!.content["application/json"].schema).toBe(StandardErrorSchema);
  });
});
```

**Accept.** Both new files pass. Existing 63 tests still pass.

**Verify.**
```bash
npx vitest run src/core/errors && npm run test
```

---

### Step 1.8 — Delete the old helper

**Goal.** Remove the obsolete `commonErrors` / `getStandardResponses` helper so no module can
accidentally keep using the 403-less bundle.

**Touch.** Delete `src/core/errors/error.helpers.ts`.

**Do.** Delete the file. Its only consumers are the contract files, which step 3.2 rewrites. If you
want phase 1 to land before phase 3, keep the file for now and delete it in step 3.3 — but **do not**
add new imports of it.

For reference, the file being deleted is:
```ts
export const commonErrors = {
  badRequest: createErrorResponse("Bad Request: One or more parameters failed validation."),
  unauthorized: createErrorResponse("Unauthorized: Missing or invalid token."),
  forbidden: createErrorResponse("Forbidden: You do not have permission to access this resource."),
  internalServerError: createErrorResponse("Internal Server Error: Something went wrong on our end."),
  conflict: (resource) => createErrorResponse(`Conflict: This ${resource} already exists.`),
  notFound: (resource) => createErrorResponse(`Not Found: The requested ${resource} could not be found.`),
  getStandardResponses: (resource) => ({ 400, 401, 404, 409, 500 }),  // no 403
};
```
Note the `forbidden` entry exists but `getStandardResponses` never includes it — which is exactly the
gap `error.responses.ts` closes.

**Accept.** `grep -rn "getStandardResponses\|commonErrors" src/` returns nothing outside `src/docs/`.

**Verify.**
```bash
grep -rn "getStandardResponses\|commonErrors" src/ --include=*.ts
```

---

### Step 1.9 — Make `test-factory` use the real renderer

**Goal.** Tests exercise the same envelope production serves. This is the precondition for every
phase-5 assertion.

**Touch.** Rewrite `src/core/utils/test-factory.ts`.

**Do.** Replace the two handlers in `createTestApp` so the factory delegates to the core:

```ts
import { OpenAPIHono } from "@hono/zod-openapi";
import { App } from "@/types";
import { formatValidationError, renderError, toErrorResponse } from "@/core/errors/error.handler";
import { vi } from "vitest";

vi.mock("@/modules/users/users.service", () => ({
  usersService: {
    getByAuthId: vi.fn().mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      authId: "550e8400-e29b-41d4-a716-446655440000",
      role: "admin",
      status: "confirmed",
    }),
  },
}));

interface TestAppConfig {
  contextOverrides?: (c: any) => Record<string, any>;
}

export function createTestApp(config: TestAppConfig = {}) {
  const app = new OpenAPIHono<App>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const { status, body } = formatValidationError(result as any);
        return c.json(body, status);
      }
    },
  });

  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err);
    if (status >= 500) console.error("[Test Unhandled Error]", err);
    return c.json(body, status);
  });

  app.notFound((c) => {
    const { body } = renderError({
      code: "ROUTE_NOT_FOUND",
      message: `Route ${c.req.method} ${c.req.path} does not exist.`,
      status: 404,
    });
    return c.json(body, 404);
  });

  app.use("*", async (c, next) => {
    c.set("db", {} as any);

    const activeOverrides = config.contextOverrides ? config.contextOverrides(c) : {};

    Object.keys(activeOverrides).forEach((key) => {
      if (key !== "getUser" && key !== "updateUserById") {
        c.set(key as any, activeOverrides[key]);
      }
    });

    c.set("supabase", {
      auth: {
        getUser: activeOverrides.getUser || (() => Promise.resolve({ data: { user: null }, error: null })),
        admin: {
          updateUserById: activeOverrides.updateUserById || (() => Promise.resolve({ data: {}, error: null })),
        },
      },
    } as any);

    await next();
  });

  return app;
}
```

> The per-file `testApp.onError(...)` overrides in `assets.test.ts:89` and
> `apartment_shots.test.ts:122` must be **deleted** — they validate an envelope production does not
> have. Delete them in step 5.5 and 5.6 respectively (they are currently load-bearing for the
> `ConflictException` → 409 mapping, which the shared renderer now handles correctly).

**Accept.**
- `createTestApp()` has no local error-shape logic: every branch calls into `error.handler.ts`.
- `npm run test` → 63 passing (the existing bare status assertions are unaffected).
- Deleting the local overrides in `assets.test.ts` / `apartment_shots.test.ts` does **not** change
  their status assertions (409 still 409, 404 still 404) — confirm this manually before moving on.

**Verify.**
```bash
npm run test
```

---

## 2. Wiring — point production at the core

### Step 2.1 — Rewrite `index.ts` error handling

**Goal.** Production serves exactly the envelope the core builds; unknown routes get a real 404 body.

**Touch.** `src/index.ts`.

**Do.** Replace lines 14–65 (from the `CustomException` import through the closing `});` of
`app.onError`) with:

```ts
import { formatValidationError, renderError, toErrorResponse } from "./core/errors/error.handler";
import { cors } from "hono/cors";

const app = new OpenAPIHono<App>({
  defaultHook: (result, c) => {
    if (!result.success) {
      const { status, body } = formatValidationError(result as any);
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
  const { body } = renderError({
    code: "ROUTE_NOT_FOUND",
    message: `Route ${c.req.method} ${c.req.path} does not exist.`,
    status: 404,
  });
  return c.json(body, 404);
});
```

Remove the now-unused `CustomException` import.

**Accept.**
- `GET /does-not-exist` → 404 with `{ success: false, error: { code: "ROUTE_NOT_FOUND", message: "Route GET /does-not-exist does not exist." } }`.
- A Zod failure on any endpoint returns `details[].field` prefixed with `body.`/`query.`/`param.`.
- A 500 logs `[Unhandled Error]` with the stack.

**Verify.**
```bash
npx tsc --noEmit && npm run test
```

---

### Step 2.2 — `authGuard` throws

**Goal.** The guard no longer formats its own JSON; missing and invalid tokens get distinct codes.

**Touch.** `src/middleware/authGuard.ts`.

**Do.** Replace the file body:

```ts
import { createMiddleware } from "hono/factory";
import { App } from "@/types";
import { UnauthorizedException } from "@/core/errors/error.exceptions";

export const authGuard = createMiddleware<App>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    throw new UnauthorizedException({
      code: "AUTH_TOKEN_MISSING",
      message: "Authentication is required for this endpoint. Provide a Bearer token.",
      meta: { origin: "GUARD" },
    });
  }

  const supabase = c.get("supabase");
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new UnauthorizedException({
      code: "AUTH_SESSION_EXPIRED",
      message: "Your session is invalid or has expired. Please sign in again.",
      meta: { origin: "GUARD" },
    });
  }

  c.set("authUser", user);

  await next();
});
```

**Accept.**
- No `c.json` in the file.
- Missing token → 401 `AUTH_TOKEN_MISSING`; rejected token → 401 `AUTH_SESSION_EXPIRED`.
- `locations.test.ts:94` (401) and the other guard tests still pass unchanged.

**Verify.** `npm run test` → 63 passing.

---

### Step 2.3 — `roleGuard` throws

**Goal.** 403 gets a code and an actionable message; 401 for a missing auth context.

**Touch.** `src/middleware/roleGuard.ts`.

**Do.** Replace the guard body:

```ts
import { createMiddleware } from "hono/factory";
import { App } from "@/types";
import { usersService } from "../modules/users/users.service";
import type { users } from "@/db/schema";
import { ForbiddenException, UnauthorizedException } from "@/core/errors/error.exceptions";

export type UserRole = (typeof users.$inferSelect)["role"];

export const rolesGuard = (allowedRoles: UserRole[]) => {
  return createMiddleware<App>(async (c, next) => {
    const db = c.get("db");
    const authUser = c.get("authUser");

    if (!authUser) {
      throw new UnauthorizedException({
        code: "AUTH_TOKEN_MISSING",
        message: "Authentication is required for this endpoint. Provide a Bearer token.",
        meta: { origin: "GUARD" },
      });
    }

    const dbUser = await usersService.getByAuthId(db, authUser.id);

    if (!dbUser || !allowedRoles.includes(dbUser.role as UserRole) || dbUser.status !== "confirmed") {
      throw new ForbiddenException({
        code: "FORBIDDEN_ROLE",
        message:
          `This endpoint is only available to: ${allowedRoles.join(", ")}. ` +
          `Your role is '${dbUser?.role ?? "unknown"}'.`,
        meta: { origin: "GUARD", role: dbUser?.role, status: dbUser?.status },
      });
    }

    c.set("user", dbUser);

    await next();
  });
};
```

**Accept.**
- No `c.json` in the file.
- A `guest` calling an admin route → 403 `FORBIDDEN_ROLE` (satisfies `users.test.ts:135`,
  `locations.test.ts:113`).
- A non-confirmed user is rejected with the same code.

**Verify.** `npm run test` → 63 passing.

---

### Step 2.4 — `apartmentGuard` throws

**Goal.** Ownership failures stop leaking record existence, and the path-parameter resolution
fallback produces the same `NotFoundException` the handler would.

**Touch.** `src/middleware/apartmentGuard.ts`.

**Do.** Replace the file body:

```ts
import { createMiddleware } from "hono/factory";
import { App } from "@/types";
import { usersService } from "../modules/users/users.service";
import { apartmentsService } from "../modules/apartments/apartments.service";
import { reservationsService } from "../modules/reservations/reservations.service";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@/core/errors/error.exceptions";

export const apartmentGuard = (adminAllowed = false) => {
  return createMiddleware<App>(async (c, next) => {
    const db = c.get("db");
    const authUser = c.get("authUser");

    if (!authUser) {
      throw new UnauthorizedException({
        code: "AUTH_TOKEN_MISSING",
        message: "Authentication is required for this endpoint. Provide a Bearer token.",
        meta: { origin: "GUARD" },
      });
    }

    const user = await usersService.getByAuthId(db, authUser.id);

    if (!user || user.status !== "confirmed") {
      throw new ForbiddenException({
        code: "FORBIDDEN_ROLE",
        message: "Your account is not confirmed, so it cannot access this resource.",
        meta: { origin: "GUARD", status: user?.status },
      });
    }

    if (adminAllowed && user.role === "admin") {
      await next();
      return;
    }

    const targetId = c.req.param("apartmentId") || c.req.param("id");

    if (!targetId) {
      throw new BadRequestException({
        code: "MISSING_REQUIRED_FIELD",
        message: "This endpoint requires an apartment or reservation identifier in the URL path.",
        details: [{ field: "param", message: "Expected an 'apartmentId' or 'id' path parameter." }],
        meta: { origin: "GUARD" },
      });
    }

    // Resolution fallback: the path segment may be an apartment id or a reservation id.
    let apartment = await apartmentsService.getById(db, targetId);

    if (!apartment) {
      const reservation = await reservationsService.getById(db, targetId);
      if (reservation?.apartmentId) {
        apartment = await apartmentsService.getById(db, reservation.apartmentId);
      }
    }

    if (!apartment) {
      throw new NotFoundException({
        code: "APARTMENT_NOT_FOUND",
        message: "Apartment does not exist.",
        meta: { origin: "GUARD", id: targetId },
      });
    }

    if (apartment.owner !== user.id) {
      throw new ForbiddenException({
        code: "FORBIDDEN_APARTMENT_ACCESS",
        message: "You do not have access to this apartment.",
        meta: { origin: "GUARD", apartmentId: apartment.id },
      });
    }

    await next();
  });
};
```

**Behaviour changes to expect (intentional, from `errorHandle.md` §4.2):**

| Before | After | Why |
| --- | --- | --- |
| `400 "Bad Request: User context missing"` for a non-confirmed user | `403 FORBIDDEN_ROLE` | A missing/unconfirmed account is an authorization problem, not a malformed request. |
| `403 "Forbidden: You do not have access to this apartment"` | `403 FORBIDDEN_APARTMENT_ACCESS`, message `"You do not have access to this apartment."` | Neutral message; no id echo. |
| `404 "Not Found: Apartment does not exist"` | `404 APARTMENT_NOT_FOUND` | Code added. |

> **Good news on risk.** The `400 → 403` change is **not** test-breaking. All three routes that use
> `apartmentGuard` (`apartments.contract.ts:92,122`, `reservations.contract.ts:26`) also run
> `rolesGuard` first, and `rolesGuard` already requires `status === "confirmed"` — so the guard's
> `!user || user.status !== "confirmed"` branch is **unreachable in practice**. It is a defensive
> dead branch, not load-bearing. The 403 assertion at `reservations.test.ts:259` (admin bypass) and
> the 403 at `reservations.test.ts:291` (other host's apartment) both still pass.

**Accept.**
- No `c.json` in the file.
- `reservations.test.ts:291` (403 for another host's apartment) still passes.
- The guard never returns 404-with-an-id for an ownership failure.

**Verify.** `npm run test` → 63 passing.

---

### Step 2.5 — Runtime-config middleware uses `HTTP_ERROR`

**Goal.** Missing environment configuration is a server fault with a code, not an opaque
`new Error(...)`.

**Touch.** `src/middleware/db.ts`, `src/middleware/supabase.ts`, `src/middleware/s3.ts`.

**Do.** In each file, replace `throw new Error("Missing X …")` with:

```ts
throw new AppError(500, {
  code: "HTTP_ERROR",
  message: "The service is not correctly configured and cannot serve requests right now.",
  meta: { origin: "BOOTSTRAP", missing: "DATABASE_URL" },
});
```

(Adjust `missing` per file: `"DATABASE_URL"`, `"SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY"`,
`"R2_ENDPOINT_URL|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY"`.)

Import: `import { AppError } from "@/core/errors/error.exceptions";`

> Keep the message generic — an operator needs the detail in the log, not on the wire. The
> `meta.missing` field is present in non-production, which is where this class of failure occurs.

**Accept.**
- No `new Error(` in `src/middleware/`.
- `grep -rn "new Error(" src/middleware/` → nothing.

**Verify.**
```bash
grep -rn "new Error(" src/middleware/ ; npx tsc --noEmit && npm run test
```

---

## 3. Contracts — declare what the API can return

### Step 3.1 — Fix the `users.contract.ts` nesting bug

**Goal.** Error responses for `getUsersRoute` are declared at the response level, not nested inside
the 200 object.

**Touch.** `src/modules/users/users.contract.ts`.

**Do.** In `getUsersRoute`, the `...userErrors` spread at **line 33** sits *inside* the `200` object
(same indentation as `content:` on line 27). Move it out one level:

```ts
  responses: {
    200: {
      description: "Get all users",
      content: {
        "application/json": {
          schema: GetUsersResponseSchema,
        },
      },
    },
    ...userErrors,   // ← moved out of the 200 object
  },
});                  // line 36
```

> This is a live bug: as written, `GET /users` declares **no** error responses, and the `200` object
> silently carries `400/401/404/409/500` as extra properties the generator drops. The other five
> routes in the file (spreads at lines 59, 83, 111, 133, 159) are already correct — this is the only
> misplaced one.

**Accept.**
- `GET /users`'s entry in `/openapi.json` has keys `200, 400, 401, 404, 409, 500`.
- All six routes in the file declare their errors at response level.

**Verify.**
```bash
npx tsx --env-file=.env -e "import app from './src/index'; (async () => { const r = await app.request('/openapi.json'); const d = await r.json(); console.log(Object.keys(d.paths['/users'].get.responses)); })();"
```

---

### Step 3.2 — Rewrite each contract's error responses

**Goal.** Every route declares every code it can actually return, driven by the registry.

**Touch.** All 7 `*.contract.ts` files.

**Do.** Replace the `const xErrors = commonErrors.getStandardResponses("X")` line and the
`...xErrors` spread in each file with a bundle built from the codes the route can really produce.
Use the table below — it is derived from the guards in each route's `middleware` array plus the
throws in its handler.

| Module / route | middleware | codes to declare |
| --- | --- | --- |
| **users** `getUsersRoute` | auth, role(admin) | `AUTHED + ROLE + VALIDATION` |
| `getUserByIdRoute` | auth | `AUTHED + VALIDATION + USER_NOT_FOUND` |
| `getUserByAuthIdRoute` | auth *(unmounted — see §9.8)* | `AUTHED + VALIDATION + USER_NOT_FOUND` |
| `createUserRoute` | auth, role(admin) | `AUTHED + ROLE + VALIDATION + DUPLICATE_RECORD + AUTH_PROVIDER_ERROR` |
| `inviteUserRoute` | auth, role(admin) | `AUTHED + ROLE + USER_NOT_FOUND + INVITATION_ERROR` |
| `updatePasswordRoute` | auth | `AUTHED + VALIDATION + AUTH_PROVIDER_ERROR` |
| **apartments** `getApartmentsRoute` | auth | `AUTHED` |
| `getApartmentByIdRoute` | auth | `AUTHED + VALIDATION + APARTMENT_NOT_FOUND` |
| `createApartmentRoute` | auth, role(admin) | `AUTHED + ROLE + VALIDATION + USER_NOT_FOUND + LOCATION_NOT_FOUND + RELATED_RECORD_INVALID` |
| `requestUploadTokensRoute` | auth, role(admin,host), apartmentGuard | `AUTHED + ROLE + APARTMENT_SCOPED + VALIDATION + MAX_PHOTOS_EXCEEDED` |
| `confirmUploadRoute` | auth, role(admin,host), apartmentGuard | `AUTHED + ROLE + APARTMENT_SCOPED + VALIDATION + MAX_PHOTOS_EXCEEDED + DUPLICATE_RECORD` |
| `getApartmentsByHostRoute` | auth, role(host) | `AUTHED + ROLE + USER_NOT_FOUND` |
| **reservations** `getReservationsByApartmentRoute` | auth, role(admin,host), apartmentGuard(true) | `AUTHED + ROLE + APARTMENT_SCOPED + VALIDATION` |
| `createReservationRoute` | auth, role(host) | `AUTHED + ROLE + VALIDATION + APARTMENT_NOT_FOUND + FORBIDDEN_APARTMENT_ACCESS + RESERVATION_OVERLAP + RESERVATION_INVALID_RANGE + RELATED_RECORD_INVALID` |
| `updateReservationRoute` | auth, role(host) | `AUTHED + ROLE + VALIDATION + RESERVATION_NOT_FOUND + RESERVATION_OVERLAP + RESERVATION_INVALID_RANGE` |
| `deleteReservationRoute` | auth, role(host) | `AUTHED + ROLE + VALIDATION + RESERVATION_NOT_FOUND` |
| **locations** `getLocationsRoute` | auth, role(admin) | `AUTHED + ROLE` |
| `createLocationRoute` | auth, role(admin) | `AUTHED + ROLE + VALIDATION` |
| **assets** `getAssetsByApartmentRoute` | auth, role(admin,host) | `AUTHED + ROLE + VALIDATION + APARTMENT_NOT_FOUND` |
| `createAssetRoute` | auth, role(host) | `AUTHED + ROLE + VALIDATION + APARTMENT_NOT_FOUND + ASSET_TYPE_INVALID + RELATED_RECORD_INVALID` |
| `deleteAssetRoute` | auth, role(host) | `AUTHED + ROLE + VALIDATION + ASSET_NOT_FOUND + ASSET_LOCKED` |
| **apartment_shots** `getShotsByApartmentRoute` | auth, role(admin,host) | `AUTHED + ROLE + VALIDATION + APARTMENT_NOT_FOUND + RESERVATION_NOT_FOUND` |
| `syncApartmentShotsRoute` | auth, role(host) | `AUTHED + ROLE + VALIDATION + APARTMENT_NOT_FOUND + APARTMENT_SHOTS_LOCKED + RELATED_RECORD_INVALID` |
| **inspections** `createInspectionRoute` | auth, role(host) | `AUTHED + ROLE + VALIDATION + RESERVATION_NOT_FOUND + INSPECTION_ALREADY_EXISTS + RESERVATION_NOT_COVERED + INSPECTION_NO_PHOTO_PROOF + INSPECTION_WINDOW_EXPIRED` |
| `createInspectionFlagRoute` | *(none)* | `VALIDATION + INSPECTION_NOT_FOUND + FLAG_ALREADY_EXISTS + FLAG_WINDOW_EXPIRED + INTERNAL_SERVER_ERROR` |
| `getInspectionByIdRoute` | *(none)* | `VALIDATION + INSPECTION_NOT_FOUND + INTERNAL_SERVER_ERROR` |
| `getInspectionByReservationRoute` | auth, role(admin,host) | `AUTHED + ROLE + VALIDATION + RESERVATION_NOT_FOUND + INSPECTION_NOT_FOUND` |
| `pingInspectionRoute` | *(none)* | `VALIDATION + INSPECTION_NOT_FOUND + INTERNAL_SERVER_ERROR` |

Then, in each file, replace the local `const xErrors = …` with:

```ts
import { errorResponses, AUTHED, ROLE, APARTMENT_SCOPED } from "@/core/errors/error.responses";

const apartmentErrors = errorResponses([...AUTHED, ...ROLE, ...APARTMENT_SCOPED]);
```

and spread `...apartmentErrors` at **response level** (see step 3.1 for the shape).

**Two routes deserve a note.**
- `getInspectionByIdRoute` and `pingInspectionRoute` are **deliberately unauthenticated** (guest
  access). They must **not** declare 401/403.
- `createInspectionFlagRoute` also has no middleware. If you intend it to be guest-accessible,
  leave it; if not, that is a separate security change — flag it, do not silently add a guard here.

**Accept.**
- `grep -rn "getStandardResponses\|commonErrors" src/modules/` → nothing.
- Every route in `/openapi.json` declares 500.
- Every route behind `rolesGuard` or `apartmentGuard` declares 403.
- No route declares a status it cannot produce (spot-check the two unauthenticated inspections routes).

**Verify.**
```bash
npx tsx --env-file=.env -e "import app from './src/index'; (async () => { const d = await (await app.request('/openapi.json')).json(); for (const [p, ops] of Object.entries<any>(d.paths)) for (const [m, op] of Object.entries<any>(ops)) console.log(m.toUpperCase(), p, Object.keys(op.responses).join(',')); })();"
```

---

### Step 3.3 — Delete `error.helpers.ts`

**Goal.** The obsolete helper is gone once no module imports it.

**Touch.** Delete `src/core/errors/error.helpers.ts` (if not already deleted in step 1.8).

**Accept.** `grep -rn "error.helpers" src/` → nothing.

**Verify.** `npx tsc --noEmit && npm run test`

---

## 4. Domain — `db-validator.ts` throws registry codes

### Step 4.1 — Replace `checkExistence` with per-resource existence assertions

**Goal.** Existence checks name the entity, use the registry's `*_NOT_FOUND` code, and stop
interpolating ids into user-facing text.

**Touch.** `src/core/utils/db-validator.ts`.

**Do.** Replace `checkExistence` and its `schemaRegistry` with a table that also carries the code:

```ts
import { AppError, NotFoundException } from "@/core/errors/error.exceptions";
import type { ErrorCode } from "@/core/errors/error.codes";

/**
 * Maps a registry resource key to its table and its NOT_FOUND code.
 * Adding a resource here is what makes `checkExistence(db, "<key>", id)` type-check.
 */
const resourceRegistry = {
  users:        { table: users,        code: "USER_NOT_FOUND",        label: "User" },
  locations:    { table: locations,    code: "LOCATION_NOT_FOUND",    label: "Location" },
  apartments:   { table: apartments,   code: "APARTMENT_NOT_FOUND",   label: "Apartment" },
  reservations: { table: reservations, code: "RESERVATION_NOT_FOUND", label: "Reservation" },
  inspections:  { table: inspections,  code: "INSPECTION_NOT_FOUND",  label: "Inspection" },
  assets:       { table: assets,       code: "ASSET_NOT_FOUND",       label: "Asset" },
  assetTypes:   { table: assetTypes,   code: "ASSET_TYPE_NOT_FOUND",  label: "Asset type" },
} as const satisfies Record<string, { table: unknown; code: ErrorCode; label: string }>;

type ResourceType = keyof typeof resourceRegistry;

/**
 * Asserts that a row exists.
 * Order: existence only.
 */
export async function checkExistence(
  db: any,
  resource: ResourceType,
  id: string,
): Promise<void> {
  const entry = resourceRegistry[resource];

  // Unreachable via the type system; a real assertion failure, not a client error.
  if (!entry) {
    throw new AppError(500, {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong on our end.",
      meta: { origin: "DEVELOPER", reason: `Unregistered resource '${resource}'` },
    });
  }

  const [row] = await db
    .select({ id: (entry.table as any).id })
    .from(entry.table)
    .where(eq((entry.table as any).id, id))
    .limit(1);

  if (!row) {
    throw new NotFoundException({
      code: entry.code,
      message: `${entry.label} does not exist.`,
      meta: { origin: "DOMAIN", resource, id },
    });
  }
}
```

> The `id` moves from the message into `meta.id`. `errorHandle.md` §8: ids are attacker-controlled
> and belong in `meta` unless the user needs them to act. Callers that need the id in the message
> (e.g. a reservation lookup) should throw their own typed error instead.

**Accept.**
- `checkExistence(db, "assets", id)` throws `ASSET_NOT_FOUND` with message `"Asset does not exist."`.
- Passing an unregistered key is a **compile error**, not a runtime `throw new Error`.
- No `new Error(` remains in the file.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 4.2 — Ownership and overlap assertions

**Goal.** Ownership uses `FORBIDDEN_APARTMENT_ACCESS`; the date-range rule is a 400, not a 409.

**Touch.** `src/core/utils/db-validator.ts` — `assertApartmentOwnership`, `assertNoOverlappingReservation`.

**Do.** In `assertApartmentOwnership`, replace the two throws:

```ts
  if (!apartment) {
    throw new NotFoundException({
      code: "APARTMENT_NOT_FOUND",
      message: "Apartment does not exist.",
      meta: { origin: "DOMAIN", apartmentId },
    });
  }

  if (apartment.owner !== userId) {
    throw new ForbiddenException({
      code: "FORBIDDEN_APARTMENT_ACCESS",
      message: "You do not have access to this apartment.",
      meta: { origin: "DOMAIN", apartmentId },
    });
  }
```

In `assertNoOverlappingReservation`, the invalid-range check becomes a 400 and the overlap becomes a
409. Add the ordering comment the guidelines require (`errorHandle.md` §4.3 rule 3):

```ts
/**
 * Asserts the requested range does not overlap an existing reservation.
 * Order: range validity → overlap. The first violation wins.
 */
export async function assertNoOverlappingReservation(db: any, params: OverlapCheckParams) {
  // … unchanged range resolution …

  if (newStart >= newEnd) {
    throw new BadRequestException({
      code: "RESERVATION_INVALID_RANGE",
      message: "Check-out must be strictly after check-in.",
      details: [
        {
          field: "body.checkOutDatetime",
          message: "Check-out must be strictly after check-in.",
        },
      ],
      meta: { origin: "DOMAIN" },
    });
  }

  // … unchanged query …

  if (overlapping) {
    throw new ConflictException({
      code: "RESERVATION_OVERLAP",
      message:
        "This apartment already has a reservation overlapping the requested dates. " +
        "Choose dates outside that range or cancel the existing reservation.",
      meta: { origin: "DOMAIN", apartmentId, conflictingReservationId: overlapping.id },
    });
  }
}
```

> **Status change.** The invalid-range case moves 409 → 400. It is a malformed request, not a
> conflict with stored state. Update the contract in step 3.2 accordingly (already reflected in the
> table: `RESERVATION_INVALID_RANGE` is a 400 code).

**Accept.**
- Overlap → 409 `RESERVATION_OVERLAP`.
- `newStart >= newEnd` → 400 `RESERVATION_INVALID_RANGE` with a `body.checkOutDatetime` detail.
- Ownership → 403 `FORBIDDEN_APARTMENT_ACCESS`.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 4.3 — Inspection creation assertions

**Goal.** Each precondition in `assertCanCreateInspection` gets its own code, in a documented order.

**Touch.** `src/core/utils/db-validator.ts`.

**Do.** Add the order comment and replace the four throws:

```ts
/**
 * Asserts an inspection may be created for a reservation.
 * Order: existence → uniqueness → state → photo proof → time window.
 * The first violation wins, so identical input always yields the same error.
 */
```

| Check | Throw |
| --- | --- |
| `!record` | `NotFoundException` — `RESERVATION_NOT_FOUND`, `"Reservation does not exist."`, `meta.id = reservationId` |
| `record.existingInspectionId` | `ConflictException` — `INSPECTION_ALREADY_EXISTS`, `"An inspection already exists for this reservation."`, `meta.inspectionId` |
| `record.status !== "COVERED"` | `BadRequestException` — `RESERVATION_NOT_COVERED`, `` `An inspection can only be created once the reservation is covered. This reservation is currently '${record.status}'.` ``, `meta.status` |
| `!record.hasPhotoProof` | `BadRequestException` — `INSPECTION_NO_PHOTO_PROOF`, `"An inspection can only be created once the reservation's photo proof is satisfied."` |
| `now > deadline` | `BadRequestException` — `INSPECTION_WINDOW_EXPIRED`, `` `The inspection window has closed. Inspections can only be created up to 1 hour after check-in (${effectiveCheckIn.toISOString()}).` ``, `meta.deadline` |

**Accept.**
- Five distinct codes, one per rule.
- No message begins with `"Cannot create inspection:"` (the status prefix is gone; the rule is stated
  in the first clause instead).

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 4.4 — Flag creation assertions

**Goal.** Same treatment for `assertCanCreateFlag`.

**Touch.** `src/core/utils/db-validator.ts`.

**Do.** Add the order comment (`existence → uniqueness → time window`) and replace:

| Check | Throw |
| --- | --- |
| `!record` | `NotFoundException` — `INSPECTION_NOT_FOUND`, `"Inspection does not exist."`, `meta.id = inspectionId` |
| `record.existingFlagId` | `ConflictException` — `FLAG_ALREADY_EXISTS`, `"A flag has already been submitted for this shot."`, `meta.shotId` |
| `now > deadline` | `BadRequestException` — `FLAG_WINDOW_EXPIRED`, `` `The flag submission window has closed. Flags can only be submitted up to ${maxHoursWindow} hours after check-in.` ``, `meta.deadline` |

**Accept.** Three codes; no id interpolation into messages.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 4.5 — Asset and shots lock assertions

**Goal.** The two lock assertions use their registry codes and put the status in `meta`, not prose.

**Touch.** `src/core/utils/db-validator.ts`.

**Do.** In `assertCanModifyAsset`:

```ts
  if (lockedRecord) {
    throw new ConflictException({
      code: "ASSET_LOCKED",
      message:
        `This asset cannot be ${action === "delete" ? "deleted" : "changed"} because it is part of ` +
        "a shot for a reservation that is currently covered. Wait until that reservation is closed, " +
        "or remove the asset from the shot first.",
      meta: { origin: "DOMAIN", assetId, reservationId: lockedRecord.reservationId, status: lockedRecord.status },
    });
  }
```

In `assertCanModifyApartmentShots`:

```ts
  if (lockedRecord) {
    throw new ConflictException({
      code: "APARTMENT_SHOTS_LOCKED",
      message:
        "These shots cannot be changed because this apartment has an upcoming or active reservation " +
        "with locked photo proof. Wait until that reservation is closed.",
      meta: { origin: "DOMAIN", apartmentId, status: lockedRecord.status },
    });
  }
```

**Accept.**
- No raw id in either message; both ids present in `meta`.
- The words `"Cannot sync or modify shots for apartment '<uuid>'"` are gone.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 4.6 — Service-layer domain errors

**Goal.** The three `throw new Error(...)` sites in services become typed domain errors, and the
unreachable `ASSET_TYPE_ID_REQUIRED` guard is deleted.

**Touch.** `src/modules/assets/assets.service.ts`, `src/modules/users/users.service.ts`,
`src/modules/apartments/apartments.service.ts`.

**Do.**

1. `assets.service.ts` — delete lines 38–40 entirely:

```ts
    if (!createdAsset.assetTypeId) {
      throw new Error("ASSET_TYPE_ID_REQUIRED");
    }
```

   `assetTypeId` is `uuid("asset_type_id").notNull()` in the Drizzle schema and is required by
   `InsertAssetSchema`, so this branch is unreachable. If it ever fires it is a bug, and the
   `NOT NULL` violation now surfaces through the SQLSTATE map as `23502` →
   `MISSING_REQUIRED_FIELD` (400).

2. `users.service.ts:72` and `:112` — replace both `throw new Error(...)`:

```ts
    if (error || !data.user) {
      throw new BadRequestException({
        code: "AUTH_PROVIDER_ERROR",
        message: "The account could not be created with the authentication provider. Please try again.",
        meta: { origin: "UPSTREAM", provider: "supabase", driver: error?.message },
      });
    }
```

```ts
    if (error || !data.user) {
      throw new BadRequestException({
        code: "INVITATION_ERROR",
        message: "The invitation email could not be sent. Please check the email address and try again.",
        meta: { origin: "UPSTREAM", provider: "supabase", driver: error?.message },
      });
    }
```

3. `apartments.service.ts:64` — the `NotFoundException("Failed to retrieve created apartment")`
   abuses the resource slot. It is a post-insert read that returned nothing, i.e. a bug, not a 404:

```ts
    if (!result) {
      throw new AppError(500, {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong on our end. Please try again.",
        meta: { origin: "DEVELOPER", reason: "Apartment vanished between insert and read", id: createdApartment.id },
      });
    }
```

4. `apartments.service.ts:90,123` — replace the `BadRequestException(message, "MAX_PHOTOS_EXCEEDED")`
   two-argument form with the options object:

```ts
      throw new BadRequestException({
        code: "MAX_PHOTOS_EXCEEDED",
        message:
          `This apartment already has ${activeCount} photos and the limit is ${MAX_PHOTOS_PER_APARTMENT}. ` +
          "Remove some photos before adding more.",
        meta: { origin: "DOMAIN", limit: MAX_PHOTOS_PER_APARTMENT, activeCount },
      });
```

```ts
      throw new BadRequestException({
        code: "MAX_PHOTOS_EXCEEDED",
        message:
          `You are confirming ${photos.length} photos but the limit is ${MAX_PHOTOS_PER_APARTMENT}. ` +
          "Remove some photos and try again.",
        meta: { origin: "DOMAIN", limit: MAX_PHOTOS_PER_APARTMENT, submitted: photos.length },
      });
```

**Accept.**
- `grep -rn "new Error(" src/ --include=*.ts` → only the `AppError` uses and test helpers.
- No two-argument `BadRequestException(` / `UnauthorizedException(` call sites remain.

**Verify.**
```bash
grep -rn "new Error(" src/ --include=*.ts
npx tsc --noEmit && npm run test
```

---

### Step 4.7 — Migrate the route-layer call sites

**Goal.** Every legacy string-argument call site in `src/modules/*/*.route.ts` is migrated to a real
registry code. (Test-file call sites are migrated in phase 5, alongside their module.)

**Touch.** `src/modules/*/*.route.ts`.

**Do.** The mechanical transformation is:

| Legacy | Replacement |
| --- | --- |
| `throw new NotFoundException("Asset")` | `throw assetErrors.notFound()` |
| `throw new NotFoundException(\`Reservation with ID ${id}\`)` | `throw reservationErrors.notFound({ id })` |
| `throw new UnauthorizedException("Inspection")` | `throw inspectionErrors.unauthenticated()` |
| `throw new BadRequestException(msg, "CODE")` | `throw <module>Errors.<key>({ … })` |

Because the module `.errors.ts` files do not exist until phase 5, **in this step use the options
object inline** and let step 5.x swap it for the thrower:

```ts
throw new NotFoundException({
  code: "USER_NOT_FOUND",
  message: "User does not exist.",
  meta: { origin: "ROUTE", id },
});
```

The sites to migrate, by file:

| File | Sites | Notes |
| --- | --- | --- |
| `users.route.ts` | `:36`, `:61` `NotFoundException("User")`; `:74` `BadRequestException(…)`; `:88` `UnauthorizedException()`; `:97` `BadRequestException(authError.message, …)` | `:74`/`:97` also leak provider text — fix per step 5.3 |
| `apartments.route.ts` | 2 sites | see step 5.4 |
| `inspections.route.ts` | `:25` `UnauthorizedException("Inspection")`; `:86`, `:100` `NotFoundException("Inspection")` | `:25` is a **bug** — the word `"Inspection"` is the 401 message |
| `reservations.route.ts` | `:44` `UnauthorizedException("Reservation")`; 2 more | `:44` is a **bug** — same shape |
| `assets.route.ts` | 1 site | see step 5.2 |
| `apartment_shots.route.ts` | 1 site | see step 5.6 |

**Accept.**
- `npx tsc --noEmit` is clean.
- The two 401 bugs above no longer put a noun in the message.

**Verify.**
```bash
npx tsc --noEmit && npm run test
```

> **Do not delete the step-1.3 overloads yet.** Test files still use them until phase 5; removing
> them here breaks the suite. They are removed in step 5.8.

---

## 5. Modules — per-module error definitions and tests

### Step 5.0 — The pattern every module step follows

Each module gets one new file, `src/modules/<name>/<name>.errors.ts`, which is the **single**
declaration of that module's errors. Everything else derives from it. Template:

```ts
import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

/**
 * Every error this module can produce, declared once.
 * - `<name>Errors.responses` → spread into the contract's `responses`.
 * - `<name>Errors.<key>(ctx)` → throw it.
 * See docs/errorHandle.md §7.
 */
export const <name>Errors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "X_NOT_FOUND" as const,
      description: "X does not exist.",
      message: "X does not exist.",
    },
    // …
  },
  StandardErrorSchema,
);
```

Then: routes `throw <name>Errors.key(ctx)`, and the contract spreads
`...<name>Errors.responses` on top of the shared bundles.

**Rules for every module step.**
1. The module's `.errors.ts` is the only place its codes appear as literals.
2. Every route declares 500 and every status its middleware can produce.
3. At least one test asserts the **full envelope** — `status`, `error.code`, and that
   `error.message` matches a human pattern — not just `res.status`.

---

### Step 5.1 — Locations (smallest; establishes the pattern)

**Goal.** Prove the pattern end-to-end on the simplest module before scaling it.

**Touch.** Create `src/modules/locations/locations.errors.ts`; edit `locations.contract.ts`,
`locations.route.ts`, `locations.test.ts`.

**Do.**

`locations.errors.ts`:

```ts
import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const locationErrors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "LOCATION_NOT_FOUND" as const,
      description: "Location does not exist.",
      message: "Location does not exist.",
    },
  },
  StandardErrorSchema,
);
```

`locations.contract.ts` — add error responses to both routes (both are behind `authGuard` +
`rolesGuard(["admin"])`, so both need 401/403/500; the POST also needs 400):

```ts
import { errorResponses, AUTHED, ROLE, VALIDATION } from "@/core/errors/error.responses";

const locationErrors = errorResponses([...AUTHED, ...ROLE]);
const createLocationErrors = errorResponses([...AUTHED, ...ROLE, ...VALIDATION]);
```

Then spread at response level in each route.

`locations.test.ts` — upgrade the two error assertions to check the envelope:

```ts
  it("GET /locations should return 401 with the canonical envelope if token is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error("Missing token") });

    const res = await testApp.request("/locations");
    expect(res.status).toBe(401);

    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AUTH_TOKEN_MISSING");
    expect(body.error.message).toMatch(/Authentication is required/);
  });

  it("GET /locations should return 403 FORBIDDEN_ROLE for a non-admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: VALID_UUID } }, error: null });
    mockedUserService.getByAuthId.mockResolvedValue({
      id: VALID_UUID, authId: VALID_UUID, role: "guest", status: "confirmed",
    });

    const res = await testApp.request("/locations", { headers: { Authorization: MOCK_JWT } });
    expect(res.status).toBe(403);

    const body: any = await res.json();
    expect(body.error.code).toBe("FORBIDDEN_ROLE");
    expect(body.error.message).toMatch(/only available to: admin/);
  });
```

**Accept.**
- `GET /locations` declares 401, 403, 500.
- Both error tests assert `error.code` (not just status).
- A validation failure on `POST /locations` returns `details[0].field` starting with `body.`.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 5.2 — Assets

**Touch.** Create `src/modules/assets/assets.errors.ts`; edit `assets.contract.ts`,
`assets.route.ts`, `assets.test.ts`.

**Do.** `assets.errors.ts`:

```ts
export const assetErrors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "ASSET_NOT_FOUND" as const,
      description: "Asset does not exist.",
      message: "Asset does not exist.",
    },
    typeInvalid: {
      status: 400 as const,
      code: "ASSET_TYPE_INVALID" as const,
      description: "The referenced asset type does not exist.",
      message: "The asset type you selected does not exist. Choose one from GET /assets/types.",
    },
    locked: {
      status: 409 as const,
      code: "ASSET_LOCKED" as const,
      description: "Asset is locked by an active reservation.",
      message: (ctx: { action: "update" | "delete" }) =>
        `This asset cannot be ${ctx.action === "delete" ? "deleted" : "changed"} because it is part ` +
        "of a shot for a reservation that is currently covered. Wait until that reservation is closed, " +
        "or remove the asset from the shot first.",
    },
  },
  StandardErrorSchema,
);
```

`assets.route.ts` — `deleteAssetRoute`'s fallback becomes
`throw assetErrors.notFound()` (replacing `new NotFoundException("Asset")`).

`assets.test.ts` — **delete the local `testApp.onError(...)` override at lines 89–100** and the now
unused `ConflictException` / `NotFoundException` / `HTTPException` imports, then strengthen the two
error tests:

```ts
    it("should return 409 with ASSET_LOCKED when deletion is blocked", async () => {
      mockAssertCanModifyAsset.mockRejectedValue(assetErrors.locked({ action: "delete" }));

      const res = await testApp.request(`/assets/${VALID_UUID}`, {
        method: "DELETE", headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error.code).toBe("ASSET_LOCKED");
      expect(body.error.message).toMatch(/cannot be deleted because/);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should return 404 with ASSET_NOT_FOUND", async () => {
      mockCheckExistence.mockRejectedValue(assetErrors.notFound());

      const res = await testApp.request(`/assets/${VALID_UUID}`, {
        method: "DELETE", headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("ASSET_NOT_FOUND");
    });
```

**Accept.**
- The local `onError` override is gone; 409/404 still asserted, now with codes.
- `DELETE /assets/{id}` declares `ASSET_LOCKED` and `ASSET_TYPE_INVALID` as appropriate.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 5.3 — Users

**Touch.** Create `src/modules/users/users.errors.ts`; edit `users.contract.ts`, `users.route.ts`,
`users.test.ts`.

**Do.** `users.errors.ts` declares `notFound` (404 `USER_NOT_FOUND`), `duplicate` (409
`DUPLICATE_RECORD`), `authProvider` (400 `AUTH_PROVIDER_ERROR`), `invitation` (400
`INVITATION_ERROR`).

`users.route.ts`:
- `inviteUserRoute` (lines 57–78): the `try/catch` that rethrows `BadRequestException(error.message,
  "INVITATION_ERROR")` leaks the upstream provider's text to the client. Replace with
  `throw userErrors.invitation({ driver: error.message })` — the message is fixed, the driver text
  goes to `meta.driver`.
- `updatePasswordRoute:97` — `throw new BadRequestException(authError.message, "AUTH_PROVIDER_ERROR")`
  becomes `throw userErrors.authProvider({ driver: authError.message })`.
- `updatePasswordRoute:88` — `throw new UnauthorizedException()` becomes
  `throw userErrors.unauthenticated()`.

> **Leak fixed here.** Today a Supabase error string is returned verbatim as the client-facing
> message. After this step the client sees a fixed sentence and the provider text is in `meta.driver`
> (absent in production).

`users.test.ts` — add one envelope assertion for the 404 path and one for 403; upgrade the existing
401/403/404/400 assertions to also check `error.code`.

**Accept.** No provider text can reach the client; `grep -n "authError.message\|error.message" src/modules/users/users.route.ts` shows them only inside `meta`.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 5.4 — Apartments

**Touch.** Create `src/modules/apartments/apartments.errors.ts`; edit `apartments.contract.ts`,
`apartments.route.ts`, `apartments.test.ts`.

**Do.** Declare `notFound` (404 `APARTMENT_NOT_FOUND`), `userNotFound` (404 `USER_NOT_FOUND`),
`locationNotFound` (404 `LOCATION_NOT_FOUND`), `maxPhotos` (400 `MAX_PHOTOS_EXCEEDED`, template over
`{ limit, count }`).

`apartments.route.ts` — replace `throw new NotFoundException("Apartment")` /
`new NotFoundException("User")` with the throwers. Note `getApartmentsByHostRoute` currently throws
`NotFoundException("User")` when the *authenticated* user has no row — that is a 403-shaped condition
in practice, but keeping 404 avoids leaking account existence. **Leave it as 404 `USER_NOT_FOUND`**
and note the decision in a comment.

`apartments.test.ts:168` and `:223` (404) and `:347` (401) — add `error.code` assertions.

**Accept.** Both 404 assertions carry codes; `POST /apartments` 404 declares
`USER_NOT_FOUND` + `LOCATION_NOT_FOUND` in one 404 entry.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 5.5 — Reservations

**Touch.** Create `src/modules/reservations/reservations.errors.ts`; edit
`reservations.contract.ts`, `reservations.route.ts`, `reservations.test.ts`.

**Do.** Declare `notFound` (404 `RESERVATION_NOT_FOUND`), `invalidRange` (400
`RESERVATION_INVALID_RANGE`), `overlap` (409 `RESERVATION_OVERLAP`).

`reservations.route.ts:44` — `throw new UnauthorizedException("Reservation")` becomes
`throw reservationErrors.unauthenticated()`. **This fixes the 401 that currently says
`"Reservation"`.**

`reservations.test.ts:291` (403), `:356` (404), `:439` (404) — add `error.code` assertions. The 403
is produced by `apartmentGuard`; assert `FORBIDDEN_APARTMENT_ACCESS`.

**Accept.** The 401 path no longer contains the word `"Reservation"` as its message.

**Verify.** `npx tsc --noEmit && npm run test`

---

### Step 5.6 — Apartment shots

**Touch.** Create `src/modules/apartment_shots/apartment_shots.errors.ts`; edit
`apartment_shots.contract.ts`, `apartment_shots.route.ts`, `apartment_shots.test.ts`.

**Do.** Declare `reservationNotFound` (404 `RESERVATION_NOT_FOUND`), `shotsLocked` (409
`APARTMENT_SHOTS_LOCKED`).

`apartment_shots.route.ts:28` — `` new NotFoundException(`Reservation with ID ${reservationId}`) ``
becomes `throw shotErrors.reservationNotFound({ id: reservationId })` (id into `meta`, not prose).

`apartment_shots.test.ts` — **delete the local `onError` override at lines 122–127** and its
`ConflictException` import; assert codes on the 401/400/409/400 assertions.

**Accept.** No local `onError` override remains in any test file.

**Verify.**
```bash
grep -rn "\.onError(" src/modules/*/*.test.ts   # expect nothing
npx tsc --noEmit && npm run test
```

---

### Step 5.7 — Inspections

**Touch.** Create `src/modules/inspections/inspections.errors.ts`; edit
`inspections.contract.ts`, `inspections.route.ts`, `inspections.test.ts`.

**Do.** Declare `notFound` (404 `INSPECTION_NOT_FOUND`), `reservationNotFound` (404
`RESERVATION_NOT_FOUND`), `alreadyExists` (409 `INSPECTION_ALREADY_EXISTS`), `flagAlreadyExists`
(409 `FLAG_ALREADY_EXISTS`).

`inspections.route.ts` — three fixes:

1. **Line 25** — `throw new UnauthorizedException("Inspection")` → `throw inspectionErrors.unauthenticated()`.
2. **Lines 58–69** — the hand-built 404 envelope is the **only** place in the codebase that
   constructs the wire format outside the renderer. Replace the whole block with:

```ts
  if (!inspection) {
    throw inspectionErrors.notFound({ id });
  }
```

3. **Lines 86, 100** — `throw new NotFoundException("Inspection")` → `throw inspectionErrors.notFound({ id })`.

`inspections.test.ts:262` — this test currently asserts 404 against the hand-built body. After the
change it must assert the renderer's envelope:

```ts
      expect(res.status).toBe(404);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("INSPECTION_NOT_FOUND");
      expect(body.error.message).toBe("Inspection does not exist.");
```

**Accept.**
- `grep -rn "success: false" src/ --include=*.ts` returns **only** `error.handler.ts`.
- `GET /inspections/{id}` returns 404 with `INSPECTION_NOT_FOUND`.

**Verify.**
```bash
grep -rn "success: false" src/ --include=*.ts
npx tsc --noEmit && npm run test
```

---

### Step 5.8 — Remove the step-1.3 legacy overloads

**Goal.** The migration bridge is gone; the options-object form is the only way to construct an
exception, so no future call site can fall back to a string.

**Touch.** `src/core/errors/error.exceptions.ts`.

**Do.** Delete the `constructor(message: string);` overloads and the `typeof arg === "string"`
branches added in step 1.3, restoring the five subclasses to the clean single-signature form:

```ts
export class BadRequestException extends AppError {
  constructor(opts: AppErrorOptions) { super(400, opts); }
}
// …and likewise for Unauthorized/Forbidden/NotFound/Conflict.
```

Then confirm nothing regressed:

```bash
npx tsc --noEmit
```

Any error here is a call site the migration missed — fix it, do not re-add the overload.

**Accept.**
- `grep -rn "constructor(message: string)" src/core/errors/` → nothing.
- `grep -rn "new (NotFoundException|ConflictException|BadRequestException|UnauthorizedException|ForbiddenException)(\"" src/` → nothing.
- Typecheck clean, suite green.

**Verify.**
```bash
npx tsc --noEmit && npm run test
grep -rnE "new (NotFoundException|ConflictException|BadRequestException|UnauthorizedException|ForbiddenException)\(\"" src/ --include=*.ts   # expect nothing
```

> **This step must come after 5.1 – 5.7.** Those steps migrate the five test files that construct
> exceptions directly (`assets.test.ts`, `apartments.test.ts`, `inspections.test.ts`,
> `reservations.test.ts`, `apartment_shots.test.ts`). Running this step earlier breaks the suite.

---

## 6. Persistence — the DB layer

### Step 6.1 — Extract the SQLSTATE map

**Goal.** The SQLSTATE table is a named, testable module rather than an inline object.

**Touch.** Create `src/core/errors/error.mapper.ts`; have `error.handler.ts` import from it.

**Do.** Move `findSqlState` and `SQLSTATE_MAP` out of `error.handler.ts` into `error.mapper.ts`,
exporting `mapPersistenceError(err): { status, code, message, meta } | null`. Keep `toErrorResponse`
calling it as branch 2. This is a pure refactor — no behaviour change.

**Accept.** `toErrorResponse` is unchanged behaviourally; step 1.7's tests still pass untouched.

**Verify.** `npm run test`

---

### Step 6.2 — Constraint-name overrides

**Goal.** The constraints a client can actually hit produce messages better than the SQLSTATE
default, and the names come from the real migrations.

**Touch.** `src/core/errors/error.mapper.ts`.

**Do.** Add the override registry. The names below were read from `drizzle/*.sql`, so they are the
actual database-level identifiers:

```ts
/**
 * Constraint-name overrides. Checked before the SQLSTATE default.
 * Names verified against drizzle/*.sql.
 */
const CONSTRAINT_MESSAGES: Record<string, { code: ErrorCode; message: string }> = {
  // Unique (SQLSTATE 23505)
  users_email_unique: {
    code: "DUPLICATE_RECORD",
    message: "A user with this email address already exists.",
  },
  users_auth_id_unique: {
    code: "DUPLICATE_RECORD",
    message: "This account is already linked to a user.",
  },
  asset_types_code_unique: {
    code: "DUPLICATE_RECORD",
    message: "An asset type with this code already exists.",
  },
  apartment_images_storage_key_unique: {
    code: "DUPLICATE_RECORD",
    message: "This photo has already been uploaded.",
  },
  apartment_shot_assets_shot_id_asset_id_pk: {
    code: "DUPLICATE_RECORD",
    message: "This asset is already linked to this shot.",
  },
  inspection_flag_assets_flag_id_asset_id_pk: {
    code: "DUPLICATE_RECORD",
    message: "This asset is already linked to this flag.",
  },

  // Foreign keys (SQLSTATE 23503)
  assets_asset_type_id_asset_types_id_fk: {
    code: "ASSET_TYPE_INVALID",
    message: "The asset type you selected does not exist. Choose one from GET /assets/types.",
  },
  apartments_owner_users_id_fk: {
    code: "USER_NOT_FOUND",
    message: "The selected owner does not exist.",
  },
  apartments_location_locations_id_fk: {
    code: "LOCATION_NOT_FOUND",
    message: "The selected location does not exist.",
  },
};
```

> **`assets_asset_type_id_asset_types_id_fk` is the important one.** It is the only `RESTRICT`
> foreign key in the schema, so it is the one a client can realistically trip: deleting an
> `asset_type` that assets still reference, or inserting an asset with a stale type id. Without this
> override it surfaces as a generic `RELATED_RECORD_INVALID`; with it, the client is told exactly
> what to do.

**Accept.**
- A `23503` on `assets_asset_type_id_asset_types_id_fk` → 400 `ASSET_TYPE_INVALID` with the
  actionable message.
- A `23505` on `users_email_unique` → 409 with `"A user with this email address already exists."`
- An unmapped constraint still falls through to its SQLSTATE default.

**Verify.** `npm run test`

---

### Step 6.3 — Test the persistence branch

**Goal.** The cause-chain unwrapping and both mapping layers are pinned by tests, using fakes that
mirror Drizzle's real wrapping.

**Touch.** `src/core/errors/error.mapper.test.ts`.

**Do.** The fakes must reproduce the real shape — verified against
`node_modules/drizzle-orm/errors.d.ts` and `node_modules/postgres/types/index.d.ts`:

```ts
/** DrizzleQueryError(query, params, cause) — cause is the driver error. */
class FakeDrizzleQueryError extends Error {
  constructor(public query: string, public params: any[], public cause?: Error) {
    super(`Failed query: ${query}\nparams: ${params}`);
  }
}
/** postgres-js PostgresError carries `code` (SQLSTATE) and `constraint_name`. */
class FakePostgresError extends Error {
  constructor(public code: string, public constraint_name?: string, message = "driver message") {
    super(message);
  }
}
```

Cases to cover:

| Case | Expect |
| --- | --- |
| `23505` + `users_email_unique`, wrapped | 409 `DUPLICATE_RECORD`, message `"A user with this email address already exists."`, `meta.driver` present in non-prod |
| `23503` + `assets_asset_type_id_asset_types_id_fk`, wrapped | 400 `ASSET_TYPE_INVALID`, message mentions `GET /assets/types` |
| `23503` + an unmapped FK | 409 `RELATED_RECORD_INVALID` |
| `23502` | 400 `MISSING_REQUIRED_FIELD` |
| `22P02` (bad uuid) | 400 `INVALID_IDENTIFIER` |
| `22007` / `22008` | 400 `INVALID_DATETIME` |
| `23505` unwrapped (no `DrizzleQueryError` wrapper) | still maps — the walker must not require the wrapper |
| `code` three levels deep under `cause` | still maps |
| non-Error thrown (`null`, `"str"`, `{}`) | 500, no crash |
| production `NODE_ENV` | `meta` absent entirely |

**Accept.** All cases pass; the raw driver message appears only under `meta.driver`.

**Verify.** `npx vitest run src/core/errors/error.mapper.test.ts`

---

## 7. Guardrails — make the rules mechanical

### Step 7.1 — Lint rule: no hand-built error JSON

**Goal.** A new `c.json({ success: false, … })` outside the renderer fails lint.

**Touch.** `eslint.config.js`.

**Do.** Add a `no-restricted-syntax` rule for object literals containing a `success: false`
property, scoped away from `src/core/errors/error.handler.ts`:

```js
{
  files: ["src/**/*.ts"],
  ignores: ["src/core/errors/error.handler.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          "Property[key.name='success'][value.value=false]",
        message:
          "Do not hand-build an error envelope. Throw a typed exception; the renderer builds the body. See docs/errorHandle.md §3.",
      },
    ],
  },
}
```

**Accept.** Introducing `return c.json({ success: false, error: {} }, 400)` in a route fails
`npm run lint`; the existing tree passes.

**Verify.** `npm run lint`

---

### Step 7.2 — Lint rule: no bare `new Error(` in src

**Goal.** Opaque errors cannot be reintroduced.

**Touch.** `eslint.config.js`.

**Do.** Add `no-restricted-syntax` for `NewExpression[callee.name='Error']` with the message
*"Use a typed exception (BadRequestException/NotFoundException/…) with a registry code. See
docs/errorHandle.md §4.5."* Exempt `src/core/errors/**` and `*.test.ts`.

**Accept.** `npm run lint` passes; a `throw new Error("x")` in a route fails.

**Verify.** `npm run lint`

---

### Step 7.3 — Envelope-shape test helper

**Goal.** Asserting the envelope is one line, so tests do it consistently.

**Touch.** Create `src/core/utils/assert-error.ts` (test-only helper).

**Do.**

```ts
import { expect } from "vitest";

/**
 * Asserts the canonical error envelope.
 * Usage: await expectError(res, 409, "ASSET_LOCKED", /cannot be deleted/);
 */
export const expectError = async (
  res: Response,
  status: number,
  code: string,
  messagePattern?: RegExp,
) => {
  expect(res.status).toBe(status);
  const body: any = await res.json();

  expect(body.success).toBe(false);
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe("string");
  // Messages are product copy: no status prefix, no raw internals.
  expect(body.error.message).not.toMatch(/^(Not Found|Conflict|Bad Request|Forbidden|Unauthorized):/);
  expect(body.error.message).not.toMatch(/\b(SELECT|INSERT|UPDATE|DELETE|constraint|relation|column)\b/i);

  if (messagePattern) expect(body.error.message).toMatch(messagePattern);
  return body;
};
```

**Accept.** Used by at least the phase-5 tests.

**Verify.** `npm run test`

---

### Step 7.4 — Final sweep

**Goal.** Confirm the migration is complete and nothing was left behind.

**Touch.** Nothing (verification only). The step-1.3 overloads were already removed in step 5.8.

**Do.** Run the checks below. Each must be empty/clean.

```bash
# 1. No hand-built error envelopes outside the renderer
grep -rn "success: false" src/ --include=*.ts        # only src/core/errors/error.handler.ts

# 2. No guards/middleware formatting their own responses
grep -rn "c.json" src/middleware/                     # nothing

# 3. No legacy exception call sites
grep -rn "constructor(message: string)" src/core/errors/   # nothing (overloads gone in 5.8)
grep -rn "getStandardResponses\|commonErrors" src/    # nothing

# 4. No opaque errors
grep -rn "new Error(" src/ --include=*.ts             # only intentional, if any

# 5. No test-local error handlers
grep -rn "\.onError(" src/modules/*/*.test.ts         # nothing

# 6. The legacy helper is gone
ls src/core/errors/error.helpers.ts                   # No such file

# 7. Everything green
npx tsc --noEmit && npm run lint && npm run test
```

Then verify the OpenAPI document declares 403 wherever a role or apartment guard runs:

```bash
npx tsx --env-file=.env -e "import app from './src/index'; (async () => { const d = await (await app.request('/openapi.json')).json(); let missing = 0; for (const [p, ops] of Object.entries<any>(d.paths)) for (const [m, op] of Object.entries<any>(ops)) if (!('500' in op.responses)) { console.log('MISSING 500:', m, p); missing++; } console.log(missing === 0 ? 'OK: every route declares 500' : missing + ' routes missing 500'); })();"
```

**Accept.** All seven greps behave as annotated; typecheck, lint, and tests are green; every route
declares 500.

**Verify.** The block above.

---

## 8. Definition of done

The migration is complete when, for every endpoint:

- [ ] The contract declares every status its middleware chain and handler can produce.
- [ ] Every error `code` appears in `ERROR_REGISTRY`; no code literal exists outside `*.errors.ts`
      and `error.codes.ts`.
- [ ] No file outside `src/core/errors/error.handler.ts` constructs the envelope.
- [ ] No guard or middleware calls `c.json` for an error.
- [ ] No message contains a status prefix, SQL, a table/column name, or a raw id.
- [ ] Every code in the registry has at least one test asserting `status`, `error.code`, and a
      human-readable `error.message`.
- [ ] One validation test per module asserts a fully-qualified `details[].field`.
- [ ] A DB constraint violation maps through `error.mapper.ts` and never leaks driver text.

---

## 9. Known constraints and decisions

These are the non-obvious facts this plan is built on. They were verified against the installed
dependencies and the running code, not assumed.

1. **Validation issues arrive one target at a time.** `zValidator` validates params → query →
   headers → cookies → body and **returns immediately** on the first failure
   (`@hono/zod-validator` `zValidatorFunction`). So `defaultHook` never sees issues from two targets
   in one call, and `formatValidationError` must use `result.target` to pick the field prefix. A
   request that fails both a query and a body rule reports only the query problem, then the body
   problem on retry. This is inherent to the library; do not promise aggregated multi-target errors.

2. **`ErrorSpec` must be generic in its context type.** Constraining on
   `Record<string, ErrorSpec>` makes a template typed as `(ctx: { action: string }) => string`
   non-assignable. Use `ErrorSpec<any>` at the constraint.

3. **Use `z.ZodType<unknown>`, not `ZodType`.** `ZodType` is not re-exported from
   `@hono/zod-openapi`; the `z` namespace is.

4. **OpenAPI allows one response object per status.** Codes sharing a status are merged into one
   entry with every code named in the description and the first used as the example
   (`responsesForCodes`).

5. **`HTTPException` must stay handled.** Hono's own router throws `HTTPException` (e.g. 405), and
   the rulebook's §2 row 1 explicitly assigns it to the `onError` branch. Step 1.4's `toErrorResponse`
   handles it as branch 2: `405` maps to `METHOD_NOT_ALLOWED`, any other status to `HTTP_ERROR`. The
   `res` property is **not** re-wrapped (it is a `Response` object, not a status) — only the status
   and message are read. Without this branch a legitimate 405 becomes a 500.

6. **`RESERVATION_INVALID_RANGE` changes 409 → 400.** A reversed date range is a malformed request,
   not a conflict with stored state. Call this out in the PR.

7. **`apartmentGuard`'s 400 → 403 change.** A missing or unconfirmed user account is an
   authorization failure, not a malformed request.

8. **`getUserByAuthIdRoute` is defined but never mounted** (`users.contract.ts:63`, not referenced in
   `index.ts`). Either mount it or delete it — but do not leave it declaring error responses nothing
   serves. Out of scope for this plan; noted so it is a conscious choice.

9. **`locations` has no unique constraints** (only a primary key), so `POST /locations` can only
   fail on validation — hence no 409 in its bundle.

10. **Foreign keys have four distinct delete behaviours** (verified against `drizzle/*.sql`), and
    that is what decides which ones a client can trip:

    | Behaviour | Constraints |
    | --- | --- |
    | `CASCADE` | `apartment_images_*`, `apartment_shots_apartment_id_*`, `apartment_shot_assets_*`, `assets_apartment_id_*`, `reservations_apartment_id_*`, `inspections_reservation_id_*`, `inspection_flag_assets_*`, `inspection_flags_inspection_id_*` |
    | `NO ACTION` | `apartments_owner_users_id_fk`, `apartments_location_locations_id_fk` |
    | `SET NULL` | `inspection_flags_shot_id_*`, `inspection_flags_reported_by_user_id_*`, `inspection_flags_resolved_by_user_id_*` |
    | `RESTRICT` | `assets_asset_type_id_asset_types_id_fk` |

    `CASCADE` and `SET NULL` delete paths cannot raise `23503` for a client, so only the
    `NO ACTION` and `RESTRICT` constraints are worth a bespoke message — which is why exactly those
    three appear in `CONSTRAINT_MESSAGES` in step 6.2.

11. **`locations` really has no unique constraint** (primary key only, verified in
    `drizzle/0000_great_darwin.sql:22-28` and in the Drizzle schema), so `POST /locations` has no
    409 in its bundle. The four unique constraints that exist are `users_email_unique`,
    `users_auth_id_unique`, `asset_types_code_unique`, and `apartment_images_storage_key_unique`,
    plus the two composite primary keys `apartment_shot_assets_shot_id_asset_id_pk` and
    `inspection_flag_assets_flag_id_asset_id_pk`.

12. **`responsesForCodes` must keep literal status keys.** It returns
    `ErrorResponsesFor<C>` — `{ [S in StatusFor<C[number]>]: … }` — not `Record<number, …>`.
    `createRoute` derives the handler's permitted status codes from `keyof R["responses"]`, and a
    `Record<number, …>` index signature erases them, so any handler that `return c.json(body, 404)`
    fails to typecheck against a contract that declares 404. This surfaced in step 3.2 on
    `getInspectionByIdRoute` (the only handler returning an error status inline; step 5.7 turns it
    into a `throw`). Do not "simplify" the mapped type back to `Record<number, …>`, and do not
    widen `errorResponses`' `codes` parameter to `readonly ErrorCode[]` — the `const` type parameter
    is what preserves the literals.
