import { describe, it, expect, vi, beforeEach } from "vitest";
import { usersService } from "../../modules/users/users.service";
import usersApp from "./users.route";
import { createTestApp } from "@/core/utils/test-factory";

vi.mock("../../modules/users/users.service", () => ({
  usersService: {
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    invite: vi.fn(),
    getByAuthId: vi.fn(),
    updateStatusByAuthId: vi.fn(),
  },
}));

const mockedService = usersService as unknown as {
  getAll: ReturnType<typeof vi.fn>;
  getById: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  invite: ReturnType<typeof vi.fn>;
  getByAuthId: ReturnType<typeof vi.fn>;
  updateStatusByAuthId: ReturnType<typeof vi.fn>;
};

const mockGetUser = vi.fn();
const mockUpdateUserById = vi.fn();

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const MOCK_JWT = "Bearer validation-mock-token-string";

const testApp = createTestApp({
  contextOverrides: () => ({
    getUser: mockGetUser,
    updateUserById: mockUpdateUserById,
  }),
});

testApp.route("/users", usersApp);

describe("Users routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupSuccessfulGuards = () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: VALID_UUID, email: "admin@example.com" } },
      error: null,
    });
    mockedService.getByAuthId.mockResolvedValue({
      id: VALID_UUID,
      authId: VALID_UUID,
      role: "admin",
      status: "confirmed",
    });
  };

  it("GET /users should return all users when authenticated as admin", async () => {
    setupSuccessfulGuards();

    mockedService.getAll.mockReturnValue([
      {
        id: VALID_UUID,
        email: "john@example.com",
        firstName: "John",
        lastName: "Doe",
        role: "guest",
        status: "confirmed",
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await testApp.request("/users", {
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
  });

  it("GET /users should correctly parse query parameters and pass them to the service", async () => {
    setupSuccessfulGuards();

    mockedService.getAll.mockReturnValue([
      {
        id: VALID_UUID,
        email: "host-jane@example.com",
        firstName: "Jane",
        lastName: "Smith",
        role: "host",
        status: "confirmed",
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await testApp.request("/users?role=host&search=Jane", {
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBe(1);
    expect(data[0].role).toBe("host");
  });

  it("GET /users should return 401 if token is missing", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Missing token"),
    });

    const res = await testApp.request("/users");
    expect(res.status).toBe(401);
  });

  it("GET /users should return 403 if user lacks admin/manager permissions or isn't confirmed", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: VALID_UUID } },
      error: null,
    });

    mockedService.getByAuthId.mockResolvedValue({
      id: VALID_UUID,
      authId: VALID_UUID,
      role: "guest",
      status: "confirmed",
    });

    const res = await testApp.request("/users", {
      headers: { Authorization: MOCK_JWT },
    });
    expect(res.status).toBe(403);
  });

  it("GET /users/:id should return single user", async () => {
    setupSuccessfulGuards();

    mockedService.getById.mockReturnValue({
      id: VALID_UUID,
      email: "john@example.com",
      firstName: "John",
      lastName: "Doe",
      role: "guest",
      status: "confirmed",
      createdAt: new Date().toISOString(),
    });

    const res = await testApp.request(`/users/${VALID_UUID}`, {
      headers: { Authorization: MOCK_JWT },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(VALID_UUID);
  });

  it("GET /users/:id should return 404", async () => {
    setupSuccessfulGuards();
    mockedService.getById.mockReturnValue(null);

    const res = await testApp.request(`/users/${VALID_UUID}`, {
      headers: { Authorization: MOCK_JWT },
    });
    expect(res.status).toBe(404);
  });

  it("POST /users should create a user", async () => {
    setupSuccessfulGuards();

    const input = {
      email: "john@example.com",
      firstName: "John",
      lastName: "Doe",
      role: "guest",
    };

    mockedService.create.mockReturnValue({
      id: VALID_UUID,
      ...input,
      status: "created",
      createdAt: new Date().toISOString(),
    });

    const res = await testApp.request("/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: MOCK_JWT,
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBe(VALID_UUID);
  });

  it("POST /users/:id/invite should dispatch invitation successfully", async () => {
    setupSuccessfulGuards();
    mockedService.invite.mockReturnValue({ success: true });

    const res = await testApp.request(`/users/${VALID_UUID}/invite`, {
      method: "POST",
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  it("POST /update-password should change credentials and return 200", async () => {
    setupSuccessfulGuards();

    mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
    mockedService.updateStatusByAuthId.mockResolvedValue({
      id: VALID_UUID,
      status: "confirmed",
    });

    const payload = {
      password: "StrongPassword123!",
      confirmPassword: "StrongPassword123!",
    };

    const res = await testApp.request("/users/update-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: MOCK_JWT,
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.message).toBe("Password updated successfully.");
  });

  it("POST /update-password should return 400 if passwords do not match", async () => {
    setupSuccessfulGuards();

    const payload = {
      password: "StrongPassword123!",
      confirmPassword: "DifferentPassword123!",
    };

    const res = await testApp.request("/users/update-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: MOCK_JWT,
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
  });

  it("POST /update-password should return 400 if password lacks complexity requirements", async () => {
    setupSuccessfulGuards();

    const payload = {
      password: "simple",
      confirmPassword: "simple",
    };

    const res = await testApp.request("/users/update-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: MOCK_JWT,
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
  });
});
