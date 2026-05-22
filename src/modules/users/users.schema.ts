import { z } from "@hono/zod-openapi";

export const UserRoleSchema = z.enum(["admin", "host", "guest"]);

export const UserSchema = z.object({
  id: z.string().openapi({
    example: "usr_123",
  }),

  email: z.string().email().openapi({
    example: "john@example.com",
  }),

  roles: z.array(UserRoleSchema).openapi({
    example: ["host"],
  }),
});

export const GetUsersResponseSchema = z.array(UserSchema);
