import { describe, it, expect, vi } from "vitest";
import { reservationsService } from "./reservations.service";

const RESERVATION_ID = "770e8400-e29b-41d4-a716-446655440000";
const APARTMENT_ID = "660e8400-e29b-41d4-a716-446655440000";
const PHOTOGRAPHED_SHOT_ID = "220e8400-e29b-41d4-a716-446655440000";
const UNPHOTOGRAPHED_SHOT_ID = "221e8400-e29b-41d4-a716-446655440000";

const ASSET_TYPE = {
  id: "440e8400-e29b-41d4-a716-446655440000",
  code: "SMART_LOCK",
  category: "ELECTRONICS",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** A row as the relational query returns it: the catalogue row hangs off `assetType`. */
const ASSET_ROW = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  apartmentId: APARTMENT_ID,
  name: "Front door smart lock",
  category: "ELECTRONICS",
  roomLocation: "ENTRANCE_HALLWAY",
  description: null,
  photoProofRequirement: "CLOSEUP",
  approximateValueCents: null,
  assetTypeId: ASSET_TYPE.id,
  ageBracket: null,
  valueTier: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  assetType: ASSET_TYPE,
};

const shot = (id: string, title: string, shotAssets: unknown[] = []) => ({
  id,
  apartmentId: APARTMENT_ID,
  roomLocation: "ENTRANCE_HALLWAY",
  shotType: "CLOSEUP",
  title,
  instructions: "Photograph it",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  shotAssets,
});

const image = (
  id: string,
  shotId: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  apartmentId: APARTMENT_ID,
  shotId,
  reservationId: RESERVATION_ID,
  type: "checkin_state",
  storageKey: `reservations/${RESERVATION_ID}/${id}.jpg`,
  uploadedAt: "2026-01-02T10:00:00.000Z",
  status: "active",
  deletedAt: null,
  ...overrides,
});

/** The relational query result: reservation → images + apartment.shots[].shotAssets. */
const reservationRow = (overrides: Record<string, unknown> = {}) => ({
  id: RESERVATION_ID,
  apartmentId: APARTMENT_ID,
  images: [image("a1", PHOTOGRAPHED_SHOT_ID)],
  apartment: {
    id: APARTMENT_ID,
    name: "Sunny Loft",
    shots: [
      shot(PHOTOGRAPHED_SHOT_ID, "Front door", [{ asset: ASSET_ROW }]),
      shot(UNPHOTOGRAPHED_SHOT_ID, "Kitchen"),
    ],
  },
  ...overrides,
});

const mockDb = (result: unknown = reservationRow()) => {
  const findFirst = vi.fn().mockResolvedValue(result);
  return { db: { query: { reservations: { findFirst } } } as any, findFirst };
};

describe("reservationsService.getProofPhotos", () => {
  it("nests the catalogue row as asset_type, like the inspection tree does", async () => {
    const { db } = mockDb();

    const result = await reservationsService.getProofPhotos(db, RESERVATION_ID);

    expect(result[0].assets[0].asset_type).toEqual(ASSET_TYPE);
  });

  it("does not leak the relational alias `assetType` into the payload", async () => {
    const { db } = mockDb();

    const result = await reservationsService.getProofPhotos(db, RESERVATION_ID);

    expect(result[0].assets[0]).not.toHaveProperty("assetType");
  });

  it("returns ONLY shots that carry an active image", async () => {
    const { db } = mockDb();

    const result = await reservationsService.getProofPhotos(db, RESERVATION_ID);

    // The kitchen shot exists on the apartment but was never photographed. The
    // inspection tree keeps it; a photo read must not, or the dialog renders an
    // empty card for every unshot room.
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(PHOTOGRAPHED_SHOT_ID);
  });

  it("drops soft-deleted images, so the count cannot exceed what renders", async () => {
    const { db } = mockDb(
      reservationRow({
        images: [
          image("a1", PHOTOGRAPHED_SHOT_ID),
          image("a2", PHOTOGRAPHED_SHOT_ID, {
            status: "soft_deleted",
            deletedAt: "2026-01-03T10:00:00.000Z",
          }),
        ],
      }),
    );

    const result = await reservationsService.getProofPhotos(db, RESERVATION_ID);

    expect(result[0].images).toHaveLength(1);
    expect(result[0].images[0].id).toBe("a1");
  });

  it("drops an image whose status is active but which carries a deletedAt", async () => {
    const { db } = mockDb(
      reservationRow({
        images: [
          image("a1", PHOTOGRAPHED_SHOT_ID, { deletedAt: "2026-01-03T10:00:00.000Z" }),
        ],
      }),
    );

    const result = await reservationsService.getProofPhotos(db, RESERVATION_ID);

    // Both halves of the predicate are load-bearing: `summarizeShotProofs` and
    // `RoomPhotoItem` require active AND not deleted, and a shot kept alive by a
    // half-applied soft delete would show an empty card.
    expect(result).toEqual([]);
  });

  it("excludes an image belonging to a different shot than the one it hangs off", async () => {
    const { db } = mockDb(
      reservationRow({
        // Two images on one shot and none on the other: the filter is per shot, not
        // "the reservation has photos, so return every shot".
        images: [
          image("a1", PHOTOGRAPHED_SHOT_ID),
          image("a2", PHOTOGRAPHED_SHOT_ID),
        ],
      }),
    );

    const result = await reservationsService.getProofPhotos(db, RESERVATION_ID);

    expect(result).toHaveLength(1);
    expect(result[0].images.map((entry: { id: string }) => entry.id)).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("returns an empty list when the reservation has no images", async () => {
    const { db } = mockDb(reservationRow({ images: [] }));

    const result = await reservationsService.getProofPhotos(db, RESERVATION_ID);

    expect(result).toEqual([]);
  });

  it("returns an empty list rather than throwing when the reservation is gone", async () => {
    const { db } = mockDb(null);

    // The route resolves the reservation and asserts ownership BEFORE calling this,
    // so a missing row here means it was deleted mid-request. An empty list is the
    // honest answer; throwing would report a 500 for a read that is simply empty.
    await expect(
      reservationsService.getProofPhotos(db, RESERVATION_ID),
    ).resolves.toEqual([]);
  });

  it("asks the relational query for images and the apartment's shots", async () => {
    const { db, findFirst } = mockDb();

    await reservationsService.getProofPhotos(db, RESERVATION_ID);

    const args = findFirst.mock.calls[0][0];
    expect(args.with.images).toBe(true);
    // The asset catalogue must be reached through the junction, or every shot comes
    // back with an empty `assets` and the dialog loses its asset chips.
    expect(
      args.with.apartment.with.shots.with.shotAssets.with.asset.with.assetType,
    ).toBe(true);
  });
});
