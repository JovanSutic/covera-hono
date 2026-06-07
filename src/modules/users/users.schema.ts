import { z } from "@hono/zod-openapi";

import {
  SelectUserSchema,
} from "@/db";

export const UserSchema =
  SelectUserSchema.openapi("User");

export const GetUsersResponseSchema =
  z.array(UserSchema);

export const CreateUserSchema = z.object({
  email: z.email(),

  firstName: z.string().min(1),

  lastName: z.string().min(1),

  role: z.enum(["admin", "host", "guest"]),
}).openapi("CreateUser");