import { z } from "@hono/zod-openapi";

export const StandardErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string().openapi({ example: "VALIDATION_ERROR" }),
    message: z.string().openapi({ example: "The request parameters failed validation tests." }),
    details: z.array(
      z.object({
        field: z.string().openapi({ example: "body.password" }),
        message: z.string().openapi({ example: "Password must be at least 8 characters long." }),
      })
    ).optional(),
  }),
}).openapi("StandardError");
