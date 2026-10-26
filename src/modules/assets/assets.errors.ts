import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const assetErrors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "ASSET_NOT_FOUND" as const,
      description: "Asset does not exist.",
      message: "Asset does not exist.",
    },
    typeInvalid: {
      status: 400 as const,
      code: "ASSET_TYPE_INVALID" as const,
      description: "The referenced asset type does not exist.",
      message: "The asset type you selected does not exist. Choose one from GET /assets/types.",
    },
    locked: {
      status: 409 as const,
      code: "ASSET_LOCKED" as const,
      description: "Asset is locked by an active reservation.",
      message: (ctx: { action: "update" | "delete" }) =>
        `This asset cannot be ${ctx.action === "delete" ? "deleted" : "changed"} because it is part ` +
        "of a shot for a reservation that is currently covered. Wait until that reservation is closed, " +
        "or remove the asset from the shot first.",
    },
  },
  StandardErrorSchema,
);
