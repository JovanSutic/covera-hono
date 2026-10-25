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