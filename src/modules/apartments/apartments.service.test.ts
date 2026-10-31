import { describe, it, expect, vi, beforeEach } from "vitest";
import { apartmentsService, MAX_PHOTOS_PER_RESERVATION } from "./apartments.service";
import { toErrorResponse } from "@/core/errors/error.handler";
import { expectError } from "@/core/utils/assert-error";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://upload.example/presigned"),
}));

/**
 * A `db` that fails loudly on any use. `generateUploadTokens` takes no `db` at all, so
 * nothing can reach it; `syncUploadedPhotos` checks its limit before opening the
 * transaction, so nothing should. Handing this in makes "this call must not read the
 * database" an assertion instead of a comment.
 */
const dbThatThrowsOnUse = {
  select: () => {
    throw new Error("this call must not query the database");
  },
  transaction: () => {
    throw new Error("should not reach the transaction");
  },
} as any;

const asResponse = async (fn: () => Promise<unknown>): Promise<Response> => {
  let thrown: unknown;
  let didThrow = false;
  try {
    await fn();
  } catch (e) {
    thrown = e;
    didThrow = true;
  }
  if (!didThrow) throw new Error("expected the call to throw, but it did not");

  const { status, body } = toErrorResponse(thrown);
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
};

describe("generateUploadTokens per-batch limit", () => {
  beforeEach(() => vi.clearAllMocks());

  const request = (fileTypes: string[]) =>
    apartmentsService.generateUploadTokens(
      {} as any,
      "bucket" as any,
      VALID_UUID,
      fileTypes,
    );

  it("returns 400 MAX_PHOTOS_EXCEEDED when one batch asks for more than the limit", async () => {
    const fileTypes = Array.from(
      { length: MAX_PHOTOS_PER_RESERVATION + 1 },
      () => "image/jpeg",
    );

    const res = await asResponse(() => request(fileTypes));

    const body = await expectError(res, 400, "MAX_PHOTOS_EXCEEDED",
      /at most 20 upload tokens at once, but 21 were requested/);

    expect(body.error.meta.limit).toBe(MAX_PHOTOS_PER_RESERVATION);
    expect(body.error.meta.requested).toBe(MAX_PHOTOS_PER_RESERVATION + 1);
  });

  it("permits a batch that lands exactly on the limit", async () => {
    const fileTypes = Array.from(
      { length: MAX_PHOTOS_PER_RESERVATION },
      () => "image/jpeg",
    );

    const tokens = await request(fileTypes);

    expect(tokens).toHaveLength(MAX_PHOTOS_PER_RESERVATION);
    expect(tokens[0]!.uploadUrl).toBe("https://upload.example/presigned");
  });

  /**
   * The regression this guards. The old guard counted every active photo on the
   * APARTMENT and refused once that reached 20, so an apartment holding 20 photos
   * from reservations that had long since closed could never mint another token —
   * photos became unaddable for good. Nothing on this route may depend on how many
   * photos the apartment already has, so `db` is not a parameter here at all and this
   * call has to succeed untouched by any pre-existing count.
   */
  it("does not consult the apartment's existing photo count", async () => {
    const tokens = await apartmentsService.generateUploadTokens(
      {} as any,
      "bucket" as any,
      VALID_UUID,
      ["image/jpeg"],
    );

    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.key).toMatch(
      new RegExp(`^apartments/${VALID_UUID}/[0-9a-f-]{36}\\.jpeg$`),
    );
  });
});

describe("syncUploadedPhotos per-reservation limit", () => {
  const photo = (i: number) => ({ shotId: VALID_UUID, uploadedKey: `key-${i}` });
  const photosOf = (n: number) => Array.from({ length: n }, (_, i) => photo(i));

  /** A `db` whose transaction body is a no-op chain, so a passing call completes. */
  const passThroughDb = {
    transaction: (cb: (tx: any) => Promise<unknown>) => {
      const statement = () => {
        const chain: any = {
          set: () => chain,
          values: () => chain,
          where: () => Promise.resolve(),
          onConflictDoUpdate: () => Promise.resolve(),
        };
        return chain;
      };
      return cb({ update: statement, insert: statement });
    },
  } as any;

  it("returns 400 MAX_PHOTOS_EXCEEDED when too many photos are submitted", async () => {
    const res = await asResponse(() =>
      apartmentsService.syncUploadedPhotos(dbThatThrowsOnUse, VALID_UUID, {
        reservationId: VALID_UUID,
        type: "checkin_state",
        photos: photosOf(MAX_PHOTOS_PER_RESERVATION + 1),
      }),
    );

    const body = await expectError(res, 400, "MAX_PHOTOS_EXCEEDED",
      /confirming 21 photos but the limit is 20 per reservation/);

    expect(body.error.meta.limit).toBe(MAX_PHOTOS_PER_RESERVATION);
    expect(body.error.meta.submitted).toBe(MAX_PHOTOS_PER_RESERVATION + 1);
    expect(body.error.meta.reservationId).toBe(VALID_UUID);
  });

  /**
   * The limit belongs to the reservation, not the apartment: this batch is accepted on
   * its own size, with no reference to how many photos the apartment has accumulated
   * from its other reservations. Every write in the transaction is keyed by
   * `reservationId`, so a prior reservation's photos cannot consume this one's budget.
   */
  it("admits a full batch without consulting the apartment's other photos", async () => {
    const result = await apartmentsService.syncUploadedPhotos(
      passThroughDb,
      VALID_UUID,
      {
        reservationId: VALID_UUID,
        type: "checkin_state",
        photos: photosOf(MAX_PHOTOS_PER_RESERVATION),
      },
    );

    expect(result).toEqual({
      success: true,
      activeCount: MAX_PHOTOS_PER_RESERVATION,
    });
  });
});
