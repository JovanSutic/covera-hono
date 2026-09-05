import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import inspectionsApp from "./inspections.route";
import { usersService } from "../users/users.service";
import { NotFoundException } from "@/core/errors/error.exceptions";

const {
  mockGetById,
  mockGetByReservationId,
  mockCreate,
  mockRecordVisit,
  mockCheckExistence,
  mockAssertCanCreateInspection,
} = vi.hoisted(() => {
  return {
    mockGetById: vi.fn(),
    mockGetByReservationId: vi.fn(),
    mockCreate: vi.fn(),
    mockRecordVisit: vi.fn(),
    mockCheckExistence: vi.fn(),
    mockAssertCanCreateInspection: vi.fn(),
  };
});

vi.mock("./inspections.service", () => ({
  inspectionsService: {
    getById: mockGetById,
    getByReservationId: mockGetByReservationId,
    create: mockCreate,
    recordVisit: mockRecordVisit,
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
  assertCanCreateInspection: mockAssertCanCreateInspection,
}));

const mockGetUser = vi.fn();
const mockUpdateUserById = vi.fn();

const VALID_USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const VALID_RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440000";
const VALID_INSPECTION_ID = "880e8400-e29b-41d4-a716-446655440000";
const MOCK_JWT = "Bearer validation-mock-token-string";

let currentTestUser: {
  id: string;
  email: string;
  role: "admin" | "host" | "guest";
} | null = {
  id: VALID_USER_ID,
  email: "host@example.com",
  role: "host",
};

export const setTestUser = (
  role: "admin" | "host" | "guest",
  overrides?: Partial<NonNullable<typeof currentTestUser>>,
) => {
  currentTestUser = {
    id: overrides?.id || VALID_USER_ID,
    email: overrides?.email || `${role}@example.com`,
    role,
  };
};

export const clearTestUser = () => {
  currentTestUser = null;
};

const testApp = createTestApp({
  contextOverrides: () => ({
    getUser: mockGetUser,
    updateUserById: mockUpdateUserById,
    authUser: currentTestUser,
  }),
});

testApp.route("/inspections", inspectionsApp);

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
};

describe("Inspections routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckExistence.mockResolvedValue(true);
    mockAssertCanCreateInspection.mockResolvedValue(true);
    setupSuccessfulGuards("host");
  });

  describe("POST /inspections", () => {
    it("should create an inspection successfully for an authenticated user", async () => {
      const input = {
        reservationId: VALID_RESERVATION_ID,
      };

      const mockCreatedInspection = {
        id: VALID_INSPECTION_ID,
        reservationId: VALID_RESERVATION_ID,
        visited: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockCreate.mockResolvedValue(mockCreatedInspection);

      const res = await testApp.request("/inspections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: MOCK_JWT,
        },
        body: JSON.stringify(input),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe(VALID_INSPECTION_ID);
      expect(data.reservationId).toBe(VALID_RESERVATION_ID);
      expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), input);
    });

    it("should return 401 when unauthenticated user attempts creation", async () => {
      clearTestUser();

      const input = {
        reservationId: VALID_RESERVATION_ID,
      };

      const res = await testApp.request("/inspections", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      expect(res.status).toBe(401);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("should return 404 if reservation does not exist", async () => {
      mockAssertCanCreateInspection.mockRejectedValueOnce(
        new NotFoundException("Reservation"),
      );

      const input = {
        reservationId: VALID_RESERVATION_ID,
      };

      const res = await testApp.request("/inspections", {
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

  describe("GET /inspections/:id", () => {
    it("should return an inspection by ID", async () => {
      const mockInspection = {
        id: VALID_INSPECTION_ID,
        reservationId: VALID_RESERVATION_ID,
        visited: [],
        createdAt: new Date().toISOString(),
      };

      mockGetById.mockResolvedValue(mockInspection);

      const res = await testApp.request(`/inspections/${VALID_INSPECTION_ID}`, {
        headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(VALID_INSPECTION_ID);

      expect(mockGetById).toHaveBeenCalledWith(
        expect.any(Object),
        VALID_INSPECTION_ID,
        false,
      );
    });

    it("should return a detailed inspection when detailed query parameter is true", async () => {
      const mockDetailedInspection = {
        id: VALID_INSPECTION_ID,
        reservationId: VALID_RESERVATION_ID,
        visited: [],
        createdAt: new Date().toISOString(),
        reservation: { id: VALID_RESERVATION_ID },
        shots: [],
        images: [],
      };

      mockGetById.mockResolvedValue(mockDetailedInspection);

      const res = await testApp.request(
        `/inspections/${VALID_INSPECTION_ID}?detailed=true`,
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(200);
      expect(mockGetById).toHaveBeenCalledWith(
        expect.any(Object),
        VALID_INSPECTION_ID,
        true,
      );
    });

    it("should return 404 if inspection by ID is not found", async () => {
      mockGetById.mockResolvedValue(null);

      const res = await testApp.request(`/inspections/${VALID_INSPECTION_ID}`, {
        headers: { Authorization: MOCK_JWT },
      });

      expect(res.status).toBe(404);
    });
  });

  describe("GET /inspections/reservation/:reservationId", () => {
    it("should return an inspection by reservation ID", async () => {
      const mockInspection = {
        id: VALID_INSPECTION_ID,
        reservationId: VALID_RESERVATION_ID,
        visited: [],
        createdAt: new Date().toISOString(),
      };

      mockGetByReservationId.mockResolvedValue(mockInspection);

      const res = await testApp.request(
        `/inspections/reservation/${VALID_RESERVATION_ID}`,
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.reservationId).toBe(VALID_RESERVATION_ID);
      expect(mockCheckExistence).toHaveBeenCalledWith(
        expect.any(Object),
        "reservations",
        VALID_RESERVATION_ID,
      );
    });

    it("should return 404 if inspection for reservation is not found", async () => {
      mockGetByReservationId.mockResolvedValue(null);

      const res = await testApp.request(
        `/inspections/reservation/${VALID_RESERVATION_ID}`,
        {
          headers: { Authorization: MOCK_JWT },
        },
      );

      expect(res.status).toBe(404);
    });
  });

  describe("POST /inspections/:id/ping", () => {
    it("should track telemetry ping for unauthenticated guest visitors", async () => {
      clearTestUser();
      mockRecordVisit.mockResolvedValue(true);

      const userAgent =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)";

      const res = await testApp.request(
        `/inspections/${VALID_INSPECTION_ID}/ping`,
        {
          method: "POST",
          headers: {
            "User-Agent": userAgent,
          },
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, tracked: true });
      expect(mockRecordVisit).toHaveBeenCalledWith(
        expect.any(Object),
        VALID_INSPECTION_ID,
        userAgent,
      );
    });

    it("should return 404 if recordVisit fails (inspection does not exist)", async () => {
      clearTestUser();
      mockRecordVisit.mockResolvedValue(false);

      const res = await testApp.request(
        `/inspections/${VALID_INSPECTION_ID}/ping`,
        {
          method: "POST",
        },
      );

      expect(res.status).toBe(404);
    });
  });
});
