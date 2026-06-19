import { createRoute, z } from "@hono/zod-openapi";
import {
  GetUsersResponseSchema,
  UserSchema,
  CreateUserSchema,
  UpdatePasswordSchema,
  UpdatePasswordResponseSchema,
} from "./users.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";
import { commonErrors } from "@/core/errors/error.helpers";

const userErrors = commonErrors.getStandardResponses("User");

export const getUsersRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Users"],
  middleware: [authGuard, rolesGuard(["admin"])] as const,
  responses: {
    200: {
      description: "Get all users",

      content: {
        "application/json": {
          schema: GetUsersResponseSchema,
        },
      },
      ...userErrors,
    },
  },
});

export const getUserByIdRoute = createRoute({
  method: "get",
  path: "/:id",
  tags: ["Users"],
  middleware: [authGuard] as const,
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
    ...userErrors,
  },
});

export const getUserByAuthIdRoute = createRoute({
  method: "get",
  path: "/auth/:authId",
  tags: ["Users"],
  middleware: [authGuard] as const,
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
    ...userErrors,
  },
});

export const createUserRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Users"],
  middleware: [authGuard, rolesGuard(["admin"])] as const,
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
    ...userErrors,
  },
});

export const inviteUserRoute = createRoute({
  method: "post",
  path: "/:id/invite",
  tags: ["Users"],
  middleware: [authGuard, rolesGuard(["admin"])] as const,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: {
      description: "Invitation link generated and dispatched successfully",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
    },
    ...userErrors,
  },
});

export const updatePasswordRoute = createRoute({
  method: "post",
  path: "/update-password",
  middleware: [authGuard] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: UpdatePasswordSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Password changed and synchronization status completed.",
      content: {
        "application/json": {
          schema: UpdatePasswordResponseSchema,
        },
      },
    },
    ...userErrors,
  },
});
