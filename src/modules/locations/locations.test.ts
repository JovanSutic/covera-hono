import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory"; 
import locationsApp from "./locations.route"; 
import { locationsService } from "../../modules/locations/locations.service";
import { usersService } from "../../modules/users/users.service";

vi.mock("../../modules/locations/locations.service", () => ({
  locationsService: {
    getAll: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../modules/users/users.service", () => ({
  usersService: {
    getByAuthId: vi.fn(),
  },
}));

const mockedLocationService = locationsService as unknown as {
  getAll: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

const mockedUserService = usersService as unknown as {
  getByAuthId: ReturnType<typeof vi.fn>;
};

const mockGetUser = vi.fn();

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const MOCK_JWT = "Bearer validation-mock-token-string";

const testApp = createTestApp({
  contextOverrides: () => ({
    getUser: mockGetUser,
  }),
});

testApp.route("/locations", locationsApp);

describe("Locations routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupSuccessfulGuards = () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: VALID_UUID, email: "admin@example.com" } },
      error: null,
    });
    mockedUserService.getByAuthId.mockResolvedValue({
      id: VALID_UUID,
      authId: VALID_UUID,
      role: "admin",
      status: "confirmed",
    });
  };

  it("GET /locations should return all locations when authenticated as admin", async () => {
    setupSuccessfulGuards();
    
    mockedLocationService.getAll.mockReturnValue([
      {
        id: VALID_UUID,
        name: "Rome",
        country: "Italy",
        type: "city",
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await testApp.request("/locations", {
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(200);

    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0].id).toBe(VALID_UUID);
    expect(data[0].name).toBe("Rome");
  });

  it("GET /locations should return 401 if token is missing", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Missing token"),
    });

    const res = await testApp.request("/locations");
    expect(res.status).toBe(401);
  });

  it("GET /locations should return 403 if user lacks admin permissions", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: VALID_UUID } },
      error: null,
    });

    mockedUserService.getByAuthId.mockResolvedValue({
      id: VALID_UUID,
      authId: VALID_UUID,
      role: "guest",
      status: "confirmed",
    });

    const res = await testApp.request("/locations", {
      headers: { Authorization: MOCK_JWT },
    });
    expect(res.status).toBe(403);
  });

  it("POST /locations should create a new location", async () => {
    setupSuccessfulGuards();

    const input = {
      name: "Rome",
      country: "Italy",
      type: "city",
    };

    mockedLocationService.create.mockReturnValue({
      id: VALID_UUID,
      ...input,
      createdAt: new Date().toISOString(),
    });

    const res = await testApp.request("/locations", {
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
    expect(data.name).toBe("Rome");
    expect(data.country).toBe("Italy");
    expect(data.type).toBe("city");
  });
});
