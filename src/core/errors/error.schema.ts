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