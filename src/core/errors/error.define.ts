import { z } from "@hono/zod-openapi";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ERROR_REGISTRY, type ErrorCode, type StatusFor } from "./error.codes";
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
 * The response map for a set of codes, keeping each status as a literal key.
 *
 * The literal keys matter: `createRoute` derives the handler's permitted status codes from
 * `keyof R["responses"]`. A `Record<number, …>` index signature erases them, so a handler
 * that returns (say) a 404 would fail to typecheck against a contract that declares it.
 */
export type ErrorResponsesFor<C extends readonly ErrorCode[]> = {
  [S in StatusFor<C[number]>]: ReturnType<typeof createErrorResponse>;
};

/**
 * Groups codes by status and builds one response entry per status.
 * Shared by `defineErrors` and the contract bundles in `error.responses.ts`.
 */
export function responsesForCodes<const C extends readonly ErrorCode[]>(
  codes: C,
  schema: z.ZodType<unknown>,
): ErrorResponsesFor<C> {
  const byStatus = new Map<ContentfulStatusCode, ErrorCode[]>();
  for (const code of codes) {
    const status = ERROR_REGISTRY[code].status;
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  return Object.fromEntries(
    [...byStatus.entries()].map(([status, list]) => [status, createErrorResponse(list, schema)]),
  ) as ErrorResponsesFor<C>;
}