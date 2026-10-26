import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import assetsApp from "./assets.route";
import { assetsService } from "./assets.service";
import { usersService } from "../users/users.service";
import { assetErrors } from "./assets.errors";

const {
  mockGetByApartmentId,
  mockCreate,
  mockDelete,
  mockGetAllTypes,
  mockCheckExistence,
  mockAssertCanModifyAsset,
  mockAssertCanModifyApartmentShots,
} = vi.hoisted(() => {
  return {
    mockGetByApartmentId: vi.fn(),
    mockCreate: vi.fn(),
    mockDelete: vi.fn(),
    mockGetAllTypes: vi.fn(),
    mockCheckExistence: vi.fn(),
    mockAssertCanModifyAsset: vi.fn(),
    mockAssertCanModifyApartmentShots: vi.fn(),
  };
});

vi.mock("./assets.service", () => ({
  assetsService: {
    getByApartmentId: mockGetByApartmentId,
    create: mockCreate,
    delete: mockDelete,
    getAllTypes: mockGetAllTypes,
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

// Mock validator functions imported from db-validator
vi.mock("@/core/utils/db-validator", () => ({
  checkExistence: mockCheckExistence,
  assertCanModifyAsset: mockAssertCanModifyAsset,
  assertCanModifyApartmentShots: mockAssertCanModifyApartmentShots,
}));

const mockGetUser = vi.fn();
const mockUpdateUserById = vi.fn();

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const VALID_ASSET_TYPE_ID = "770e8400-e29b-41d4-a716-446655440000";
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
    authUser: currentTestUser,
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
    mockAssertCanModifyAsset.mockResolvedValue(undefined);
    mockAssertCanModifyApartmentShots.mockResolvedValue(undefined);
    setupSuccessfulGuards("host");
  });

  describe("GET /assets/apartment/:apartmentId", () => {
    it("should return assets for a valid apartment when authenticated", async () => {
      const mockAssets = [
        {
          id: VALID_UUID,
          apartmentId: VALID_APARTMENT_ID,
          assetTypeId: VALID_ASSET_TYPE_ID,
          roomLocation: "ENTRANCE_HALLWAY",
          ageBracket: "ONE_TO_THREE_YEARS",
          valueTier: "PREMIUM",
          description: "Front door keypad lock",
          photoProofRequirement: "FUNCTIONAL_ACTION",
          approximateValueCents: 25000,
          isActive: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          asset_type: {
            id: VALID_ASSET_TYPE_ID,
            code: "SMART_LOCK",
            category: "ELECTRONICS",
          },
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
      expect(data[0].asset_type.code).toBe("SMART_LOCK");
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
      const body: any = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details[0].field).toBe("param.apartmentId");
    });
  });

  describe("POST /assets", () => {
    it("should create an asset successfully", async () => {
      const input = {
        apartmentId: VALID_APARTMENT_ID,
        assetTypeId: VALID_ASSET_TYPE_ID,
        name: "Nespresso Coffee Machine", // Required by InsertAssetSchema
        category: "APPLIANCES_SMALL",
        roomLocation: "KITCHEN",
        ageBracket: "ONE_TO_THREE_YEARS",
        valueTier: "STANDARD",
        description: "Nespresso Coffee Machine",
        photoProofRequirement: "CLOSEUP",
        approximateValueCents: 15000,
      };

      const mockCreatedAsset = {
        id: VALID_UUID,
        ...input,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        asset_type: {
          id: VALID_ASSET_TYPE_ID,
          code: "COFFEE_MACHINE",
          category: "APPLIANCES_SMALL",
        },
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
      expect(data.asset_type.code).toBe("COFFEE_MACHINE");
      expect(mockCheckExistence).toHaveBeenCalledWith(
        expect.anything(),
        "apartments",
        VALID_APARTMENT_ID,
      );
      expect(mockCheckExistence).toHaveBeenCalledWith(
        expect.anything(),
        "assetTypes",
        VALID_ASSET_TYPE_ID,
      );
    });

    it("should return 400 when missing required fields", async () => {
      const invalidInput = {
        apartmentId: VALID_APARTMENT_ID,
        // Missing assetTypeId, ageBracket, and valueTier
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
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details[0].field).toMatch(/^body\./);
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
      expect(mockCheckExistence).toHaveBeenCalledWith(
        expect.anything(),
        "assets",
        VALID_UUID,
      );
      expect(mockAssertCanModifyAsset).toHaveBeenCalledWith(
        expect.anything(),
        VALID_UUID,
        "delete",
      );
    });

    it("should return 409 with ASSET_LOCKED when deletion is blocked", async () => {
      mockAssertCanModifyAsset.mockRejectedValue(assetErrors.locked({ action: "delete" }));

      const res = await testApp.request(`/assets/${VALID_UUID}`, {
        method: "DELETE", headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(409);
      const body: any = await res.json();
      expect(body.error.code).toBe("ASSET_LOCKED");
      expect(body.error.message).toMatch(/cannot be deleted because/);
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("should return 404 with ASSET_NOT_FOUND", async () => {
      mockCheckExistence.mockRejectedValue(assetErrors.notFound());

      const res = await testApp.request(`/assets/${VALID_UUID}`, {
        method: "DELETE", headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("ASSET_NOT_FOUND");
    });
  });

  describe("GET /assets/types", () => {
    const mockAssetTypes = [
      { id: VALID_ASSET_TYPE_ID, code: "COFFEE_MACHINE", category: "APPLIANCES_SMALL" },
      { id: VALID_UUID, code: "SMART_LOCK", category: "ELECTRONICS" },
    ];

    it("should return the asset type catalog ordered A-Z by code", async () => {
      mockGetAllTypes.mockResolvedValue(mockAssetTypes);

      const res = await testApp.request("/assets/types", {
        headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
      expect(data.map((t: { code: string }) => t.code)).toEqual([
        "COFFEE_MACHINE",
        "SMART_LOCK",
      ]);
      expect(data[0].code <= data[1].code).toBe(true);
    });

    it("should be reachable and not shadowed by the /{id} route", async () => {
      mockGetAllTypes.mockResolvedValue([]);

      const res = await testApp.request("/assets/types", {
        headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual([]);
      expect(mockGetAllTypes).toHaveBeenCalledTimes(1);
    });

    it("should return 401 with the canonical envelope if the token is missing", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: null },
        error: new Error("Missing token"),
      });

      const res = await testApp.request("/assets/types");

      expect(res.status).toBe(401);
      const body: any = await res.json();
      expect(body.success).toBe(false);
      expect(body.error.code).toBe("AUTH_TOKEN_MISSING");
      expect(body.error.message).toMatch(/Authentication is required/);
      expect(mockGetAllTypes).not.toHaveBeenCalled();
    });

    it("should return 403 FORBIDDEN_ROLE for a guest", async () => {
      setTestUser("guest");
      mockedUserService.getByAuthId.mockResolvedValue({
        id: VALID_UUID,
        authId: VALID_UUID,
        role: "guest",
        status: "confirmed",
      });

      const res = await testApp.request("/assets/types", {
        headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(403);
      const body: any = await res.json();
      expect(body.error.code).toBe("FORBIDDEN_ROLE");
      expect(body.error.message).toMatch(/only available to: admin, host/);
      expect(mockGetAllTypes).not.toHaveBeenCalled();
    });
  });
});
