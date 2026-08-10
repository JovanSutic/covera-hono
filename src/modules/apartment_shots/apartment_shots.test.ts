import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import apartmentShotsApp from "./apartment_shots.route";
import { usersService } from "../users/users.service";

const { mockGetByApartmentId, mockSyncShots, mockCheckExistence } = vi.hoisted(
  () => {
    return {
      mockGetByApartmentId: vi.fn(),
      mockSyncShots: vi.fn(),
      mockCheckExistence: vi.fn(),
    };
  },
);

vi.mock("./apartment_shots.service", () => ({
  apartmentShotsService: {
    getByApartmentId: mockGetByApartmentId,
    syncShots: mockSyncShots,
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
const VALID_ASSET_ID = "770e8400-e29b-41d4-a716-446655440000";
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

testApp.route("/apartment-shots", apartmentShotsApp);

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
    id,
    authId: id,
    role,
    status: "confirmed",
  });
};

describe("Apartment Shots routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExistence.mockResolvedValue(true);
    setupSuccessfulGuards("host");
  });

  describe("GET /apartment-shots/apartment/:apartmentId", () => {
    it("should return shots with assetIds for a valid apartment when authenticated", async () => {
      const mockShots = [
        {
          id: VALID_UUID,
          apartmentId: VALID_APARTMENT_ID,
          roomLocation: "LIVING_ROOM",
          shotType: "SWEEP_ONLY",
          title: "TV Setup",
          instructions: "Capture TV screen powered on",
          assetIds: [VALID_ASSET_ID],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockGetByApartmentId.mockResolvedValue(mockShots);

      const res = await testApp.request(
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].title).toBe("TV Setup");
      expect(data[0].assetIds).toEqual([VALID_ASSET_ID]);
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
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
      );
      expect(res.status).toBe(401);
    });

    it("should return 400 for invalid apartment UUID format", async () => {
      const res = await testApp.request(
        "/apartment-shots/apartment/invalid-uuid",
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /apartment-shots/apartment/:apartmentId", () => {
    it("should sync shots array successfully", async () => {
      const syncPayload = [
        {
          id: VALID_UUID,
          roomLocation: "LIVING_ROOM",
          shotType: "SWEEP_ONLY",
          title: "TV & Soundbar",
          instructions: "Take shot of TV and soundbar together",
          assetIds: [VALID_ASSET_ID],
        },
      ];

      const mockSyncedShots = [
        {
          apartmentId: VALID_APARTMENT_ID,
          ...syncPayload[0],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockSyncShots.mockResolvedValue(mockSyncedShots);

      const res = await testApp.request(
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: MOCK_JWT,
          },
          body: JSON.stringify({ shots: syncPayload }),
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].title).toBe("TV & Soundbar");
      expect(data[0].assetIds).toEqual([VALID_ASSET_ID]);
      expect(mockCheckExistence).toHaveBeenCalledWith(
        expect.anything(),
        "apartments",
        VALID_APARTMENT_ID,
      );
      expect(mockSyncShots).toHaveBeenCalledWith(
        expect.anything(),
        VALID_APARTMENT_ID,
        syncPayload,
      );
    });

    it("should return 400 when sync payload items fail validation", async () => {
      const invalidPayload = [
        {
          roomLocation: "INVALID_ROOM_TYPE",
          title: "Missing fields",
        },
      ];

      const res = await testApp.request(
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: MOCK_JWT,
          },
          body: JSON.stringify({ shots: invalidPayload }),
        },
      );

      expect(res.status).toBe(400);
    });

    it("should allow syncing an empty array to remove all shots", async () => {
      mockSyncShots.mockResolvedValue([]);

      const res = await testApp.request(
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: MOCK_JWT,
          },
          body: JSON.stringify({ shots: [] }),
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });

    it("should handle mixed sync: update existing shot, add new shot, and delete omitted shot", async () => {
      const EXISTING_SHOT_ID = "550e8400-e29b-41d4-a716-446655440001";
      const ANOTHER_VALID_ASSET_ID = "880e8400-e29b-41d4-a716-446655440000";

      const mixedPayload = [
        {
          id: EXISTING_SHOT_ID,
          roomLocation: "LIVING_ROOM",
          shotType: "SWEEP_ONLY",
          title: "Updated Living Room TV",
          instructions: "New updated instructions",
          assetIds: [VALID_ASSET_ID],
        },
        {
          roomLocation: "LIVING_ROOM",
          shotType: "SWEEP_ONLY",
          title: "Balcony View",
          instructions: "Wide shot of the balcony",
          assetIds: [ANOTHER_VALID_ASSET_ID],
        },
      ];

      const mockSyncedResponse = [
        { ...mixedPayload[0], apartmentId: VALID_APARTMENT_ID },
        { ...mixedPayload[1], apartmentId: VALID_APARTMENT_ID },
      ];

      mockSyncShots.mockResolvedValue(mockSyncedResponse);

      const res = await testApp.request(
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: MOCK_JWT,
          },
          body: JSON.stringify({ shots: mixedPayload }),
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(mockSyncShots).toHaveBeenCalledWith(
        expect.anything(),
        VALID_APARTMENT_ID,
        mixedPayload,
      );
    });

    it("should update assetIds list on an existing shot (add and remove assets)", async () => {
      const NEW_ASSET_ID_2 = "770e8400-e29b-41d4-a716-446655440002";

      const updateAssetsPayload = [
        {
          id: VALID_UUID,
          roomLocation: "LIVING_ROOM",
          shotType: "SWEEP_ONLY",
          title: "TV & Soundbar",
          instructions: "Take shot of TV and soundbar together",
          assetIds: [VALID_ASSET_ID, NEW_ASSET_ID_2], // Attached a second asset
        },
      ];

      mockSyncShots.mockResolvedValue([
        {
          ...updateAssetsPayload[0],
          apartmentId: VALID_APARTMENT_ID,
        },
      ]);

      const res = await testApp.request(
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: MOCK_JWT,
          },
          body: JSON.stringify({ shots: updateAssetsPayload }),
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data[0].assetIds).toEqual([VALID_ASSET_ID, NEW_ASSET_ID_2]);
    });

    it("should be idempotent when sending the identical state payload", async () => {
      const unchangedPayload = [
        {
          id: VALID_UUID,
          roomLocation: "LIVING_ROOM",
          shotType: "SWEEP_ONLY",
          title: "TV & Soundbar",
          instructions: "Take shot of TV and soundbar together",
          assetIds: [VALID_ASSET_ID],
        },
      ];

      mockSyncShots.mockResolvedValue([
        { ...unchangedPayload[0], apartmentId: VALID_APARTMENT_ID },
      ]);

      const res = await testApp.request(
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: MOCK_JWT,
          },
          body: JSON.stringify({ shots: unchangedPayload }),
        },
      );

      expect(res.status).toBe(200);
      expect(mockSyncShots).toHaveBeenCalledTimes(1);
    });

    it("should return 404 when apartment does not exist", async () => {
      mockCheckExistence.mockRejectedValue(new Error("Apartment not found"));

      const res = await testApp.request(
        `/apartment-shots/apartment/${VALID_APARTMENT_ID}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: MOCK_JWT,
          },
          body: JSON.stringify({
            shots: [
              {
                id: VALID_UUID,
                roomLocation: "LIVING_ROOM",
                shotType: "SWEEP_ONLY",
                title: "TV",
                instructions: "Take shot",
                assetIds: [],
              },
            ],
          }),
        },
      );

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
