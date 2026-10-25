import { describe, it, expect } from "vitest";
import { createRoute, z } from "@hono/zod-openapi";
import { createTestApp } from "./test-factory";
import { createModuleApp } from "./module-app";
import type { ErrorEnvelope } from "@/core/errors/error.schema";

const echoRoute = createRoute({
  method: "post",
  path: "/echo",
  request: {
    body: {
      content: {
        "application/json": { schema: z.object({ name: z.string() }) },
      },
    },
  },
  responses: {
    201: { description: "Created" },
  },
});

const moduleApp = createModuleApp();

moduleApp.openapi(echoRoute, async (c) => c.json(c.req.valid("json"), 201));

const testApp = createTestApp();
testApp.route("/thing", moduleApp);

const submit = (body: unknown) =>
  testApp.request("/thing/echo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("createModuleApp", () => {
  it("renders a contract validation failure as the canonical envelope", async () => {
    const res = await submit({ name: 42 });

    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorEnvelope;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/failed validation/);
    expect(body.error.details?.[0]?.field).toBe("body.name");
  });

  it("never surfaces Zod's own error payload", async () => {
    const body = (await (await submit({ name: 42 })).json()) as ErrorEnvelope & { error: { name?: string } };

    // Without a defaultHook, zValidator answers `c.json(result, 400)` — a raw ZodError.
    expect(body.error.name).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/ZodError|invalid_type|expected string/);
  });
});
