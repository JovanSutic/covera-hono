import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import assetsApp from "./assets.route";
import { assetsService } from "./assets.service";
import { checkExistence } from "@/core/utils/db-validator";
import { usersService } from "../users/users.service";

const {
  mockGetByApartmentId,
  mockCreate,
  mockDelete,
  mockCheckExistence,
} = vi.hoisted(() => {
  return {
    mockGetByApartmentId: vi.fn(),
    mockCreate: vi.fn(),
    mockDelete: vi.fn(),
    mockCheckExistence: vi.fn(),
  };
});

vi.mock("./assets.service", () => ({
  assetsService: {
    getByApartmentId: mockGetByApartmentId,
    create: mockCreate,
    delete: mockDelete,
  },
}));

vi.mock("../users/users.service", () => ({
  usersService: {
    getByAuthId: vi.fn(),
  },
}));

const mockedUserService = usersService as unknown as {
  getByAuthId: ReturnType<typeof vi.fn>;
};

vi.mock("@/core/utils/db-validator", () => ({
  checkExistence: mockCheckExistence,
}));

const mockGetUser = vi.fn();
const mockUpdateUserById = vi.fn();

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const MOCK_JWT = "Bearer validation-mock-token-string";

let currentTestUser = {
  id: VALID_UUID,
  email: "admin@example.com",
  role: "admin" as "admin" | "host" | "guest",
};

export const setTestUser = (
  role: "admin" | "host" | "guest",
  overrides?: Partial<typeof currentTestUser>,
) => {
  currentTestUser = {
    id: overrides?.id || VALID_UUID,
    email: overrides?.email || `${role}@example.com`,
    role,
  };
};

const testApp = createTestApp({
  contextOverrides: () => ({
    getUser: mockGetUser,
    updateUserById: mockUpdateUserById,
    authUser: currentTestUser, // Matches apartments.test pattern
  }),
});

testApp.route("/assets", assetsApp);

const setupSuccessfulGuards = (
  role: "admin" | "host" | "guest" = "admin",
  id: string = VALID_UUID,
) => {
  setTestUser(role, { id });

  mockGetUser.mockResolvedValue({
    data: {
      user: {
        id,
        email: `${role}@example.com`,
        role,
        user_metadata: { role },
        app_metadata: { role },
      },
    },
    error: null,
  });

  mockedUserService.getByAuthId.mockResolvedValue({
    id: VALID_UUID,
    authId: VALID_UUID,
    role,
    status: "confirmed",
  });
};

describe("Assets routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExistence.mockResolvedValue(true);
    setupSuccessfulGuards("host");
  });

  describe("GET /assets/apartment/:apartmentId", () => {
    it("should return assets for a valid apartment when authenticated", async () => {
      const mockAssets = [
        {
          id: VALID_UUID,
          apartmentId: VALID_APARTMENT_ID,
          name: "Smart Lock",
          category: "Electronics",
          roomLocation: "Entrance",
          description: "Front door keypad lock",
          photoProofRequirement: "FUNCTIONAL_ACTION",
          approximateValueCents: 25000,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockGetByApartmentId.mockResolvedValue(mockAssets);

      const res = await testApp.request(
        `/assets/apartment/${VALID_APARTMENT_ID}`,
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].name).toBe("Smart Lock");
      expect(mockCheckExistence).toHaveBeenCalledWith(
        expect.anything(),
        "apartments",
        VALID_APARTMENT_ID,
      );
    });

    it("should return 401 if authentication token is missing", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error("Missing token"),
      });

      const res = await testApp.request(
        `/assets/apartment/${VALID_APARTMENT_ID}`,
      );
      expect(res.status).toBe(401);
    });

    it("should return 400 for invalid apartment UUID format", async () => {
      const res = await testApp.request("/assets/apartment/invalid-uuid", {
        headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(400);
    });
  });

  describe("POST /assets", () => {
    it("should create an asset successfully", async () => {
      const input = {
        apartmentId: VALID_APARTMENT_ID,
        name: "Coffee Machine",
        category: "APPLIANCES_SMALL",
        roomLocation: "KITCHEN",
        description: "Nespresso Machine",
        photoProofRequirement: "CLOSEUP",
        approximateValueCents: 15000,
      };

      const mockCreatedAsset = {
        id: VALID_UUID,
        ...input,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockCreate.mockResolvedValue(mockCreatedAsset);

      const res = await testApp.request("/assets", {
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
      expect(data.name).toBe("Coffee Machine");
      expect(mockCheckExistence).toHaveBeenCalledWith(
        expect.anything(),
        "apartments",
        VALID_APARTMENT_ID,
      );
    });

    it("should return 400 when missing required fields", async () => {
      const invalidInput = {
        apartmentId: VALID_APARTMENT_ID,
        category: "Appliances",
      };

      const res = await testApp.request("/assets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: MOCK_JWT,
        },
        body: JSON.stringify(invalidInput),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /assets/:id", () => {
    it("should soft-delete an asset successfully", async () => {
      mockDelete.mockResolvedValue({
        success: true,
        id: VALID_UUID,
      });

      const res = await testApp.request(`/assets/${VALID_UUID}`, {
        method: "DELETE",
        headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.id).toBe(VALID_UUID);
    });

    it("should return 404 if asset to delete is not found", async () => {
      mockDelete.mockResolvedValue(null);

      const res = await testApp.request(`/assets/${VALID_UUID}`, {
        method: "DELETE",
        headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(404);
    });
  });
});