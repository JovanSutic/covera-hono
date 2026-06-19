import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory"; 
import apartmentsApp from "./apartments.route"; 
import { NotFoundException } from "@/core/errors/error.exceptions";

const { mockGetAll, mockGetById, mockCreate, mockCheckExistence } = vi.hoisted(() => {
  return {
    mockGetAll: vi.fn(),
    mockGetById: vi.fn(),
    mockCreate: vi.fn(),
    mockCheckExistence: vi.fn(),
  };
});

vi.mock("../../modules/apartments/apartments.service", () => ({
  apartmentsService: {
    getAll: mockGetAll,
    getById: mockGetById,
    create: mockCreate,
  },
}));

vi.mock("@/core/utils/db-validator", () => ({
  checkExistence: mockCheckExistence,
}));

const mockGetUser = vi.fn();
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const INVALID_UUID = "00000000-0000-0000-0000-000000000000";
const MOCK_JWT = "Bearer validation-mock-token-string";

const testApp = createTestApp({
  contextOverrides: () => ({
    getUser: mockGetUser,
    authUser: { 
      id: VALID_UUID, 
      email: "admin@example.com", 
      role: "admin" 
    },
  }),
});

testApp.route("/apartments", apartmentsApp);

describe("Apartments routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExistence.mockResolvedValue(undefined);
  });

  const setupSuccessfulGuards = () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: VALID_UUID, email: "admin@example.com" } },
      error: null,
    });
  };

  it("GET /apartments should return all apartments", async () => {
    setupSuccessfulGuards();
    
    mockGetAll.mockReturnValue([
      {
        id: "apt_1",
        owner: "usr_1",
        location: "loc_1",
        name: "Test apartment",
        address: "Rome",
        externalId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await testApp.request("/apartments", {
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].name).toBe("Test apartment");
  });

  it("GET /apartments/:id should return single apartment", async () => {
    setupSuccessfulGuards();

    mockGetById.mockReturnValue({
      id: VALID_UUID,
      owner: VALID_UUID,
      location: VALID_UUID,
      name: "Test apartment",
      address: "Rome",
      externalId: null,
      createdAt: new Date().toISOString(),
    });

    const res = await testApp.request(`/apartments/${VALID_UUID}`, {
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(VALID_UUID);
  });

  it("GET /apartments/:id should return 404 when not found", async () => {
    setupSuccessfulGuards();
    mockGetById.mockReturnValue(null);

    const res = await testApp.request(`/apartments/${VALID_UUID}`, {
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(404);
  });

  it("POST /apartments should create a new apartment", async () => {
    setupSuccessfulGuards();

    const input = {
      owner: VALID_UUID,
      location: VALID_UUID,
      name: "New apartment",
      address: "Rome",
      externalId: "ext_123",
    };

    mockCreate.mockReturnValue({
      id: VALID_UUID,
      ...input,
      createdAt: new Date().toISOString(),
    });

    const res = await testApp.request("/apartments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: MOCK_JWT,
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe("New apartment");
    expect(mockCheckExistence).toHaveBeenCalledTimes(2);
  });

  it("POST /apartments should return 404 if the owner or location does not exist", async () => {
    setupSuccessfulGuards();
    mockCheckExistence.mockRejectedValueOnce(new NotFoundException(`users with ID ${INVALID_UUID}`));

    const input = {
      owner: INVALID_UUID,
      location: VALID_UUID,
      name: "New apartment",
      address: "Rome",
      externalId: "ext_123",
    };

    const res = await testApp.request("/apartments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: MOCK_JWT,
      },
      body: JSON.stringify(input),
    });

    expect(res.status).toBe(404);
  });
});
