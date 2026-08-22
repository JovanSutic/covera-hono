import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import apartmentsApp from "./apartments.route";
import { NotFoundException } from "@/core/errors/error.exceptions";
import { S3Client } from "@aws-sdk/client-s3";
import { usersService } from "../users/users.service";

const {
  mockGetAll,
  mockGetById,
  mockCreate,
  mockGenerateUploadTokens,
  mockSyncUploadedPhotos,
  mockGetByOwnerId,
  mockCheckExistence,
} = vi.hoisted(() => {
  return {
    mockGetAll: vi.fn(),
    mockGetById: vi.fn(),
    mockCreate: vi.fn(),
    mockGenerateUploadTokens: vi.fn(),
    mockSyncUploadedPhotos: vi.fn(),
    mockCheckExistence: vi.fn(),
    mockGetByOwnerId: vi.fn(),
  };
});

vi.mock("../../modules/apartments/apartments.service", () => ({
  apartmentsService: {
    getAll: mockGetAll,
    getById: mockGetById,
    create: mockCreate,
    generateUploadTokens: mockGenerateUploadTokens,
    syncUploadedPhotos: mockSyncUploadedPhotos,
    getByOwnerId: mockGetByOwnerId,
  },
}));

vi.mock("../../modules/users/users.service", () => ({
  usersService: {
    getByAuthId: vi.fn(),
  },
}));

const mockedUserService = usersService as unknown as {
  getByAuthId: ReturnType<typeof vi.fn>;
};

vi.mock("@/core/utils/db-validator", () => ({
  checkExistence: (...args: unknown[]) => mockCheckExistence(...args),
}));

const mockGetUser = vi.fn();
const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const INVALID_UUID = "00000000-0000-0000-0000-000000000000";
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
    db: {} as any,
    getUser: mockGetUser,
    s3: {} as S3Client,
    r2BucketName: "test-apartment-photos-bucket",
    authUser: currentTestUser,
  }),
});

testApp.route("/apartments", apartmentsApp);

const setupSuccessfulGuards = (
  role: "admin" | "host" | "guest" = "admin",
  id: string = VALID_UUID,
) => {
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

describe("Apartments routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExistence.mockResolvedValue(undefined);
    setupSuccessfulGuards("admin");
  });

  /*  it("GET /apartments should return all apartments", async () => {
    mockGetAll.mockResolvedValue([
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
    mockGetById.mockResolvedValue({
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
    mockGetById.mockResolvedValue(null);

    const res = await testApp.request(`/apartments/${VALID_UUID}`, {
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(404);
  });

  it("POST /apartments should create a new apartment", async () => {
    const input = {
      owner: VALID_UUID,
      location: VALID_UUID,
      name: "New apartment",
      address: "Rome",
      externalId: "ext_123",
    };

    mockCreate.mockResolvedValue({
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
    mockCheckExistence.mockRejectedValueOnce(
      new NotFoundException(`users with ID ${INVALID_UUID}`),
    );

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
  }); */

  it("POST /apartments/:id/photos/upload-tokens should generate presigned URLs", async () => {
    mockGetById.mockResolvedValue({
      id: VALID_UUID,
      owner: VALID_UUID,
      name: "Test apartment",
    });

    const input = {
      fileTypes: ["image/jpeg", "image/png"],
    };

    mockGenerateUploadTokens.mockResolvedValue([
      { uploadUrl: "https://example.com", key: "apartments/id/img1.jpg" },
      { uploadUrl: "https://example.com", key: "apartments/id/img2.png" },
    ]);

    const res = await testApp.request(
      `/apartments/${VALID_UUID}/photos/upload-tokens`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: MOCK_JWT,
        },
        body: JSON.stringify(input),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    const tokens = Array.isArray(data) ? data : data.tokens;

    expect(tokens).toHaveLength(2);
    expect(tokens[0].key).toBe("apartments/id/img1.jpg");
    expect(mockCheckExistence).toHaveBeenCalledWith(
      expect.any(Object),
      "apartments",
      VALID_UUID,
    );
  });

  it("POST /apartments/:id/photos/confirm should synchronize uploaded storage keys", async () => {
    const input = {
      shotId: VALID_UUID,
      reservationId: VALID_UUID,
      type: "checkin_state",
      uploadedKeys: [
        "apartments/id/old-photo.jpg",
        "apartments/id/new-photo.png",
      ],
    };

    mockSyncUploadedPhotos.mockResolvedValue({
      success: true,
      activeCount: 2,
    });

    const res = await testApp.request(
      `/apartments/${VALID_UUID}/photos/confirm`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: MOCK_JWT,
        },
        body: JSON.stringify(input),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.activeCount).toBe(2);
  });

   it("GET /apartments/host/me should return apartments for the authenticated host", async () => {
    setupSuccessfulGuards("host");

    mockGetByOwnerId.mockResolvedValue([
      {
        id: "apt_host_1",
        owner: VALID_UUID,
        location: VALID_UUID,
        name: "Host's Luxury Suite",
        address: "Milan",
        externalId: null,
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await testApp.request("/apartments/host/me", {
      headers: { Authorization: MOCK_JWT },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].owner).toBe(VALID_UUID);
    expect(mockGetByOwnerId).toHaveBeenCalledWith(
      expect.any(Object),
      VALID_UUID,
    );
  });

  it("GET /apartments/host/me should return 401 when request is unauthorized", async () => {
    setupSuccessfulGuards("guest");
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error("Unauthorized access"),
    });

    const res = await testApp.request("/apartments/host/me", {
      headers: { Authorization: "Bearer invalid_token" },
    });

    expect(res.status).toBe(401);
    expect(mockGetByOwnerId).not.toHaveBeenCalled();
  });
});
