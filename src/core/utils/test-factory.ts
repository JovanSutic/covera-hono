import { OpenAPIHono } from "@hono/zod-openapi";
import { App } from "@/types";
import { 
  NotFoundException, 
  UnauthorizedException, 
  BadRequestException 
} from "@/core/errors/error.exceptions";
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
        return c.json({ message: "Validation Error" }, 400);
      }
    },
  });

  app.onError((err, c) => {
    if (err instanceof NotFoundException) {
      return c.json({ message: err.message || "Resource not found" }, 404);
    }
    if (err instanceof UnauthorizedException) {
      return c.json({ message: "Unauthorized" }, 401);
    }
    if (err instanceof BadRequestException) {
      return c.json({ message: err.message }, 400);
    }

    console.error("Unhandled test server crash trace:", err);
    return c.json({ message: "Internal Server Error" }, 500);
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
