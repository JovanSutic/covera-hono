import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import reservationsApp from "./reservations.route";
import { usersService } from "../users/users.service";
import {
  ForbiddenException,
  NotFoundException,
} from "@/core/errors/error.exceptions";

const {
  mockGetByApartmentId,
  mockGetById,
  mockCreate,
  mockUpdate,
  mockDelete,
  mockGetApartmentById,
  mockCheckExistence,
  mockAssertApartmentOwnership,
  mockAssertNoOverlappingReservation,
} = vi.hoisted(() => {
  return {
    mockGetByApartmentId: vi.fn(),
    mockGetById: vi.fn(),
    mockCreate: vi.fn(),
    mockUpdate: vi.fn(),
    mockDelete: vi.fn(),
    mockGetApartmentById: vi.fn(),
    mockCheckExistence: vi.fn(),
    mockAssertApartmentOwnership: vi.fn(),
    mockAssertNoOverlappingReservation: vi.fn(),
  };
});

vi.mock("./reservations.service", () => ({
  reservationsService: {
    getByApartmentId: mockGetByApartmentId,
    getById: mockGetById,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
  },
}));

vi.mock("../apartments/apartments.service", () => ({
  apartmentsService: {
    getById: mockGetApartmentById,
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
  assertApartmentOwnership: mockAssertApartmentOwnership,
  assertNoOverlappingReservation: mockAssertNoOverlappingReservation,
}));

const mockGetUser = vi.fn();
const mockUpdateUserById = vi.fn();

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const VALID_RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440000";
const MOCK_JWT = "Bearer validation-mock-token-string";

let currentTestUser = {
  id: VALID_USER_ID,
  email: "host@example.com",
  role: "host" as "admin" | "host" | "guest",
};

export const setTestUser = (
  role: "admin" | "host" | "guest",
  overrides?: Partial<typeof currentTestUser>,
) => {
  currentTestUser = {
    id: overrides?.id || VALID_USER_ID,
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

testApp.route("/reservations", reservationsApp);

const setupSuccessfulGuards = (
  role: "admin" | "host" | "guest" = "host",
  id: string = VALID_USER_ID,
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

  // Default apartment mock for ownership checks
  mockGetApartmentById.mockResolvedValue({
    id: VALID_APARTMENT_ID,
    ownerId: id,
    name: "Downtown Loft",
  });
};

describe("Reservations routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExistence.mockResolvedValue(true);
    setupSuccessfulGuards("host");
  });

  describe("GET /reservations/apartment/:apartmentId", () => {
    it("should return reservations for apartment owner", async () => {
      mockGetApartmentById.mockResolvedValueOnce({
        id: VALID_APARTMENT_ID,
        owner: VALID_USER_ID,
        name: "Downtown Loft",
      });

      const mockReservations = [
        {
          id: VALID_RESERVATION_ID,
          apartmentId: VALID_APARTMENT_ID,
          guestName: "John Doe",
          guestEmail: "john@example.com",
          checkInDatetime: new Date().toISOString(),
          checkOutDatetime: new Date().toISOString(),
          status: "UPCOMING",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockGetByApartmentId.mockResolvedValue(mockReservations);

      const res = await testApp.request(
        `/reservations/apartment/${VALID_APARTMENT_ID}`,
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0].guestName).toBe("John Doe");

      // Verify guard actually resolved the apartment using the URL parameter ID
      expect(mockGetApartmentById).toHaveBeenCalledWith(
        expect.any(Object),
        VALID_APARTMENT_ID,
      );
    });

    it("should allow admin access via apartmentGuard(true)", async () => {
      setupSuccessfulGuards("admin", "admin-uuid-1234");

      mockGetByApartmentId.mockResolvedValue([]);

      const res = await testApp.request(
        `/reservations/apartment/${VALID_APARTMENT_ID}`,
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(200);
      expect(mockGetApartmentById).not.toHaveBeenCalled(); // Admin bypasses ownership query
    });

    it("should return 403 when host tries to view another host's apartment reservations", async () => {
      mockGetApartmentById.mockResolvedValue({
        id: VALID_APARTMENT_ID,
        ownerId: "other-host-uuid",
      });

      const res = await testApp.request(
        `/reservations/apartment/${VALID_APARTMENT_ID}`,
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(403);
    });
  });

  describe("POST /reservations", () => {
    it("should create a reservation successfully for apartment owner", async () => {
      mockAssertApartmentOwnership.mockResolvedValue(undefined);
      mockAssertNoOverlappingReservation.mockResolvedValue(undefined); // <-- Pass overlap assertion

      const input = {
        apartmentId: VALID_APARTMENT_ID,
        guestName: "Jane Smith",
        guestEmail: "jane@example.com",
        checkInDatetime: "2026-09-01T14:00:00.000Z",
        checkOutDatetime: "2026-09-05T10:00:00.000Z",
        status: "UPCOMING",
        numberOfGuests: 2,
        totalPriceCents: 15000,
      };

      const mockCreatedReservation = {
        id: VALID_RESERVATION_ID,
        ...input,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockCreate.mockResolvedValue(mockCreatedReservation);

      const res = await testApp.request("/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: MOCK_JWT,
        },
        body: JSON.stringify(input),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe(VALID_RESERVATION_ID);
      expect(data.guestName).toBe("Jane Smith");
    });

    it("should return 404 when creating a reservation for unowned apartment", async () => {
      mockAssertApartmentOwnership.mockRejectedValueOnce(
        new NotFoundException(`Apartment with ID  not found`),
      );

      const input = {
        apartmentId: VALID_APARTMENT_ID,
        guestName: "Jane Smith",
        checkInDatetime: "2026-09-01T14:00:00.000Z",
        checkOutDatetime: "2026-09-05T10:00:00.000Z",
      };

      const res = await testApp.request("/reservations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: MOCK_JWT,
        },
        body: JSON.stringify(input),
      });

      expect(res.status).toBe(404);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe("PATCH /reservations/:id", () => {
    it("should update a reservation successfully", async () => {
      mockGetById.mockResolvedValue({
        id: VALID_RESERVATION_ID,
        apartmentId: VALID_APARTMENT_ID,
      });

      const updatePayload = { guestName: "Updated Guest Name" };

      mockUpdate.mockResolvedValue({
        id: VALID_RESERVATION_ID,
        apartmentId: VALID_APARTMENT_ID,
        guestName: "Updated Guest Name",
        checkInDatetime: new Date().toISOString(),
        checkOutDatetime: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const res = await testApp.request(
        `/reservations/${VALID_RESERVATION_ID}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: MOCK_JWT,
          },
          body: JSON.stringify(updatePayload),
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.guestName).toBe("Updated Guest Name");
    });
  });

  describe("DELETE /reservations/:id", () => {
    it("should delete a reservation successfully", async () => {
      mockGetById.mockResolvedValue({
        id: VALID_RESERVATION_ID,
        apartmentId: VALID_APARTMENT_ID,
      });

      mockDelete.mockResolvedValue({
        success: true,
        id: VALID_RESERVATION_ID,
      });

      const res = await testApp.request(
        `/reservations/${VALID_RESERVATION_ID}`,
        {
          method: "DELETE",
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.id).toBe(VALID_RESERVATION_ID);
    });

    it("should return 404 if reservation to delete does not exist", async () => {
      mockGetById.mockResolvedValue({
        id: VALID_RESERVATION_ID,
        apartmentId: VALID_APARTMENT_ID,
      });

      mockDelete.mockResolvedValue(null);

      const res = await testApp.request(
        `/reservations/${VALID_RESERVATION_ID}`,
        {
          method: "DELETE",
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(404);
    });
  });
});
