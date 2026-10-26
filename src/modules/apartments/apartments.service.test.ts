import { describe, it, expect, vi, beforeEach } from "vitest";
import { apartmentsService, MAX_PHOTOS_PER_APARTMENT } from "./apartments.service";
import { toErrorResponse } from "@/core/errors/error.handler";
import { expectError } from "@/core/utils/assert-error";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue("https://upload.example/presigned"),
}));

/** `generateUploadTokens` runs a single `select({ val: count() })`. */
const countDb = (val: number) => {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([{ val }]),
    then: (res: any, rej: any) => Promise.resolve([{ val }]).then(res, rej),
  };
  return { select: () => chain } as any;
};

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

describe("generateUploadTokens photo limit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 400 MAX_PHOTOS_EXCEEDED when the request would exceed the limit", async () => {
    const res = await asResponse(() =>
      apartmentsService.generateUploadTokens(
        countDb(MAX_PHOTOS_PER_APARTMENT),
        {} as any,
        "bucket" as any,
        VALID_UUID,
        ["image/jpeg"],
      ),
    );

    const body = await expectError(res, 400, "MAX_PHOTOS_EXCEEDED",
      /already has 20 photos and the limit is 20/);

    expect(body.error.meta.limit).toBe(MAX_PHOTOS_PER_APARTMENT);
    expect(body.error.meta.activeCount).toBe(MAX_PHOTOS_PER_APARTMENT);
  });

  it("permits a request that lands exactly on the limit", async () => {
    const tokens = await apartmentsService.generateUploadTokens(
      countDb(MAX_PHOTOS_PER_APARTMENT - 1),
      {} as any,
      "bucket" as any,
      VALID_UUID,
      ["image/jpeg"],
    );

    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.uploadUrl).toBe("https://upload.example/presigned");
  });
});

describe("syncUploadedPhotos photo limit", () => {
  /** The limit is checked before the transaction opens, so `db` is never touched. */
  const unusedDb = { transaction: () => { throw new Error("should not reach the transaction"); } } as any;

  const photo = (i: number) => ({ shotId: VALID_UUID, uploadedKey: `key-${i}` });

  it("returns 400 MAX_PHOTOS_EXCEEDED when too many photos are submitted", async () => {
    const photos = Array.from({ length: MAX_PHOTOS_PER_APARTMENT + 1 }, (_, i) => photo(i));

    const res = await asResponse(() =>
      apartmentsService.syncUploadedPhotos(unusedDb, VALID_UUID, {
        reservationId: VALID_UUID,
        type: "checkin_state",
        photos,
      }),
    );

    const body = await expectError(res, 400, "MAX_PHOTOS_EXCEEDED",
      /confirming 21 photos but the limit is 20/);

    expect(body.error.meta.submitted).toBe(MAX_PHOTOS_PER_APARTMENT + 1);
  });
});
