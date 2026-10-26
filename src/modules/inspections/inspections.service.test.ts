import { describe, it, expect, vi } from "vitest";
import { inspectionsService } from "./inspections.service";

const INSPECTION_ID = "880e8400-e29b-41d4-a716-446655440000";
const RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440000";
const APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const ASSET_ID = "550e8400-e29b-41d4-a716-446655440000";
const ASSET_TYPE_ID = "440e8400-e29b-41d4-a716-446655440000";

const ASSET_TYPE = {
  id: ASSET_TYPE_ID,
  code: "SMART_LOCK",
  category: "ELECTRONICS",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** A row as the relational query returns it: the catalogue row hangs off `assetType`. */
const ASSET_ROW = {
  id: ASSET_ID,
  apartmentId: APARTMENT_ID,
  name: "Front door smart lock",
  category: "ELECTRONICS",
  roomLocation: "ENTRANCE_HALLWAY",
  description: null,
  photoProofRequirement: "CLOSEUP",
  approximateValueCents: null,
  assetTypeId: ASSET_TYPE_ID,
  ageBracket: null,
  valueTier: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  assetType: ASSET_TYPE,
};

const FIXTURE = {
  id: INSPECTION_ID,
  reservationId: RESERVATION_ID,
  visited: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  flags: [
    {
      id: "110e8400-e29b-41d4-a716-446655440000",
      inspectionId: INSPECTION_ID,
      flagAssets: [{ asset: ASSET_ROW }],
    },
  ],
  reservation: {
    id: RESERVATION_ID,
    apartmentId: APARTMENT_ID,
    images: [],
    apartment: {
      id: APARTMENT_ID,
      name: "Sunny Loft",
      address: "1 Main St",
      currency: "EUR",
      externalId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      shots: [
        {
          id: "220e8400-e29b-41d4-a716-446655440000",
          apartmentId: APARTMENT_ID,
          roomLocation: "ENTRANCE_HALLWAY",
          shotType: "CLOSEUP",
          title: "Front door",
          instructions: "Photograph the lock",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          shotAssets: [{ asset: ASSET_ROW }],
        },
      ],
    },
  },
};

const mockDb = (result: unknown = FIXTURE) => {
  const findFirst = vi.fn().mockResolvedValue(result);
  return { db: { query: { inspections: { findFirst } } } as any, findFirst };
};

describe("inspectionsService.getById (detailed)", () => {
  it("nests the catalogue row as asset_type on every shot asset", async () => {
    const { db } = mockDb();

    const result: any = await inspectionsService.getById(db, INSPECTION_ID, true);

    expect(result.shots[0].assets[0].asset_type).toEqual(ASSET_TYPE);
  });

  it("nests the catalogue row as asset_type on every flag asset", async () => {
    const { db } = mockDb();

    const result: any = await inspectionsService.getById(db, INSPECTION_ID, true);

    expect(result.flags[0].assets[0].asset_type).toEqual(ASSET_TYPE);
  });

  it("does not leak the relational alias `assetType` into the payload", async () => {
    const { db } = mockDb();

    const result: any = await inspectionsService.getById(db, INSPECTION_ID, true);

    expect(result.shots[0].assets[0]).not.toHaveProperty("assetType");
    expect(result.flags[0].assets[0]).not.toHaveProperty("assetType");
  });

  it("asks the relational query for the type on both branches", async () => {
    const { db, findFirst } = mockDb();

    await inspectionsService.getById(db, INSPECTION_ID, true);

    const args = findFirst.mock.calls[0][0];
    expect(args.with.flags.with.flagAssets.with.asset.with.assetType).toBe(true);
    expect(
      args.with.reservation.with.apartment.with.shots.with.shotAssets.with.asset
        .with.assetType,
    ).toBe(true);
  });

  it("still returns null when the inspection has no reservation", async () => {
    const { db } = mockDb({ id: INSPECTION_ID, reservation: null });

    const result = await inspectionsService.getById(db, INSPECTION_ID, true);

    expect(result).toBeNull();
  });
});
