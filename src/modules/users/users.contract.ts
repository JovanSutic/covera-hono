import { createRoute, z } from "@hono/zod-openapi";
import {
  GetUsersResponseSchema,
  UserSchema,
  CreateUserSchema,
  UpdatePasswordSchema,
  UpdatePasswordResponseSchema,
  ErrorResponseSchema,
} from "./users.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";

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

export const inviteUserRoute = createRoute({
  method: "post",
  path: "/:id/invite",
  tags: ["Users"],
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
    404: { description: "User profile not found inside relational database" },
    400: { description: "Failed to generate security token wrapper link" },
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
    400: {
      description: "Bad Request: Passwords mismatch or schema payload issues.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    401: {
      description:
        "Unauthorized: Invalid, expired, or missing header bearer token.",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});
