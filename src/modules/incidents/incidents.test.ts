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
  mockList,
  mockUpdate,
  mockDelete,
  mockAddItem,
  mockGetItem,
  mockUpdateItem,
  mockDeleteItem,
  mockCountActiveEvidence,
  mockGenerateHostUploadTokens,
  mockAttachEvidence,
  mockGetItemWithAsset,
  mockDeleteEvidence,
  mockReissueToken,
  mockReservationGetById,
  mockAssertApartmentOwnership,
} = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockGetByReservationId: vi.fn(),
  mockGetAssetApartment: vi.fn(),
  mockAssessFeasibility: vi.fn(),
  mockCreate: vi.fn(),
  mockConfirmFiling: vi.fn(),
  mockList: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockAddItem: vi.fn(),
  mockGetItem: vi.fn(),
  mockUpdateItem: vi.fn(),
  mockDeleteItem: vi.fn(),
  mockCountActiveEvidence: vi.fn(),
  mockGenerateHostUploadTokens: vi.fn(),
  mockAttachEvidence: vi.fn(),
  mockGetItemWithAsset: vi.fn(),
  mockDeleteEvidence: vi.fn(),
  mockReissueToken: vi.fn(),
  mockReservationGetById: vi.fn(),
  mockAssertApartmentOwnership: vi.fn(),
}));

vi.mock("./incidents.service", async () => {
  // The pure helpers are kept REAL (only the I/O is mocked): they are the
  // predicates under test, and stubbing them would make the assertions about
  // which evidence a type accepts assert nothing at all.
  const actual = await vi.importActual<typeof import("./incidents.service")>(
    "./incidents.service",
  );

  return {
    ...actual,
    incidentsService: {
      getById: mockGetById,
      getByReservationId: mockGetByReservationId,
      getAssetApartment: mockGetAssetApartment,
      assessFeasibility: mockAssessFeasibility,
      create: mockCreate,
      confirmAirbnbFiling: mockConfirmFiling,
      list: mockList,
      update: mockUpdate,
      delete: mockDelete,
      addItem: mockAddItem,
      getItem: mockGetItem,
      updateItem: mockUpdateItem,
      deleteItem: mockDeleteItem,
      countActiveEvidence: mockCountActiveEvidence,
      generateHostUploadTokens: mockGenerateHostUploadTokens,
      attachEvidence: mockAttachEvidence,
      getItemWithAsset: mockGetItemWithAsset,
      deleteEvidence: mockDeleteEvidence,
      reissueToken: mockReissueToken,
    },
  };
});

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
const ITEM_ID = "aa0e8400-e29b-41d4-a716-446655440000";
const EVIDENCE_ID = "bb0e8400-e29b-41d4-a716-446655440000";
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

/** The asset shape the item schemas carry, as the service hydrates it. */
const hydratedAsset = {
  id: ASSET_ID,
  apartmentId: APARTMENT_ID,
  assetTypeId: "cc0e8400-e29b-41d4-a716-446655440000",
  name: 'Samsung 55" TV',
  roomLocation: "LIVING_ROOM",
  description: "Wall mounted",
  approximateValueCents: 25000,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  asset_type: {
    id: "cc0e8400-e29b-41d4-a716-446655440000",
    name: "TV",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
};

const itemRow = (overrides: Record<string, unknown> = {}) => ({
  id: ITEM_ID,
  incidentId: INCIDENT_ID,
  assetId: ASSET_ID,
  type: "damage",
  status: "link_generated",
  cleanerToken: "deadbeefdeadbeefdeadbeefdeadbeef",
  tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  estimatedPlaceholderValueCents: 0,
  descriptionByCleaner: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const hydratedItem = (overrides: Record<string, unknown> = {}) => ({
  ...itemRow(),
  asset: hydratedAsset,
  evidence: [],
  ...overrides,
});

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
    mockGetItem.mockResolvedValue(itemRow());
    mockCountActiveEvidence.mockResolvedValue(0);
    mockGetItemWithAsset.mockResolvedValue(hydratedItem());
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

    /**
     * The separation this feature's rework exists for: a host can open the claim
     * the moment they notice the damage, and add the affected assets afterwards
     * with `POST /{id}/items`. Before this, items were mandatory at creation and
     * there was no route to add another — so a host who found a second damaged
     * item had to delete and recreate the claim.
     */
    it("creates a claim with NO items, so they can be added afterwards", async () => {
      mockCreate.mockResolvedValue({ ...createdIncident, items: [] });

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ reservationId: RESERVATION_ID }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.items).toEqual([]);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.any(Object),
        { reservationId: RESERVATION_ID, items: [] },
        expect.any(Object),
      );
    });

    it("treats an explicit empty items array the same as an omitted one", async () => {
      mockCreate.mockResolvedValue({ ...createdIncident, items: [] });

      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ reservationId: RESERVATION_ID, items: [] }),
      });

      expect(res.status).toBe(201);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.any(Object),
        { reservationId: RESERVATION_ID, items: [] },
        expect.any(Object),
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

    /**
     * C1: the refusal fires when `now > nextCheckIn` — the next guest has
     * ALREADY arrived. The message must describe that, not a future event. The
     * old prose said the claim "cannot be opened before the stay begins", which
     * described a rule no clause implements and the opposite of what happened.
     */
    it("returns 400 INCIDENT_WINDOW_EXPIRED with check-in prose once the next guest has arrived", async () => {
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
        /the next guest checked in on/);
      expect(payload.error.meta.reason).toBe("checkin");
      // The two reasons must not share prose: a message about the stay not
      // having begun described a future event for a past one.
      expect(payload.error.message).not.toMatch(/before the stay begins/);
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

    /**
     * C2: the same asset twice in one create used to reach
     * `UNIQUE(incident_id, asset_id)` and surface as a raw driver error. It is
     * now the same readable conflict the add-item route answers.
     */
    it("returns 409 INCIDENT_ITEM_EXISTS when one asset is listed twice", async () => {
      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({
          reservationId: RESERVATION_ID,
          items: [
            { assetId: ASSET_ID, type: "damage" },
            { assetId: ASSET_ID, type: "theft" },
          ],
        }),
      });

      const payload = await expectError(res, 409, "INCIDENT_ITEM_EXISTS");
      expect(payload.error.meta.assetId).toBe(ASSET_ID);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_ERROR for a malformed asset id", async () => {
      const res = await testApp.request("/incidents", {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({
          reservationId: RESERVATION_ID,
          items: [{ assetId: "not-a-uuid", type: "damage" }],
        }),
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

  /**
   * M1: without a list, a host could only open a claim whose id they already
   * had — so "which claims are near their escalation deadline", the question the
   * deadline column exists to answer, was unanswerable.
   */
  describe("GET /incidents", () => {
    const page = {
      data: [createdIncident],
      pagination: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
    };

    it("returns the paginated claims for the apartment", async () => {
      mockList.mockResolvedValue(page);

      const res = await testApp.request(
        `/incidents?apartmentId=${APARTMENT_ID}`,
        { headers: AUTHED_HEADERS },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.pagination.totalItems).toBe(1);
      expect(mockList).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ apartmentId: APARTMENT_ID, page: 1, limit: 20 }),
      );
    });

    /**
     * The list is apartment-scoped and ownership is asserted BEFORE the query
     * runs, so an unscoped list cannot exist. A query without `apartmentId` is a
     * validation failure, not a silent "all claims" — which would have returned
     * every host's claims to every host.
     */
    it("returns 400 VALIDATION_ERROR without an apartmentId", async () => {
      const res = await testApp.request("/incidents", {
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 400, "VALIDATION_ERROR");
      expect(mockList).not.toHaveBeenCalled();
    });

    it("asserts ownership against the queried apartment", async () => {
      mockList.mockResolvedValue(page);

      await testApp.request(`/incidents?apartmentId=${APARTMENT_ID}`, {
        headers: AUTHED_HEADERS,
      });

      expect(mockAssertApartmentOwnership).toHaveBeenCalledWith(
        expect.any(Object),
        APARTMENT_ID,
        expect.objectContaining({ userId: USER_ID }),
      );
    });

    it("passes the filters through to the service", async () => {
      mockList.mockResolvedValue(page);

      await testApp.request(
        `/incidents?apartmentId=${APARTMENT_ID}&status=draft&emergencyOnly=true&sortBy=escalation&order=asc`,
        { headers: AUTHED_HEADERS },
      );

      expect(mockList).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          status: "draft",
          emergencyOnly: true,
          sortBy: "escalation",
          order: "asc",
        }),
      );
    });

    it("returns 401 without a token", async () => {
      const res = await testApp.request(
        `/incidents?apartmentId=${APARTMENT_ID}`,
      );

      await expectError(res, 401, "AUTH_TOKEN_MISSING");
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

  /**
   * M5: `finalPayoutRequestedCents` had no writer at all, so the amount the
   * host was asking for could never be recorded.
   */
  describe("PATCH /incidents/:id", () => {
    it("writes the requested payout", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockUpdate.mockResolvedValue({
        ...createdIncident,
        finalPayoutRequestedCents: 45000,
      });

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        method: "PATCH",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ finalPayoutRequestedCents: 45000 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.finalPayoutRequestedCents).toBe(45000);
      expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object), INCIDENT_ID, {
        finalPayoutRequestedCents: 45000,
      });
    });

    /**
     * Status is a server-owned transition, not an editable field: accepting it
     * here would let a host mark a claim `resolved` without filing it.
     */
    it("ignores a status the client tries to set", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockUpdate.mockResolvedValue(createdIncident);

      await testApp.request(`/incidents/${INCIDENT_ID}`, {
        method: "PATCH",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ finalPayoutRequestedCents: 1000, status: "resolved" }),
      });

      expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object), INCIDENT_ID, {
        finalPayoutRequestedCents: 1000,
      });
    });

    it("returns 409 INCIDENT_NOT_EDITABLE once the claim has been filed", async () => {
      mockGetById.mockResolvedValue({
        ...createdIncident,
        status: "submitted_to_guest",
      });

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        method: "PATCH",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ finalPayoutRequestedCents: 45000 }),
      });

      await expectError(res, 409, "INCIDENT_NOT_EDITABLE", /can no longer be changed/);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_ERROR for a negative amount", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        method: "PATCH",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ finalPayoutRequestedCents: -1 }),
      });

      await expectError(res, 400, "VALIDATION_ERROR");
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("returns 404 INCIDENT_NOT_FOUND for an unknown claim", async () => {
      mockGetById.mockResolvedValue(null);

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        method: "PATCH",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ finalPayoutRequestedCents: 1 }),
      });

      await expectError(res, 404, "INCIDENT_NOT_FOUND");
    });
  });

  /**
   * The dead end Q1 describes: a claim opened by mistake consumed the
   * reservation's one claim slot forever, because nothing could remove it.
   */
  describe("DELETE /incidents/:id", () => {
    it("removes the claim", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockDelete.mockResolvedValue({ success: true, id: INCIDENT_ID });

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        method: "DELETE",
        headers: AUTHED_HEADERS,
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, id: INCIDENT_ID });
    });

    it("returns 409 INCIDENT_NOT_EDITABLE once the claim has been filed", async () => {
      mockGetById.mockResolvedValue({ ...createdIncident, status: "resolved" });

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        method: "DELETE",
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 409, "INCIDENT_NOT_EDITABLE");
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("returns 404 INCIDENT_NOT_FOUND for an unknown claim", async () => {
      mockGetById.mockResolvedValue(null);

      const res = await testApp.request(`/incidents/${INCIDENT_ID}`, {
        method: "DELETE",
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 404, "INCIDENT_NOT_FOUND");
    });
  });

  /**
   * D1: the other half of the separated create. Before this an item could only
   * exist if it was named at create time, so a host who found a second damaged
   * asset had no way to add it.
   */
  describe("POST /incidents/:id/items", () => {
    const body = { assetId: ASSET_ID, type: "damage" };

    it("adds the item and returns 201 with its field token", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockAddItem.mockResolvedValue({
        ...hydratedItem(),
        cleanerToken: "abc123",
      });

      const res = await testApp.request(`/incidents/${INCIDENT_ID}/items`, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.cleanerToken).toBe("abc123");
      // The token is minted here because the host has to relay it; no read route
      // ever returns it.
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.any(Object),
        INCIDENT_ID,
        body,
      );
    });

    it("returns 409 INCIDENT_ITEM_EXISTS when the asset is already on the claim", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockAddItem.mockResolvedValue(null);

      const res = await testApp.request(`/incidents/${INCIDENT_ID}/items`, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      const payload = await expectError(res, 409, "INCIDENT_ITEM_EXISTS");
      expect(payload.error.meta.assetId).toBe(ASSET_ID);
    });

    it("returns 404 ASSET_NOT_FOUND for an unknown asset", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGetAssetApartment.mockResolvedValue(null);

      const res = await testApp.request(`/incidents/${INCIDENT_ID}/items`, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 404, "ASSET_NOT_FOUND");
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    /**
     * An asset from another apartment would put a different flat's furniture on
     * this guest's claim.
     */
    it("returns 400 ASSET_NOT_IN_APARTMENT for an asset in another apartment", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGetAssetApartment.mockResolvedValue({
        id: ASSET_ID,
        apartmentId: "11111111-1111-1111-1111-111111111111",
      });

      const res = await testApp.request(`/incidents/${INCIDENT_ID}/items`, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 400, "ASSET_NOT_IN_APARTMENT");
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    it("returns 409 INCIDENT_NOT_EDITABLE once the claim has been filed", async () => {
      mockGetById.mockResolvedValue({
        ...createdIncident,
        status: "submitted_to_guest",
      });

      const res = await testApp.request(`/incidents/${INCIDENT_ID}/items`, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 409, "INCIDENT_NOT_EDITABLE");
      expect(mockAddItem).not.toHaveBeenCalled();
    });

    it("returns 404 INCIDENT_NOT_FOUND for an unknown claim", async () => {
      mockGetById.mockResolvedValue(null);

      const res = await testApp.request(`/incidents/${INCIDENT_ID}/items`, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify(body),
      });

      await expectError(res, 404, "INCIDENT_NOT_FOUND");
    });
  });

  describe("PATCH /incidents/:id/items/:itemId", () => {
    it("corrects the item's value", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockUpdateItem.mockResolvedValue(itemRow({ estimatedPlaceholderValueCents: 30000 }));

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}`,
        {
          method: "PATCH",
          headers: AUTHED_HEADERS,
          body: JSON.stringify({ estimatedPlaceholderValueCents: 30000 }),
        },
      );

      expect(res.status).toBe(200);
      expect(mockUpdateItem).toHaveBeenCalledWith(
        expect.any(Object),
        INCIDENT_ID,
        ITEM_ID,
        { estimatedPlaceholderValueCents: 30000 },
      );
    });

    it("re-types an item that still has no evidence", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockCountActiveEvidence.mockResolvedValue(0);
      mockUpdateItem.mockResolvedValue(itemRow({ type: "theft" }));

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}`,
        {
          method: "PATCH",
          headers: AUTHED_HEADERS,
          body: JSON.stringify({ type: "theft" }),
        },
      );

      expect(res.status).toBe(200);
    });

    /**
     * The field surface validated what the cleaner submitted against the type
     * the item had. Re-typing it afterwards would leave evidence that no longer
     * answers the question it was collected for.
     */
    it("returns 409 INCIDENT_ITEM_LOCKED when re-typing an item that has evidence", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockCountActiveEvidence.mockResolvedValue(1);

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}`,
        {
          method: "PATCH",
          headers: AUTHED_HEADERS,
          body: JSON.stringify({ type: "theft" }),
        },
      );

      await expectError(res, 409, "INCIDENT_ITEM_LOCKED", /already has evidence/);
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    /** A value change is still allowed on an item that has evidence. */
    it("still allows a value change on an item that has evidence", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockCountActiveEvidence.mockResolvedValue(3);
      mockUpdateItem.mockResolvedValue(itemRow());

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}`,
        {
          method: "PATCH",
          headers: AUTHED_HEADERS,
          body: JSON.stringify({ estimatedPlaceholderValueCents: 1000 }),
        },
      );

      expect(res.status).toBe(200);
      // The lock is about the TYPE only, so the evidence count is never even
      // read for a value-only change.
      expect(mockUpdateItem).toHaveBeenCalled();
    });

    it("returns 404 INCIDENT_ITEM_NOT_FOUND for an item on another claim", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGetItem.mockResolvedValue(null);

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}`,
        {
          method: "PATCH",
          headers: AUTHED_HEADERS,
          body: JSON.stringify({ estimatedPlaceholderValueCents: 1 }),
        },
      );

      await expectError(res, 404, "INCIDENT_ITEM_NOT_FOUND");
      expect(mockUpdateItem).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_ERROR for a malformed item id", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/not-a-uuid`,
        {
          method: "PATCH",
          headers: AUTHED_HEADERS,
          body: JSON.stringify({ estimatedPlaceholderValueCents: 1 }),
        },
      );

      await expectError(res, 400, "VALIDATION_ERROR");
    });
  });

  describe("DELETE /incidents/:id/items/:itemId", () => {
    it("removes the item", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockDeleteItem.mockResolvedValue({ id: ITEM_ID });

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}`,
        { method: "DELETE", headers: AUTHED_HEADERS },
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, id: ITEM_ID });
    });

    /**
     * The recovery path D3 needs: an item whose link expired unused can be
     * removed and re-added, which mints a fresh token. Without this a dead link
     * permanently bricked that asset's evidence.
     */
    it("returns 404 INCIDENT_ITEM_NOT_FOUND when the item is gone", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGetItem.mockResolvedValue(null);

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}`,
        { method: "DELETE", headers: AUTHED_HEADERS },
      );

      await expectError(res, 404, "INCIDENT_ITEM_NOT_FOUND");
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });

    it("returns 409 INCIDENT_NOT_EDITABLE once the claim has been filed", async () => {
      mockGetById.mockResolvedValue({ ...createdIncident, status: "resolved" });

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}`,
        { method: "DELETE", headers: AUTHED_HEADERS },
      );

      await expectError(res, 409, "INCIDENT_NOT_EDITABLE");
      expect(mockDeleteItem).not.toHaveBeenCalled();
    });
  });

  describe("POST /incidents/:id/items/:itemId/upload-tokens", () => {
    const url = `/incidents/${INCIDENT_ID}/items/${ITEM_ID}/upload-tokens`;

    it("mints upload tokens for images and PDFs alike", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGenerateHostUploadTokens.mockResolvedValue([
        { uploadUrl: "https://upload.example/a", key: "k1" },
      ]);

      const res = await testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({
          files: [{ fileType: "image/jpeg" }, { fileType: "application/pdf" }],
        }),
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        tokens: [{ uploadUrl: "https://upload.example/a", key: "k1" }],
      });
      // D6: the DOCUMENT half of the enum was unreachable because only images
      // were accepted anywhere.
      expect(mockGenerateHostUploadTokens).toHaveBeenCalledWith(
        undefined,
        undefined,
        { incidentId: INCIDENT_ID, itemId: ITEM_ID },
        ["image/jpeg", "application/pdf"],
      );
    });

    it("returns 400 VALIDATION_ERROR for a file type that is neither", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ files: [{ fileType: "application/zip" }] }),
      });

      await expectError(res, 400, "VALIDATION_ERROR");
      expect(mockGenerateHostUploadTokens).not.toHaveBeenCalled();
    });

    it("returns 400 MAX_EVIDENCE_EXCEEDED for an oversized batch", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({
          files: Array.from({ length: 21 }, () => ({ fileType: "image/jpeg" })),
        }),
      });

      const payload = await expectError(res, 400, "MAX_EVIDENCE_EXCEEDED");
      expect(payload.error.meta.limit).toBe(20);
      expect(mockGenerateHostUploadTokens).not.toHaveBeenCalled();
    });

    it("returns 404 INCIDENT_ITEM_NOT_FOUND for an item on another claim", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGetItem.mockResolvedValue(null);

      const res = await testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ files: [{ fileType: "image/jpeg" }] }),
      });

      await expectError(res, 404, "INCIDENT_ITEM_NOT_FOUND");
    });
  });

  /**
   * D6/D4: the host's write path, and the only place the DOCUMENT half of
   * `evidence_file_type` was ever reachable — a receipt or a repair quote is a
   * PDF at least as often as it is a photo.
   */
  describe("POST /incidents/:id/items/:itemId/evidence", () => {
    const url = `/incidents/${INCIDENT_ID}/items/${ITEM_ID}/evidence`;
    const key = `incidents/${INCIDENT_ID}/${ITEM_ID}/abc.pdf`;

    const attach = (evidence: unknown[]) =>
      testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
        body: JSON.stringify({ evidence }),
      });

    it("attaches a document and reports the item's new status", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockAttachEvidence.mockResolvedValue({
        attachedCount: 1,
        itemStatus: "complete",
      });
      mockGetItemWithAsset.mockResolvedValue(
        hydratedItem({ status: "complete" }),
      );

      const res = await attach([
        { evidenceType: "original_purchase_receipt", storageKey: key },
      ]);

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.attachedCount).toBe(1);
      expect(data.item.status).toBe("complete");
    });

    it("accepts both photo and document evidence for the same item", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockAttachEvidence.mockResolvedValue({
        attachedCount: 2,
        itemStatus: "complete",
      });

      const res = await attach([
        {
          evidenceType: "damage_photo_wide",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/a.jpg`,
        },
        { evidenceType: "handyman_invoice", storageKey: key },
      ]);

      expect(res.status).toBe(201);
    });

    it("returns 400 EVIDENCE_TYPE_MISMATCH for a theft photo on a damage item", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await attach([
        {
          evidenceType: "theft_empty_space_photo",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/a.jpg`,
        },
      ]);

      const payload = await expectError(res, 400, "EVIDENCE_TYPE_MISMATCH",
        /damage item only accepts evidence of type/);
      // Documents are valid for every type; only the photos are type-specific.
      expect(payload.error.meta.allowed).toContain("original_purchase_receipt");
      expect(payload.error.meta.allowed).not.toContain("theft_empty_space_photo");
      expect(mockAttachEvidence).not.toHaveBeenCalled();
    });

    /**
     * A PDF receipt has no capture time or coordinates, so storing three
     * meaningless nulls would make the EXIF columns lie about what was captured.
     */
    it("returns 400 EVIDENCE_METADATA_INVALID for a document carrying EXIF", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await attach([
        {
          evidenceType: "original_purchase_receipt",
          storageKey: key,
          capturedAt: "2026-11-07T09:30:00.000Z",
          latitude: 44.8125,
        },
      ]);

      await expectError(res, 400, "EVIDENCE_METADATA_INVALID", /is a document/);
      expect(mockAttachEvidence).not.toHaveBeenCalled();
    });

    it("allows EXIF on a photo", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockAttachEvidence.mockResolvedValue({
        attachedCount: 1,
        itemStatus: "photos_collected",
      });

      const res = await attach([
        {
          evidenceType: "damage_photo_wide",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/a.jpg`,
          capturedAt: "2026-11-07T09:30:00.000Z",
          latitude: 44.8125,
          longitude: 20.4612,
        },
      ]);

      expect(res.status).toBe(201);
    });

    it("returns 400 EVIDENCE_KEY_INVALID for a key minted for another item", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await attach([
        {
          evidenceType: "original_purchase_receipt",
          storageKey: "apartments/somebody-elses/photo.jpg",
        },
      ]);

      await expectError(res, 400, "EVIDENCE_KEY_INVALID", /was not issued for this item/);
      expect(mockAttachEvidence).not.toHaveBeenCalled();
    });

    it("returns 400 EVIDENCE_KEY_INVALID when one key is repeated in a batch", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await attach([
        { evidenceType: "original_purchase_receipt", storageKey: key },
        { evidenceType: "handyman_invoice", storageKey: key },
      ]);

      // The column is UNIQUE, so this would otherwise surface as a driver error
      // with no way to tell which row was at fault.
      await expectError(res, 400, "EVIDENCE_KEY_INVALID");
      expect(mockAttachEvidence).not.toHaveBeenCalled();
    });

    /**
     * S1: the field surface is unauthenticated and the mint writes nothing, so
     * the count that matters is what the item ALREADY holds.
     */
    it("returns 400 MAX_EVIDENCE_EXCEEDED against the item's existing evidence", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockCountActiveEvidence.mockResolvedValue(19);

      const res = await attach([
        {
          evidenceType: "damage_photo_wide",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/a.jpg`,
        },
        {
          evidenceType: "damage_photo_closeup",
          storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/b.jpg`,
        },
      ]);

      const payload = await expectError(res, 400, "MAX_EVIDENCE_EXCEEDED");
      // 19 existing + 2 submitted, reported as the total that crossed the line.
      expect(payload.error.meta.submitted).toBe(21);
      expect(mockAttachEvidence).not.toHaveBeenCalled();
    });

    it("returns 404 INCIDENT_ITEM_NOT_FOUND for an item on another claim", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGetItem.mockResolvedValue(null);

      const res = await attach([
        { evidenceType: "original_purchase_receipt", storageKey: key },
      ]);

      await expectError(res, 404, "INCIDENT_ITEM_NOT_FOUND");
    });

    it("returns 409 INCIDENT_NOT_EDITABLE once the claim has been filed", async () => {
      mockGetById.mockResolvedValue({
        ...createdIncident,
        status: "submitted_to_guest",
      });

      const res = await attach([
        { evidenceType: "original_purchase_receipt", storageKey: key },
      ]);

      await expectError(res, 409, "INCIDENT_NOT_EDITABLE");
    });
  });

  /**
   * D4: photos were write-once, so a mistaken upload was permanent and an item
   * could never be corrected.
   */
  describe("DELETE /incidents/:id/items/:itemId/evidence/:evidenceId", () => {
    const url = `/incidents/${INCIDENT_ID}/items/${ITEM_ID}/evidence/${EVIDENCE_ID}`;

    it("withdraws the evidence and reports the item's re-derived status", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockDeleteEvidence.mockResolvedValue({
        id: EVIDENCE_ID,
        itemStatus: "link_generated",
      });

      const res = await testApp.request(url, {
        method: "DELETE",
        headers: AUTHED_HEADERS,
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, id: EVIDENCE_ID });
      expect(mockDeleteEvidence).toHaveBeenCalledWith(expect.any(Object), {
        incidentId: INCIDENT_ID,
        itemId: ITEM_ID,
        evidenceId: EVIDENCE_ID,
      });
    });

    it("returns 404 EVIDENCE_NOT_FOUND for evidence already withdrawn", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockDeleteEvidence.mockResolvedValue(null);

      const res = await testApp.request(url, {
        method: "DELETE",
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 404, "EVIDENCE_NOT_FOUND");
    });

    it("returns 404 INCIDENT_ITEM_NOT_FOUND for an item on another claim", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGetItem.mockResolvedValue(null);

      const res = await testApp.request(url, {
        method: "DELETE",
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 404, "INCIDENT_ITEM_NOT_FOUND");
    });

    it("returns 400 VALIDATION_ERROR for a malformed evidence id", async () => {
      mockGetById.mockResolvedValue(createdIncident);

      const res = await testApp.request(
        `/incidents/${INCIDENT_ID}/items/${ITEM_ID}/evidence/not-a-uuid`,
        { method: "DELETE", headers: AUTHED_HEADERS },
      );

      await expectError(res, 400, "VALIDATION_ERROR");
    });
  });

  /**
   * D3, the audit's most severe finding: the field token is single-use and
   * time-limited, and nothing could mint another — so a claim whose cleaner was
   * slow was permanently unable to collect its evidence.
   */
  describe("POST /incidents/:id/items/:itemId/reissue-token", () => {
    const url = `/incidents/${INCIDENT_ID}/items/${ITEM_ID}/reissue-token`;

    it("mints a fresh field link for an item that never collected anything", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockCountActiveEvidence.mockResolvedValue(0);
      mockReissueToken.mockResolvedValue({
        ...hydratedItem(),
        cleanerToken: "fresh-token",
      });

      const res = await testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.cleanerToken).toBe("fresh-token");
    });

    /**
     * An item that already has evidence has what the link was for, and a second
     * link would be a second way to write to the same item.
     */
    it("returns 409 INCIDENT_ITEM_LOCKED when the item already has evidence", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockCountActiveEvidence.mockResolvedValue(2);

      const res = await testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 409, "INCIDENT_ITEM_LOCKED", /does not need a new link/);
      expect(mockReissueToken).not.toHaveBeenCalled();
    });

    it("returns 409 INCIDENT_NOT_EDITABLE once the claim has been filed", async () => {
      mockGetById.mockResolvedValue({ ...createdIncident, status: "resolved" });

      const res = await testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 409, "INCIDENT_NOT_EDITABLE");
      expect(mockReissueToken).not.toHaveBeenCalled();
    });

    it("returns 404 INCIDENT_ITEM_NOT_FOUND for an item on another claim", async () => {
      mockGetById.mockResolvedValue(createdIncident);
      mockGetItem.mockResolvedValue(null);

      const res = await testApp.request(url, {
        method: "POST",
        headers: AUTHED_HEADERS,
      });

      await expectError(res, 404, "INCIDENT_ITEM_NOT_FOUND");
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

  /**
   * The separation the rework is about, pinned as a property of the CONTRACT
   * rather than of any one handler: an incident and its items are created,
   * edited and deleted by different routes, and evidence is a third level.
   */
  describe("the separated surfaces", () => {
    const doc = () =>
      (incidentsApp as any).getOpenAPIDocument({
        openapi: "3.0.0",
        info: { title: "incidents", version: "1" },
      });

    const methodsAt = (path: string): string[] =>
      Object.keys(doc().paths[path] ?? {}).map((m) => m.toUpperCase());

    it("exposes create, read, list, update and delete for the claim itself", () => {
      expect(methodsAt("/")).toContain("POST");
      expect(methodsAt("/")).toContain("GET");
      expect(methodsAt("/{id}")).toEqual(
        expect.arrayContaining(["GET", "PATCH", "DELETE"]),
      );
    });

    it("exposes add, update and delete for items on an existing claim", () => {
      expect(methodsAt("/{id}/items")).toEqual(["POST"]);
      expect(methodsAt("/{id}/items/{itemId}")).toEqual(
        expect.arrayContaining(["PATCH", "DELETE"]),
      );
    });

    it("exposes upload, attach and withdraw for an item's evidence", () => {
      expect(methodsAt("/{id}/items/{itemId}/upload-tokens")).toEqual(["POST"]);
      expect(methodsAt("/{id}/items/{itemId}/evidence")).toEqual(["POST"]);
      expect(methodsAt("/{id}/items/{itemId}/evidence/{evidenceId}")).toEqual([
        "DELETE",
      ]);
    });

    /**
     * The recovery path for a dead link: without a reissue route an expired
     * token was fatal, because the token is single-use and nothing could mint
     * another (D3).
     */
    it("exposes a route to reissue a dead field link", () => {
      expect(methodsAt("/{id}/items/{itemId}/reissue-token")).toEqual(["POST"]);
    });

    it("documents the item list as optional on the create body", () => {
      const schema = doc().components.schemas.CreateIncident;
      expect(schema.required).not.toContain("items");
      expect(schema.properties.items).toBeDefined();
    });

    /**
     * `cleanerToken` is a credential. It may appear in the create response and
     * in the token-reissue response — the two payloads whose whole purpose is to
     * hand it over — and nowhere else.
     */
    it("carries the cleanerToken only in the token-bearing payload", () => {
      const schemas = doc().components.schemas;

      expect(Object.keys(schemas.IncidentItemWithToken.properties)).toContain(
        "cleanerToken",
      );
      expect(Object.keys(schemas.IncidentItem.properties)).not.toContain(
        "cleanerToken",
      );

      // The create response is `IncidentWithItems` EXTENDED, which OpenAPI
      // renders as an `allOf`: the base carries the claim's fields and the
      // overlay re-declares `items` with the token-bearing item. Asserting the
      // overlay's ref is what pins that the ONE payload allowed to carry a
      // credential is the create response and not, say, the read.
      const overlay = schemas.CreateIncidentResponse.allOf[1];
      expect(
        overlay.properties.items.items.$ref,
      ).toContain("IncidentItemWithToken");
      expect(schemas.CreateIncidentResponse.allOf[0].$ref).toContain(
        "IncidentWithItems",
      );
    });

    /**
     * The photo/document split is on the wire, so a client can render a receipt
     * differently from a photo without re-deriving the enum itself.
     */
    it("puts the derived evidence kind on the wire", () => {
      const evidence = doc().components.schemas.IncidentEvidence;

      expect(Object.keys(evidence.properties)).toContain("kind");
      expect(evidence.properties.kind.enum).toEqual(["photo", "document"]);
    });
  });
});
