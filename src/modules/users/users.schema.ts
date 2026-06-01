import { z } from "@hono/zod-openapi";

import { SelectUserSchema, InsertUserSchema } from "@/db";

export const UserSchema = SelectUserSchema.openapi("User");

export const GetUsersResponseSchema = z.array(UserSchema);

export const CreateUserSchema = InsertUserSchema.omit({
  id: true,
  createdAt: true,
}).openapi("CreateLocation");
