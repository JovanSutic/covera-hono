import { describe, it, expect } from "vitest";
import { StandardErrorSchema } from "./error.schema";
import { defineErrors } from "./error.define";
import { errorResponses, AUTHED, ROLE, APARTMENT_SCOPED } from "./error.responses";
import { ConflictException } from "./error.exceptions";

const assetErrors = defineErrors(
  {
    typeInvalid: {
      status: 400 as const,
      code: "ASSET_TYPE_INVALID" as const,
      description: "The referenced asset type does not exist.",
      message: "The asset type you selected does not exist.",
    },
    locked: {
      status: 409 as const,
      code: "ASSET_LOCKED" as const,
      description: "Asset is locked by an active reservation.",
      message: (ctx: { action: string }) =>
        `Cannot ${ctx.action} this asset because it is part of a shot in an active reservation.`,
    },
  },
  StandardErrorSchema,
);

describe("defineErrors", () => {
  it("groups responses by status", () => {
    expect(Object.keys(assetErrors.responses).map(Number).sort()).toEqual([400, 409]);
    expect(assetErrors.responses[409]!.content["application/json"].example.error.code).toBe("ASSET_LOCKED");
  });

  it("throwers return real exceptions with templated messages", () => {
    const err = assetErrors.locked({ action: "delete" });
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.status).toBe(409);
    expect(err.code).toBe("ASSET_LOCKED");
    expect(err.message).toBe("Cannot delete this asset because it is part of a shot in an active reservation.");
  });

  it("static messages ignore context", () => {
    expect(assetErrors.typeInvalid().message).toBe("The asset type you selected does not exist.");
  });

  it("throwers accept no argument when the message is static", () => {
    expect(() => assetErrors.typeInvalid()).not.toThrow();
  });
});

describe("errorResponses bundles", () => {
  it("includes 403, which the old helper omitted", () => {
    const r = errorResponses([...AUTHED, ...ROLE, ...APARTMENT_SCOPED]);
    expect(Object.keys(r).map(Number).sort()).toEqual([401, 403, 404, 500]);
  });

  it("names every code sharing a status in one entry", () => {
    const r = errorResponses(["APARTMENT_NOT_FOUND", "RESERVATION_NOT_FOUND"]);
    expect(Object.keys(r)).toEqual(["404"]);
    expect(r[404]!.description).toContain("APARTMENT_NOT_FOUND");
    expect(r[404]!.description).toContain("RESERVATION_NOT_FOUND");
  });

  it("uses StandardErrorSchema for every entry", () => {
    const r = errorResponses([...AUTHED]);
    expect(r[401]!.content["application/json"].schema).toBe(StandardErrorSchema);
  });
});