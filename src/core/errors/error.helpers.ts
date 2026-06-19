import { StandardErrorSchema } from "./error.schema";

const createErrorResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: StandardErrorSchema,
    },
  },
});

export const commonErrors = {
  badRequest: createErrorResponse("Bad Request: One or more parameters failed validation."),
  unauthorized: createErrorResponse("Unauthorized: Missing or invalid token."),
  forbidden: createErrorResponse("Forbidden: You do not have permission to access this resource."),
  internalServerError: createErrorResponse("Internal Server Error: Something went wrong on our end."),
  conflict: (resource: string) => createErrorResponse(`Conflict: This ${resource} already exists.`),
  notFound: (resource: string) => createErrorResponse(`Not Found: The requested ${resource} could not be found.`),

  // 🚀 UPDATED: Now bundles 404 alongside your other standard errors
  getStandardResponses: (resource: string) => ({
    400: commonErrors.badRequest,
    401: commonErrors.unauthorized,
    404: commonErrors.notFound(resource), // Automatically handles 404 mapping for the resource
    409: commonErrors.conflict(resource),
    500: commonErrors.internalServerError,
  }),
};
