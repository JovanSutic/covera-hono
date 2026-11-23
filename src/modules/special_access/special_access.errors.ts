import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

/**
 * The three special-access codes (D8). Every message states the condition and the
 * next step, and none names an id, a target, or the token — those go to `meta`
 * only (invariant 7), because a message that echoed them would turn a 403 into an
 * existence oracle for the resource.
 */
export const specialAccessErrors = defineErrors(
  {
    invalid: {
      status: 403 as const,
      code: "SPECIAL_ACCESS_INVALID" as const,
      description: "The access link is not valid, has expired, or has been revoked.",
      message:
        "This access link is no longer usable. It may have expired or been revoked. " +
        "Ask the host for a new link.",
    },
    scopeMismatch: {
      status: 403 as const,
      code: "SPECIAL_ACCESS_SCOPE_MISMATCH" as const,
      description: "The access link does not cover this resource.",
      message:
        "This access link does not cover the resource you asked for. " +
        "Open the resource the link was created for.",
    },
    notFound: {
      status: 404 as const,
      code: "SPECIAL_ACCESS_NOT_FOUND" as const,
      description: "The access grant does not exist.",
      message: "That access link does not exist.",
    },
  },
  StandardErrorSchema,
);
