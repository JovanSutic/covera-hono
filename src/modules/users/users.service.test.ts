import { describe, it, expect, vi, beforeEach } from "vitest";
import { usersService } from "./users.service";
import { toErrorResponse } from "@/core/errors/error.handler";
import { expectError } from "@/core/utils/assert-error";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

const asResponse = async (fn: () => Promise<unknown>): Promise<Response> => {
  let thrown: unknown;
  let didThrow = false;
  try {
    await fn();
  } catch (e) {
    thrown = e;
    didThrow = true;
  }
  if (!didThrow) throw new Error("expected the call to throw, but it did not");

  const { status, body } = toErrorResponse(thrown);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

const newUserInput = {
  email: "new@example.com",
  firstName: "New",
  lastName: "User",
  role: "host" as const,
};

/**
 * `usersService.create` deletes the auth user in a catch block, so the stub must
 * expose every admin method the happy and failure paths touch.
 */
const supabaseStub = (overrides: Record<string, unknown> = {}) => {
  const admin = {
    createUser: vi.fn().mockResolvedValue({ data: { user: { id: VALID_UUID } }, error: null }),
    inviteUserByEmail: vi.fn().mockResolvedValue({ data: { user: { id: VALID_UUID } }, error: null }),
    deleteUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  };
  return { auth: { admin } } as any;
};

describe("usersService.create", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 AUTH_PROVIDER_ERROR when the provider rejects the request", async () => {
    const supabase = supabaseStub({
      createUser: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "Supabase: 422 email_address_invalid" },
      }),
    });

    const res = await asResponse(() =>
      usersService.create({} as any, supabase, newUserInput),
    );

    const body = await expectError(res, 400, "AUTH_PROVIDER_ERROR",
      /could not be created with the authentication provider/);

    expect(body.error.meta.provider).toBe("supabase");
    expect(body.error.meta.driver).toBe("Supabase: 422 email_address_invalid");
    // The upstream text must never be the client-facing copy.
    expect(body.error.message).not.toContain("email_address_invalid");
  });

  it("treats a missing user in a successful response as a provider failure", async () => {
    const supabase = supabaseStub({
      createUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    });

    await expectError(await asResponse(() => usersService.create({} as any, supabase, newUserInput)),
      400, "AUTH_PROVIDER_ERROR");
  });
});

describe("usersService.invite", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when the user row does not exist", async () => {
    const db = { select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) } as any;

    await expect(usersService.invite(db, supabaseStub(), VALID_UUID)).resolves.toBeNull();
  });

  it("returns 400 INVITATION_ERROR and keeps the driver text out of the message", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ id: VALID_UUID, email: "host@example.com" }]),
        }),
      }),
    } as any;

    const supabase = supabaseStub({
      inviteUserByEmail: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { message: "Supabase: 429 rate limit exceeded" },
      }),
    });

    const res = await asResponse(() => usersService.invite(db, supabase, VALID_UUID));

    const body = await expectError(res, 400, "INVITATION_ERROR",
      /invitation email could not be sent/);

    expect(body.error.meta.driver).toBe("Supabase: 429 rate limit exceeded");
    expect(body.error.message).not.toContain("rate limit");
  });
});
