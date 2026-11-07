import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import incidentsApp from "./incidents.route";
import { usersService } from "../users/users.service";
import { incidentErrors } from "./incidents.errors";
import { expectError } from "@/core/utils/assert-error";

const {
  mockGetById,
  mockGetByReservationId,
  mockGetAssetApartment,
  mockAssessFeasibility,
  mockCreate,
  mockConfirmFiling,
  mockReservationGetById,
  mockAssertApartmentOwnership,
} = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockGetByReservationId: vi.fn(),
  mockGetAssetApartment: vi.fn(),
  mockAssessFeasibility: vi.fn(),
  mockCreate: vi.fn(),
  mockConfirmFiling: vi.fn(),
  mockReservationGetById: vi.fn(),
  mockAssertApartmentOwnership: vi.fn(),
}));

vi.mock("./incidents.service", () => ({
  incidentsService: {
    getById: mockGetById,
    getByReservationId: mockGetByReservationId,
    getAssetApartment: mockGetAssetApartment,
    assessFeasibility: mockAssessFeasibility,
    create: mockCreate,
    confirmAirbnbFiling: mockConfirmFiling,
  },
}));

vi.mock("../users/users.service", () => ({
  usersService: { getByAuthId: vi.fn() },
}));

vi.mock("../reservations/reservations.service", () => ({
  reservationsService: { getById: mockReservationGetById },
}));

vi.mock("@/core/utils/db-validator", () => ({
  assertApartmentOwnership: mockAssertApartmentOwnership,
  checkExistence: vi.fn(),
}));

const mockedUserService = usersService as unknown as {
  getByAuthId: ReturnType<typeof vi.fn>;
};

const mockGetUser = vi.fn();

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440000";
const INCIDENT_ID = "880e8400-e29b-41d4-a716-446655440000";
const ASSET_ID = "990e8400-e29b-41d4-a716-446655440000";
const MOCK_JWT = "Bearer validation-mock-token-string";

const testApp = createTestApp({
  contextOverrides: () => ({
    getUser: mockGetUser,
    authUser: { id: USER_ID, email: "host@example.com", role: "host" },
  }),
});

testApp.route("/incidents", incidentsApp);

const AUTHED_HEADERS = {
  "Content-Type": "application/json",
  Authorization: MOCK_JWT,
};

/** A reservation that opened yesterday and closes in three days. */
const openReservation = (overrides: Record<string, unknown> = {}) => ({
  id: RESERVATION_ID,
  apartmentId: APARTMENT_ID,
  checkInDatetime: new Date(Date.now() - 24 * 60 * 60 * 1000),
  checkOutDatetime: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  alternativeCheckInDatetime: null,
  alternativeCheckOutDatetime: null,
  ...overrides,
});

const createdIncident = {
  id: INCIDENT_ID,
  reservationId: RESERVATION_ID,
  status: "draft",
  isEmergencyMode: false,
  placeholderTotalAmountCents: 25000,
  finalPayoutRequestedCents: 0,
  resolutionCenterSubmittedAt: null,
  guestResponseDeadlineAt: null,
  aircoverEscalationDeadlineAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  items: [],
};

describe("Incidents routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: USER_ID, email: "host@example.com" } },
      error: null,
    });
    mockedUserService.getByAuthId.mockResolvedValue({
      id: USER_ID,
      authId: USER_ID,
      role: "host",
      status: "confirmed",
    });
    mockAssertApartmentOwnership.mockResolvedValue(undefined);
    mockAssessFeasibility.mockResolvedValue({ nextCheckIn: null, isEmergency: false });
    mockReservationGetById.mockResolvedValue(openReservation());
    mockGetByReservationId.mockResolvedValue(null);
    mockGetAssetApartment.mockResolvedValue({
      id: ASSET_ID,
      apartmentId: APARTMENT_ID,
    });
  });

  describe("POST /incidents", () => {
    const body = {
      reservationId: RESERVATION_ID,
      items: [{ assetId: ASSET_ID, type: "damage" }],
    };

    it("creates the claim and returns 201 with each item's field token", async () => {
      mockCreate.mockResolvedValue({
        ...createdIncident,
        items: [{ id: "item-1", cleanerToken: "abc123" }],
      });

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBe(INCIDENT_ID);
      expect(data.items[0].cleanerToken).toBe("abc123");
      // The window was resolved from the reservation, not from the request.
      expect(mockCreate).toHaveBeenCalledWith(
        expect.any(Object),
        body,
        expect.objectContaining({ isEmergencyMode: false }),
      );
    });

    it("returns 401 without a token", async () => {
      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      await expectError(res, 401, "AUTH_TOKEN_MISSING");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 403 FORBIDDEN_ROLE for a guest", async () => {
      mockedUserService.getByAuthId.mockResolvedValue({
        id: USER_ID,
        authId: USER_ID,
        role: "guest",
        status: "confirmed",
      });

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 403, "FORBIDDEN_ROLE");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 403 FORBIDDEN_APARTMENT_ACCESS when the caller does not own the apartment", async () => {
      mockAssertApartmentOwnership.mockRejectedValueOnce(
        incidentErrors.reservationNotFound({ id: RESERVATION_ID }),
      );

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(404);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 404 RESERVATION_NOT_FOUND for an unknown reservation", async () => {
      mockReservationGetById.mockResolvedValue(null);

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 404, "RESERVATION_NOT_FOUND");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 400 INCIDENT_WINDOW_EXPIRED once 14 days past check-out have passed", async () => {
      mockReservationGetById.mockResolvedValue(
        openReservation({
          checkInDatetime: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
          checkOutDatetime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        }),
      );

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      const payload = await expectError(res, 400, "INCIDENT_WINDOW_EXPIRED",
        /within 14 days of check-out/);
      // The deadline travels in meta, not in the message prose (§8).
      expect(payload.error.meta.reason).toBe("checkout");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    /**
     * Trigger A clause 2. The deadline is the NEXT guest's arrival, not this
     * stay's own check-in. The first case is the one the naive reading gets
     * wrong: a claim for a stay that is still IN PROGRESS is perfectly legal
     * while the following guest is still ahead.
     */
    it("accepts a claim during an in-progress stay while the next guest is still ahead", async () => {
      mockReservationGetById.mockResolvedValue(openReservation());
      mockAssessFeasibility.mockResolvedValue({
        nextCheckIn: new Date(Date.now() + 6 * 60 * 60 * 1000),
        isEmergency: false,
      });
      mockCreate.mockResolvedValue(createdIncident);

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(201);
    });

    it("returns 400 INCIDENT_WINDOW_EXPIRED once the next guest has arrived", async () => {
      mockReservationGetById.mockResolvedValue(openReservation());
      mockAssessFeasibility.mockResolvedValue({
        nextCheckIn: new Date(Date.now() - 60 * 60 * 1000),
        isEmergency: false,
      });

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      const payload = await expectError(res, 400, "INCIDENT_WINDOW_EXPIRED",
        /cannot be opened before the stay begins/);
      expect(payload.error.meta.reason).toBe("checkin");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("passes the effective check-out and now to the single feasibility call", async () => {
      mockCreate.mockResolvedValue(createdIncident);

      await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      // One call, so the flag and the refusal can never disagree about which
      // guest is next.
      expect(mockAssessFeasibility).toHaveBeenCalledTimes(1);
      expect(mockAssessFeasibility).toHaveBeenCalledWith(
        expect.any(Object),
        APARTMENT_ID,
        expect.objectContaining({ reservationId: RESERVATION_ID }),
      );
    });

    it("returns 409 INCIDENT_ALREADY_EXISTS when the reservation already has a claim", async () => {
      mockGetByReservationId.mockResolvedValue(createdIncident);

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 409, "INCIDENT_ALREADY_EXISTS");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 404 ASSET_NOT_FOUND for an unknown asset", async () => {
      mockGetAssetApartment.mockResolvedValue(null);

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 404, "ASSET_NOT_FOUND");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 400 ASSET_NOT_IN_APARTMENT when the asset belongs elsewhere", async () => {
      mockGetAssetApartment.mockResolvedValue({
        id: ASSET_ID,
        apartmentId: "11111111-1111-1111-1111-111111111111",
      });

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 400, "ASSET_NOT_IN_APARTMENT", /is not in the apartment/);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_ERROR for an empty items array", async () => {
      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ reservationId: RESERVATION_ID, items: [] }),
      });

      await expectError(res, 400, "VALIDATION_ERROR");
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("flags emergency mode when another guest arrives within four hours", async () => {
      mockAssessFeasibility.mockResolvedValue({
        nextCheckIn: new Date(Date.now() + 2 * 60 * 60 * 1000),
        isEmergency: true,
      });
      mockCreate.mockResolvedValue(createdIncident);

      await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.any(Object),
        body,
        expect.objectContaining({ isEmergencyMode: true }),
      );
    });
  });

  describe("GET /incidents/:id", () => {
    it("returns the hydrated claim", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        headers: AUTHED_HEADERS,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe(INCIDENT_ID);
      expect(data.items).toEqual([]);
    });

    it("returns 404 INCIDENT_NOT_FOUND for an unknown claim", async () => {
      mockGetById.mockResolvedValue(null);

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 404, "INCIDENT_NOT_FOUND");
    });

    it("returns 400 VALIDATION_ERROR for a malformed id", async () => {
      const res = await testApp.request("/incidents/not-a-uuid", {
        headers: AUTHED_HEADERS,
      });

      const payload = await expectError(res, 400, "VALIDATION_ERROR");
      expect(payload.error.details?.[0].field).toContain("id");
    });

    it("asserts ownership against the reservation's apartment, not the claim id", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockReservationGetById.mockResolvedValue(openReservation());

      await testApp.request(`/incidents/${INCIDENT_ID}`, {
        headers: AUTHED_HEADERS,
      });

      expect(mockAssertApartmentOwnership).toHaveBeenCalledWith(
        expect.any(Object),
        APARTMENT_ID,
        expect.objectContaining({ userId: USER_ID, role: "host" }),
      );
    });
  });

  describe("POST /incidents/:id/confirm-airbnb-filing", () => {
    it("files the claim and returns the clock fields", async () => {
      mockGetById.mockResolvedValue({ ...createdIncident, status: "ready_to_file" });
      mockConfirmFiling.mockResolvedValue({
        ...createdIncident,
        status: "submitted_to_guest",
        resolutionCenterSubmittedAt: new Date().toISOString(),
        guestResponseDeadlineAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/confirm-airbnb-filing`,
        { method: "POST", headers: AUTHED_HEADERS },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("submitted_to_guest");
      expect(data.guestResponseDeadlineAt).toBeTruthy();
      expect(data.resolutionCenterSubmittedAt).toBeTruthy();
    });

    it("returns 409 INCIDENT_NOT_READY while the claim is still draft", async () => {
      mockGetById.mockResolvedValue({ ...createdIncident, status: "draft" });

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/confirm-airbnb-filing`,
        { method: "POST", headers: AUTHED_HEADERS },
      );

      await expectError(res, 409, "INCIDENT_NOT_READY", /still need photos/);
      expect(mockConfirmFiling).not.toHaveBeenCalled();
    });

    it("returns 409 INCIDENT_ALREADY_FILED on a second filing", async () => {
      mockGetById.mockResolvedValue({
        ...createdIncident,
        status: "submitted_to_guest",
      });

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/confirm-airbnb-filing`,
        { method: "POST", headers: AUTHED_HEADERS },
      );

      await expectError(res, 409, "INCIDENT_ALREADY_FILED", /already been filed/);
      expect(mockConfirmFiling).not.toHaveBeenCalled();
    });

    it("returns 409 INCIDENT_ALREADY_FILED when the update matches no row", async () => {
      // The read said `ready_to_file`, a concurrent filing won the race, and the
      // guarded UPDATE matched nothing. The client must see the same conflict.
      mockGetById.mockResolvedValue({ ...createdIncident, status: "ready_to_file" });
      mockConfirmFiling.mockResolvedValue(null);

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/confirm-airbnb-filing`,
        { method: "POST", headers: AUTHED_HEADERS },
      );

      await expectError(res, 409, "INCIDENT_ALREADY_FILED");
    });

    it("returns 401 without a token", async () => {
      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/confirm-airbnb-filing`,
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );

      await expectError(res, 401, "AUTH_TOKEN_MISSING");
    });
  });
});
