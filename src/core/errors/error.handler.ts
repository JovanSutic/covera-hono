import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z, type OpenAPIHonoOptions } from "@hono/zod-openapi";
import type { App } from "@/types";
import { HTTPException } from "hono/http-exception";
import { AppError } from "./error.exceptions";
import { ERROR_REGISTRY, type ErrorCode } from "./error.codes";
import { mapPersistenceError } from "./error.mapper";
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

/**
 * The one contract-validation hook. Every `OpenAPIHono` instance must be constructed with this
 * as its `defaultHook` — `zValidator` falls back to `c.json(result, 400)` when the hook is
 * missing, which leaks raw Zod text to the client.
 *
 * NOTE: `defaultHook` is inherited by `basePath()` and passed along by `.route()`, but it is
 * read off `this.defaultHook` at the time `app.openapi()` is called. A sub-app created without
 * it therefore validates with NO hook, regardless of the parent's configuration. Hence
 * `createModuleApp()` — see `@/core/utils/module-app`.
 */
export const validationHook: NonNullable<
  OpenAPIHonoOptions<App>["defaultHook"]
> = (result, c) => {
  if (!result.success) {
    const { status, body } = formatValidationError(result);
    return c.json(body, status);
  }
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
  const mapped = mapPersistenceError(err);
  if (mapped) {
    return {
      status: mapped.status,
      body: renderError({
        code: mapped.code,
        message: mapped.message,
        status: mapped.status,
        meta: mapped.meta,
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