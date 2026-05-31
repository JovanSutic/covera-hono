import { z } from "@hono/zod-openapi";

import {
  SelectUserSchema,
} from "@/db";

export const UserSchema =
  SelectUserSchema.openapi("User");

export const GetUsersResponseSchema =
  z.array(UserSchema);