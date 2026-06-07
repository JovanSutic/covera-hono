import { createRoute, z } from "@hono/zod-openapi";
import {
  GetUsersResponseSchema,
  UserSchema,
  CreateUserSchema,
} from "./users.schema";

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
  path: "/:id",

  tags: ["Users"],

  request: {
    params: z.object({
      id: z.uuid(),
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

export const getUserByAuthIdRoute = createRoute({
  method: "get",
  path: "/auth/:authId",
  tags: ["Users"],

  request: {
    params: z.object({
      authId: z.uuid(),
    }),
  },

  responses: {
    200: {
      description: "Get user by auth id",
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

export const createUserRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Users"],

  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateUserSchema,
        },
      },
    },
  },

  responses: {
    201: {
      description: "User created",
      content: {
        "application/json": {
          schema: UserSchema,
        },
      },
    },
  },
});
