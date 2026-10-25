import { defineErrors } from "@/core/errors/error.define";
import { StandardErrorSchema } from "@/core/errors/error.schema";

export const userErrors = defineErrors(
  {
    notFound: {
      status: 404 as const,
      code: "USER_NOT_FOUND" as const,
      description: "User does not exist.",
      message: "User does not exist.",
    },
    duplicate: {
      status: 409 as const,
      code: "DUPLICATE_RECORD" as const,
      description: "A record with these values already exists.",
      message: "A record with these values already exists.",
    },
    unauthenticated: {
      status: 401 as const,
      code: "AUTH_TOKEN_MISSING" as const,
      description: "No authentication token was supplied.",
      message: "Authentication is required.",
    },
    authProvider: {
      status: 400 as const,
      code: "AUTH_PROVIDER_ERROR" as const,
      description: "The authentication provider rejected the request.",
      message: "The account could not be created with the authentication provider. Please try again.",
    },
    invitation: {
      status: 400 as const,
      code: "INVITATION_ERROR" as const,
      description: "The invitation could not be dispatched.",
      message: "The invitation email could not be sent. Please check the email address and try again.",
    },
  },
  StandardErrorSchema,
);
