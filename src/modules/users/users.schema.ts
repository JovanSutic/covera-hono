import { z } from "@hono/zod-openapi";

import { SelectUserSchema } from "@/db";

export const UserSchema = SelectUserSchema.openapi("User");

export const GetUsersResponseSchema = z.array(UserSchema);

export const CreateUserSchema = z
  .object({
    email: z.email(),

    firstName: z.string().min(1),

    lastName: z.string().min(1),

    role: z.enum(["admin", "host", "guest"]),
  })
  .openapi("CreateUser");

export const UpdatePasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters long")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain at least one special character",
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const GetUsersQuerySchema = z.object({
  search: z
    .string()
    .optional()
    .transform((val) => (val === "" ? undefined : val))
    .openapi({
      param: { name: "search", in: "query" },
      description: "Search by first name, last name, or email",
      example: "John",
    }),
  role: z
    .enum(["admin", "host", "guest"])
    .optional()
    .openapi({
      param: { name: "role", in: "query" },
      description: "Filter users by system access role",
    }),
  status: z
    .enum(["created", "invited", "confirmed", "disabled"])
    .optional()
    .openapi({
      param: { name: "status", in: "query" },
      description: "Filter users by status",
    }),
});

export type GetUsersQueryInput = z.infer<typeof GetUsersQuerySchema>;

export const UpdatePasswordResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const ErrorResponseSchema = z.object({
  message: z.string(),
});
