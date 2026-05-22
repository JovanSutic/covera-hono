import { createRoute, z } from "@hono/zod-openapi";
import { GetUsersResponseSchema, UserSchema } from "./users.schema";

export const getUsersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Users"],

  responses: {
    200: {
      description: "Get all users",

      content: {
        "application/json": {
          schema: GetUsersResponseSchema,
        },
      },
    },
  },
});

export const getUserByIdRoute = createRoute({
  method: "get",
  path: "/{id}",

  tags: ["Users"],

  request: {
    params: z.object({
      id: z.string(),
    }),
  },

  responses: {
    200: {
      description: "Get user by id",

      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
    },

    404: {
      description: "User not found",
    },
  },
});