import { OpenAPIHono } from "@hono/zod-openapi";
import { App } from "@/types";
import { formatValidationError, renderError, toErrorResponse } from "@/core/errors/error.handler";
import { vi } from "vitest";

vi.mock("@/modules/users/users.service", () => ({
  usersService: {
    getByAuthId: vi.fn().mockResolvedValue({
      id: "550e8400-e29b-41d4-a716-446655440000",
      authId: "550e8400-e29b-41d4-a716-446655440000",
      role: "admin",
      status: "confirmed",
    }),
  },
}));

interface TestAppConfig {
  contextOverrides?: (c: any) => Record<string, any>;
}

export function createTestApp(config: TestAppConfig = {}) {
  const app = new OpenAPIHono<App>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const { status, body } = formatValidationError(result as any);
        return c.json(body, status);
      }
    },
  });

  app.onError((err, c) => {
    const { status, body } = toErrorResponse(err);
    if (status >= 500) console.error("[Test Unhandled Error]", err);
    return c.json(body, status);
  });

  app.notFound((c) => {
    const body = renderError({
      code: "ROUTE_NOT_FOUND",
      message: `Route ${c.req.method} ${c.req.path} does not exist.`,
      status: 404,
    });
    return c.json(body, 404);
  });

  app.use("*", async (c, next) => {
    c.set("db", {} as any);

    const activeOverrides = config.contextOverrides ? config.contextOverrides(c) : {};

    Object.keys(activeOverrides).forEach((key) => {
      if (key !== "getUser" && key !== "updateUserById") {
        c.set(key as any, activeOverrides[key]);
      }
    });

    c.set("supabase", {
      auth: {
        getUser: activeOverrides.getUser || (() => Promise.resolve({ data: { user: null }, error: null })),
        admin: {
          updateUserById: activeOverrides.updateUserById || (() => Promise.resolve({ data: {}, error: null })),
        },
      },
    } as any);

    await next();
  });

  return app;
}