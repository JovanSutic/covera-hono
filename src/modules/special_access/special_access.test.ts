import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import specialAccessApp from "./special_access.route";
import { usersService } from "../users/users.service";
import { ForbiddenException } from "@/core/errors/error.exceptions";

const {
  mockResolveSubjectApartment,
  mockCreate,
  mockFindByToken,
  mockRevokeById,
  mockAssertApartmentOwnership,
} = vi.hoisted(() => ({
  mockResolveSubjectApartment: vi.fn(),
  mockCreate: vi.fn(),
  mockFindByToken: vi.fn(),
  mockRevokeById: vi.fn(),
  mockAssertApartmentOwnership: vi.fn(),
}));

vi.mock("./special_access.service", () => ({
  specialAccessService: {
    resolveSubjectApartment: mockResolveSubjectApartment,
    create: mockCreate,
    findByToken: mockFindByToken,
    revokeById: mockRevokeById,
  },
}));

vi.mock("../users/users.service", () => ({
  usersService: { getByAuthId: vi.fn() },
}));

vi.mock("@/core/utils/db-validator", () => ({
  assertApartmentOwnership: mockAssertApartmentOwnership,
}));

const mockedUserService = usersService as unknown as {
  getByAuthId: ReturnType<typeof vi.fn>;
};

const OWNER_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655440099";
const APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440000";
const ITEM_ID = "880e8400-e29b-41d4-a716-446655440000";
const MOCK_JWT = "Bearer test-token";

const mockGetUser = vi.fn();
const mockUpdateUserById = vi.fn();
let currentTestUser = { id: OWNER_ID, email: "host@example.com", role: "host" };

const testApp = createTestApp({
  contextOverrides: () => ({
    getUser: mockGetUser,
    updateUserById: mockUpdateUserById,
    authUser: currentTestUser,
  }),
});
testApp.route("/special-access", specialAccessApp);

/** Wires the session path: a confirmed user whose db row this suite controls. */
const asUser = (id: string = OWNER_ID, role: "host" | "admin" | "guest" = "host") => {
  currentTestUser = { id, email: `${role}@example.com`, role };
  mockGetUser.mockResolvedValue({
    data: { user: { id, email: `${role}@example.com` } },
    error: null,
  });
  mockedUserService.getByAuthId.mockResolvedValue({
    id,
    authId: id,
    role,
    status: "confirmed",
  });
};

const post = (body: unknown) =>
  testApp.request("/special-access", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: MOCK_JWT },
    body: JSON.stringify(body),
  });

const del = (token: string) =>
  testApp.request(`/special-access/${token}`, {
    method: "DELETE",
    headers: { Authorization: MOCK_JWT },
  });

const forbidden = () =>
  new ForbiddenException({
    code: "FORBIDDEN_APARTMENT_ACCESS",
    message: "You do not have access to this apartment.",
  });

beforeEach(() => {
  vi.clearAllMocks();
  asUser();
  mockAssertApartmentOwnership.mockResolvedValue(undefined);
  mockRevokeById.mockResolvedValue("revoked");
});

describe("POST /special-access", () => {
  const inspectionSubject = {
    apartmentId: APARTMENT_ID,
    reservationId: RESERVATION_ID,
    incidentItemId: null,
  };

  it("mints an inspection_proof link and returns 201 carrying the accessId", async () => {
    mockResolveSubjectApartment.mockResolvedValue(inspectionSubject);
    mockCreate.mockResolvedValue({
      id: "id-1",
      accessId: "deadbeefdeadbeefdeadbeefdeadbeef",
      scope: "inspection_proof",
      apartmentId: APARTMENT_ID,
      reservationId: RESERVATION_ID,
      incidentItemId: null,
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      revokedAt: null,
      usedAt: null,
      createdAt: new Date().toISOString(),
    });

    const res = await post({ scope: "inspection_proof", reservationId: RESERVATION_ID });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.access.accessId).toBe("deadbeefdeadbeefdeadbeefdeadbeef");
    // Ownership is asserted against the SUBJECT's apartment, never a client value.
    expect(mockAssertApartmentOwnership).toHaveBeenCalledWith(
      expect.anything(),
      APARTMENT_ID,
      expect.objectContaining({ userId: OWNER_ID, allowAdmin: true }),
    );
  });

  it("defaults expiresInHours to 12 when it is omitted", async () => {
    mockResolveSubjectApartment.mockResolvedValue(inspectionSubject);
    mockCreate.mockResolvedValue({ id: "id-1", accessId: "x" });

    await post({ scope: "inspection_proof", reservationId: RESERVATION_ID });

    expect(mockCreate.mock.calls[0][1].expiresInHours).toBe(12);
  });

  it("derives the apartment server-side rather than trusting the client", async () => {
    mockResolveSubjectApartment.mockResolvedValue(inspectionSubject);
    mockCreate.mockResolvedValue({ id: "id-1", accessId: "x" });

    await post({
      scope: "inspection_proof",
      reservationId: RESERVATION_ID,
      apartmentId: OTHER_ID,
    });

    expect(mockCreate.mock.calls[0][2]).toEqual(inspectionSubject);
  });

  it("rejects an inspection_proof link with no reservationId as a 400", async () => {
    const res = await post({ scope: "inspection_proof" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].field).toContain("reservationId");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a damage_evidence link with no incidentItemId as a 400", async () => {
    const res = await post({ scope: "damage_evidence" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.details[0].field).toContain("incidentItemId");
  });

  it("rejects both subjects at once as a 400", async () => {
    const res = await post({
      scope: "inspection_proof",
      reservationId: RESERVATION_ID,
      incidentItemId: ITEM_ID,
    });

    expect(res.status).toBe(400);
  });

  it("rejects an expiresInHours above the 72-hour cap as a 400", async () => {
    const res = await post({
      scope: "inspection_proof",
      reservationId: RESERVATION_ID,
      expiresInHours: 1000,
    });

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reports an unknown reservation with the reservation module's 404", async () => {
    mockResolveSubjectApartment.mockResolvedValue(null);

    const res = await post({ scope: "inspection_proof", reservationId: RESERVATION_ID });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("RESERVATION_NOT_FOUND");
  });

  it("reports an unknown claim item with the incidents module's 404", async () => {
    mockResolveSubjectApartment.mockResolvedValue(null);

    const res = await post({ scope: "damage_evidence", incidentItemId: ITEM_ID });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("INCIDENT_ITEM_NOT_FOUND");
  });

  it("never mints a grant for a host who does not own the apartment", async () => {
    mockResolveSubjectApartment.mockResolvedValue(inspectionSubject);
    asUser(OTHER_ID);
    mockAssertApartmentOwnership.mockRejectedValue(forbidden());

    const res = await post({ scope: "inspection_proof", reservationId: RESERVATION_ID });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_APARTMENT_ACCESS");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses a guest with 403 FORBIDDEN_ROLE", async () => {
    asUser(OTHER_ID, "guest");

    const res = await post({ scope: "inspection_proof", reservationId: RESERVATION_ID });

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN_ROLE");
  });

  it("refuses an unauthenticated request with 401", async () => {
    const res = await testApp.request("/special-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "inspection_proof", reservationId: RESERVATION_ID }),
    });

    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_TOKEN_MISSING");
  });
});

describe("DELETE /special-access/{accessId}", () => {
  it("revokes a grant owned by the caller and returns 200", async () => {
    mockFindByToken.mockResolvedValue({ id: "id-1", apartmentId: APARTMENT_ID });

    const res = await del("sometoken");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, accessId: "sometoken" });
    expect(mockRevokeById).toHaveBeenCalledWith(expect.anything(), "id-1");
  });

  it("still returns 200 when the grant was already revoked", async () => {
    mockFindByToken.mockResolvedValue({ id: "id-1", apartmentId: APARTMENT_ID });
    mockRevokeById.mockResolvedValue("already");

    const res = await del("sometoken");

    expect(res.status).toBe(200);
  });

  it("returns 404 SPECIAL_ACCESS_NOT_FOUND for an unknown token", async () => {
    mockFindByToken.mockResolvedValue(null);

    const res = await del("nope");

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("SPECIAL_ACCESS_NOT_FOUND");
    expect(mockRevokeById).not.toHaveBeenCalled();
  });

  it("refuses to revoke a grant belonging to another host", async () => {
    mockFindByToken.mockResolvedValue({ id: "id-1", apartmentId: APARTMENT_ID });
    asUser(OTHER_ID);
    mockAssertApartmentOwnership.mockRejectedValue(forbidden());

    const res = await del("sometoken");

    expect(res.status).toBe(403);
    expect(mockRevokeById).not.toHaveBeenCalled();
  });
});
