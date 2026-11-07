import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTestApp } from "@/core/utils/test-factory";
import fieldApp from "./incidents.field.route";
import { incidentErrors } from "./incidents.errors";
import { expectError } from "@/core/utils/assert-error";

const {
  mockGetFieldContext,
  mockGetFieldAsset,
  mockGetBaselinePhotos,
  mockGetFieldEvidenceGuidance,
  mockGenerateUploadTokens,
  mockCountActiveEvidence,
  mockSubmitFieldEvidence,
} = vi.hoisted(() => ({
  mockGetFieldContext: vi.fn(),
  mockGetFieldAsset: vi.fn(),
  mockGetBaselinePhotos: vi.fn(),
  mockGetFieldEvidenceGuidance: vi.fn(),
  mockGenerateUploadTokens: vi.fn(),
  mockCountActiveEvidence: vi.fn(),
  mockSubmitFieldEvidence: vi.fn(),
}));

vi.mock("./incidents.service", async () => {
  // The pure helpers stay REAL: `requiredPhotoTypes` and `MAX_EVIDENCE_PER_ITEM`
  // are the rules the routes enforce, so stubbing them would make these tests
  // assert that the mocks were called rather than that the rule holds.
  const actual = await vi.importActual<typeof import("./incidents.service")>(
    "./incidents.service",
  );

  return {
    ...actual,
    incidentsService: {
      getFieldContext: mockGetFieldContext,
      getFieldAsset: mockGetFieldAsset,
      getBaselinePhotos: mockGetBaselinePhotos,
      getFieldEvidenceGuidance: mockGetFieldEvidenceGuidance,
      generateFieldUploadTokens: mockGenerateUploadTokens,
      countActiveEvidence: mockCountActiveEvidence,
      submitFieldEvidence: mockSubmitFieldEvidence,
    },
  };
});

const TOKEN = "b01924ce7c9f4d37856e5b3701d35909";
const INCIDENT_ID = "880e8400-e29b-41d4-a716-446655440000";
const ITEM_ID = "aa0e8400-e29b-41d4-a716-446655440000";

const testApp = createTestApp();
testApp.route("/field/ingest", fieldApp);

const fieldContext = (overrides: Record<string, unknown> = {}) => ({
  item: {
    id: ITEM_ID,
    type: "damage",
    status: "link_generated",
    tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
  },
  incidentId: INCIDENT_ID,
  apartmentId: "660e8400-e29b-41d4-a716-446655440000",
  apartmentName: "Sunset Loft",
  reservationId: "770e8400-e29b-41d4-a716-446655440000",
  effectiveCheckOut: new Date(),
  ...overrides,
});

const asset = {
  id: "990e8400-e29b-41d4-a716-446655440000",
  name: "Samsung 55\" TV",
  roomLocation: "LIVING_ROOM",
  description: "Wall mounted",
};

const validPhotos = () => [
  {
    evidenceType: "damage_photo_wide" as const,
    storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/key-1.jpg`,
  },
];

describe("Field intake routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFieldContext.mockResolvedValue(fieldContext());
    mockGetFieldAsset.mockResolvedValue(asset);
    mockGetBaselinePhotos.mockResolvedValue([]);
    mockGetFieldEvidenceGuidance.mockResolvedValue({
      requiredEvidenceTypes: [
        "damage_photo_wide",
        "damage_photo_closeup",
      ],
      attachedEvidenceCounts: {},
    });
    mockGenerateUploadTokens.mockResolvedValue([
      { uploadUrl: "https://upload.example/presigned", key: "k" },
    ]);
    mockCountActiveEvidence.mockResolvedValue(0);
    mockSubmitFieldEvidence.mockResolvedValue({
      itemStatus: "photos_collected",
      evidenceCount: 1,
    });
  });

  describe("GET /field/ingest/:token", () => {
    it("returns what the cleaner needs and nothing else", async () => {
      const res = await testApp.request(`/field/ingest/${TOKEN}`);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.incidentType).toBe("damage");
      expect(data.asset.name).toBe(asset.name);
      expect(data.apartmentName).toBe("Sunset Loft");
      expect(data.baselinePhotos).toEqual([]);
    });

    /**
     * The prep doc's central ask — "the system needs to drive the user what
     * needs to be provided" — answered where the user is standing. Before this
     * the cleaner was shown a bare file picker with no indication of which
     * shots the item expects.
     */
    it("tells the cleaner which evidence this item needs and what is already in", async () => {
      mockGetFieldEvidenceGuidance.mockResolvedValue({
        requiredEvidenceTypes: ["damage_photo_wide", "damage_photo_closeup"],
        attachedEvidenceCounts: { damage_photo_wide: 1 },
      });

      const res = await testApp.request(`/field/ingest/${TOKEN}`);

      const data = await res.json();
      expect(data.requiredEvidenceTypes).toEqual([
        "damage_photo_wide",
        "damage_photo_closeup",
      ]);
      expect(data.attachedEvidenceCounts).toEqual({ damage_photo_wide: 1 });
      expect(mockGetFieldEvidenceGuidance).toHaveBeenCalledWith(
        expect.any(Object),
        ITEM_ID,
        "damage",
      );
    });

    /**
     * V2: the baseline is scoped to the ASSET being photographed, not the whole
     * apartment. A cleaner photographing a damaged kettle framed against last
     * stay's living-room shots would be invited to reproduce the wrong
     * composition.
     */
    it("scopes the baseline photos to the asset, not the apartment", async () => {
      await testApp.request(`/field/ingest/${TOKEN}`);

      expect(mockGetBaselinePhotos).toHaveBeenCalledWith(
        expect.any(Object),
        undefined,
        undefined,
        "660e8400-e29b-41d4-a716-446655440000",
        expect.any(Date),
        asset.id,
      );
    });

    /**
     * The feature's headline invariant, asserted against the SERIALISED body
     * rather than the schema. A schema-only assertion would still pass if the
     * handler spread a rich row into the response, which is exactly the mistake
     * a later edit makes.
     */
    it("leaks no guest identity and no money", async () => {
      mockGetFieldEvidenceGuidance.mockResolvedValue({
        requiredEvidenceTypes: ["damage_photo_wide", "damage_photo_closeup"],
        attachedEvidenceCounts: { damage_photo_wide: 1 },
      });

      const res = await testApp.request(`/field/ingest/${TOKEN}`);
      const raw = await res.text();

      for (const forbidden of [
        "guest",
        "email",
        "_cents",
        "Cents",
        "payout",
        "amount",
        "owner",
        "authId",
        // The guidance fields are counts and type names only — a storage key
        // here would hand an unauthenticated caller the bucket layout.
        "storageKey",
        "incidents/",
        "cleanerToken",
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    });

    it("returns 404 FIELD_TOKEN_INVALID for an unknown token", async () => {
      mockGetFieldContext.mockResolvedValue(null);

      const res = await testApp.request(`/field/ingest/${TOKEN}`);

      await expectError(res, 404, "FIELD_TOKEN_INVALID", /no longer valid/);
    });

    /**
     * A used token and an expired token must be indistinguishable from a token
     * that never existed — the service collapses all three to `null`. This pins
     * that the route adds no distinguishing branch of its own.
     */
    it("answers an expired token exactly as it answers an unknown one", async () => {
      mockGetFieldContext.mockResolvedValue(null);

      const res = await testApp.request(`/field/ingest/${TOKEN}`);
      const body: any = await res.json();

      expect(body.error.code).toBe("FIELD_TOKEN_INVALID");
      // Nothing about the token itself comes back, so the route is not an
      // oracle for guessing them.
      expect(body.error.message).not.toContain(TOKEN);
    });

    it("requires no Authorization header", async () => {
      const res = await testApp.request(`/field/ingest/${TOKEN}`, {
        headers: {},
      });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /field/ingest/:token/upload-tokens", () => {
    it("mints presigned URLs under the item's own prefix", async () => {
      const res = await testApp.request(
        `/field/ingest/${TOKEN}/upload-tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: [{ fileType: "image/jpeg" }] }),
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.tokens).toHaveLength(1);
      expect(mockGenerateUploadTokens).toHaveBeenCalledWith(
        undefined, // createTestApp sets no s3; the route passes whatever it finds
        undefined,
        { incidentId: INCIDENT_ID, itemId: ITEM_ID },
        ["image/jpeg"],
      );
    });

    it("returns 400 VALIDATION_ERROR for a non-image file type", async () => {
      const res = await testApp.request(
        `/field/ingest/${TOKEN}/upload-tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: [{ fileType: "application/pdf" }] }),
        },
      );

      await expectError(res, 400, "VALIDATION_ERROR");
      expect(mockGenerateUploadTokens).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_ERROR for an empty photo list", async () => {
      const res = await testApp.request(
        `/field/ingest/${TOKEN}/upload-tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: [] }),
        },
      );

      await expectError(res, 400, "VALIDATION_ERROR");
    });

    /**
     * S1: this route is unauthenticated and minting writes nothing, so both the
     * batch AND the item's existing count are bounded here. Without the second,
     * the batch bound is bypassed by calling this route once per photo.
     */
    it("returns 400 MAX_EVIDENCE_EXCEEDED for an oversized batch", async () => {
      const res = await testApp.request(
        `/field/ingest/${TOKEN}/upload-tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            photos: Array.from({ length: 21 }, () => ({ fileType: "image/jpeg" })),
          }),
        },
      );

      const payload = await expectError(res, 400, "MAX_EVIDENCE_EXCEEDED");
      expect(payload.error.meta.limit).toBe(20);
      expect(mockGenerateUploadTokens).not.toHaveBeenCalled();
    });

    it("returns 400 MAX_EVIDENCE_EXCEEDED when the item is already at the limit", async () => {
      mockCountActiveEvidence.mockResolvedValue(20);

      const res = await testApp.request(
        `/field/ingest/${TOKEN}/upload-tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: [{ fileType: "image/jpeg" }] }),
        },
      );

      const payload = await expectError(res, 400, "MAX_EVIDENCE_EXCEEDED");
      expect(payload.error.meta.submitted).toBe(21);
      expect(mockGenerateUploadTokens).not.toHaveBeenCalled();
    });

    it("returns 404 FIELD_TOKEN_INVALID for a dead token", async () => {
      mockGetFieldContext.mockResolvedValue(null);

      const res = await testApp.request(
        `/field/ingest/${TOKEN}/upload-tokens`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photos: [{ fileType: "image/jpeg" }] }),
        },
      );

      await expectError(res, 404, "FIELD_TOKEN_INVALID");
      expect(mockGenerateUploadTokens).not.toHaveBeenCalled();
    });
  });

  describe("POST /field/ingest/:token/submit", () => {
    const submit = (body: unknown) =>
      testApp.request(`/field/ingest/${TOKEN}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    it("records the evidence and reports the item's new status", async () => {
      const res = await submit({ photos: validPhotos() });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.itemStatus).toBe("photos_collected");
      expect(data.evidenceCount).toBe(1);
    });

    it("accepts close-ups for a damage item", async () => {
      const res = await submit({
        photos: [
          {
            evidenceType: "damage_photo_closeup",
            storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/key-2.jpg`,
          },
        ],
      });

      expect(res.status).toBe(200);
    });

    /**
     * D13's cross-field rule. The enum alone cannot express it, so without this
     * check a theft claim could be filed with damage close-ups.
     */
    it("returns 400 EVIDENCE_TYPE_MISMATCH when a theft item is sent damage photos", async () => {
      mockGetFieldContext.mockResolvedValue(
        fieldContext({
          item: {
            id: ITEM_ID,
            type: "theft",
            status: "link_generated",
            tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
          },
        }),
      );

      const res = await submit({ photos: validPhotos() });

      const payload = await expectError(res, 400, "EVIDENCE_TYPE_MISMATCH",
        /theft item only accepts evidence of type/);
      expect(payload.error.meta.allowed).toEqual(["theft_empty_space_photo"]);
      expect(mockSubmitFieldEvidence).not.toHaveBeenCalled();
    });

    it("accepts the empty-space photo for a theft item", async () => {
      mockGetFieldContext.mockResolvedValue(
        fieldContext({
          item: {
            id: ITEM_ID,
            type: "theft",
            status: "link_generated",
            tokenExpiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
          },
        }),
      );

      const res = await submit({
        photos: [
          {
            evidenceType: "theft_empty_space_photo",
            storageKey: `incidents/${INCIDENT_ID}/${ITEM_ID}/key-3.jpg`,
          },
        ],
      });

      expect(res.status).toBe(200);
    });

    /**
     * Without the prefix check an unauthenticated caller could point the claim
     * at any object in the bucket, because a token-holder can confirm arbitrary
     * keys. The keys this item's own upload-token route mints are the only ones
     * it may claim.
     *
     * The code is `EVIDENCE_KEY_INVALID`, not `EVIDENCE_TYPE_MISMATCH`: the type
     * was fine, the KEY was never issued here. Reporting the wrong one would send
     * the caller to change a field that is not the problem.
     */
    it("refuses a storage key this item's upload route did not mint", async () => {
      const res = await submit({
        photos: [
          {
            evidenceType: "damage_photo_wide",
            storageKey: "apartments/somebody-elses/photo.jpg",
          },
        ],
      });

      await expectError(res, 400, "EVIDENCE_KEY_INVALID");
      expect(mockSubmitFieldEvidence).not.toHaveBeenCalled();
    });

    /**
     * S1's real enforcement, at the one call that INSERTs. A token-holder could
     * otherwise submit unbounded rows because the mint writes nothing.
     */
    it("returns 400 MAX_EVIDENCE_EXCEEDED when the item is already at the limit", async () => {
      mockCountActiveEvidence.mockResolvedValue(20);

      const res = await submit({ photos: validPhotos() });

      const payload = await expectError(res, 400, "MAX_EVIDENCE_EXCEEDED");
      expect(payload.error.meta.submitted).toBe(21);
      expect(mockSubmitFieldEvidence).not.toHaveBeenCalled();
    });

    it("allows a submit that lands exactly on the limit", async () => {
      mockCountActiveEvidence.mockResolvedValue(19);

      const res = await submit({ photos: validPhotos() });

      expect(res.status).toBe(200);
    });

    it("carries the optional EXIF metadata through", async () => {
      vi.clearAllMocks();
      mockGetFieldContext.mockResolvedValue(fieldContext());
      mockSubmitFieldEvidence.mockResolvedValue({
        itemStatus: "photos_collected",
        evidenceCount: 1,
      });

      const res = await submit({
        descriptionByCleaner: "Screen cracked in the corner",
        photos: [
          {
            ...validPhotos()[0],
            capturedAt: "2026-11-07T09:30:00.000Z",
            latitude: 44.8125,
            longitude: 20.4612,
          },
        ],
      });

      expect(res.status).toBe(200);
      expect(mockSubmitFieldEvidence).toHaveBeenCalledWith(
        expect.any(Object),
        { itemId: ITEM_ID, incidentId: INCIDENT_ID },
        expect.objectContaining({
          descriptionByCleaner: "Screen cracked in the corner",
        }),
      );
    });

    it("returns 404 FIELD_TOKEN_INVALID on a replay", async () => {
      // Single-use (D11): submit burned the token, so the second call resolves
      // no context at all.
      mockGetFieldContext.mockResolvedValue(null);

      const res = await submit({ photos: validPhotos() });

      await expectError(res, 404, "FIELD_TOKEN_INVALID");
      expect(mockSubmitFieldEvidence).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_ERROR for an out-of-range latitude", async () => {
      const res = await submit({
        photos: [{ ...validPhotos()[0], latitude: 91 }],
      });

      await expectError(res, 400, "VALIDATION_ERROR");
      expect(mockSubmitFieldEvidence).not.toHaveBeenCalled();
    });

    it("requires no Authorization header", async () => {
      const res = await submit({ photos: validPhotos() });

      expect(res.status).toBe(200);
    });
  });

  describe("guard registration", () => {
    /**
     * The field surface's defining property, pinned structurally: no 401 or 403
     * may appear in this app's OpenAPI document. `check-contracts.ts` enforces
     * the mirror image (a guarded route MUST declare them); this enforces that
     * nothing here ever becomes guarded without the declaration being revisited.
     */
    it("declares no 401 or 403 on any field route", () => {
      const doc = (fieldApp as any).getOpenAPIDocument({
        openapi: "3.0.0",
        info: { title: "field", version: "1" },
      });

      for (const [path, methods] of Object.entries(doc.paths)) {
        for (const [method, op] of Object.entries(methods as Record<string, any>)) {
          const statuses = Object.keys(op.responses ?? {});
          expect(statuses, `${method.toUpperCase()} ${path}`).not.toContain("401");
          expect(statuses, `${method.toUpperCase()} ${path}`).not.toContain("403");
          expect(statuses, `${method.toUpperCase()} ${path}`).toContain("500");
        }
      }
    });

    it("uses the same FIELD_TOKEN_INVALID thrower on every route", async () => {
      mockGetFieldContext.mockResolvedValue(null);

      const codes = await Promise.all(
        [
          testApp.request(`/field/ingest/${TOKEN}`),
          testApp.request(`/field/ingest/${TOKEN}/upload-tokens`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photos: [{ fileType: "image/jpeg" }] }),
          }),
          testApp.request(`/field/ingest/${TOKEN}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photos: validPhotos() }),
          }),
        ].map(async (p) => {
          const res = await p;
          expect(res.status).toBe(404);
          return ((await res.json()) as any).error.code;
        }),
      );

      expect(codes).toEqual([
        "FIELD_TOKEN_INVALID",
        "FIELD_TOKEN_INVALID",
        "FIELD_TOKEN_INVALID",
      ]);
    });

    it("re-exports the module's thrower unchanged for route use", () => {
      // Guards against a second, drifting definition of the same failure.
      const err = incidentErrors.fieldTokenInvalid({});
      expect(err.status).toBe(404);
      expect(err.code).toBe("FIELD_TOKEN_INVALID");
    });
  });
});
