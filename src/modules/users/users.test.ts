import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../../index";

vi.mock("../../modules/users/users.service", () => ({
  usersService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
  },
}));

import { usersService } from "../../modules/users/users.service";

const mockedService = usersService as unknown as {
  getAll: ReturnType<typeof vi.fn>;
  getById: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("Users routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /users should return all users", async () => {
    mockedService.getAll.mockReturnValue([
      {
        id: VALID_UUID,
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        roles: ["guest"],
        status: "created",
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await app.request("/users");

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(VALID_UUID);
    expect(data[0].email).toBe("john@example.com");
  });

  it("GET /users/:id should return single user", async () => {
    mockedService.getById.mockReturnValue({
      id: VALID_UUID,
      email: "john@example.com",
      firstName: "John",
      lastName: "Doe",
      roles: ["guest"],
      status: "created",
      createdAt: new Date().toISOString(),
    });

    const res = await app.request(`/users/${VALID_UUID}`);

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(data.id).toBe(VALID_UUID);
    expect(data.email).toBe("john@example.com");
    expect(data.firstName).toBe("John");
  });

  it("GET /users/:id should return 404", async () => {
    mockedService.getById.mockReturnValue(null);

    const res = await app.request(`/users/${VALID_UUID}`);

    expect(res.status).toBe(404);

    const data = await res.json();

    expect(data.message).toBe("User not found");
  });

  it("POST /users should create a user", async () => {
    const input = {
      email: "john@example.com",
      firstName: "John",
      lastName: "Doe",
      role: "guest",
    };

    mockedService.create.mockReturnValue({
      id: VALID_UUID,
      ...input,
      roles: [input.role],
      status: "created",
      createdAt: new Date().toISOString(),
    });

    const res = await app.request("/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(201);

    const data = await res.json();

    expect(data.id).toBe(VALID_UUID);
    expect(data.email).toBe("john@example.com");
    expect(data.firstName).toBe("John");
    expect(data.lastName).toBe("Doe");
    expect(data.roles).toContain("guest");
  });
});