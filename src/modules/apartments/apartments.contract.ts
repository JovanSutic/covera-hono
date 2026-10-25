import { createRoute, z } from "@hono/zod-openapi";

import {
  ApartmentsListSchema,
  ApartmentWithLocationSchema,
  ApartmentsWithLocationListSchema,
  ConfirmUploadBodySchema,
  ConfirmUploadResponseSchema,
  CreateApartmentSchema,
  RequestUploadTokensSchema,
  UploadTokensResponseSchema,
} from "./apartments.schema";
import { authGuard } from "@/middleware/authGuard";
import { rolesGuard } from "@/middleware/roleGuard";
import { errorResponses, AUTHED, ROLE, APARTMENT_SCOPED, VALIDATION } from "@/core/errors/error.responses";
import { apartmentGuard } from "@/middleware/apartmentGuard";

const getApartmentsErrors = errorResponses([...AUTHED]);
const getApartmentByIdErrors = errorResponses([...AUTHED, ...VALIDATION, "APARTMENT_NOT_FOUND"]);
const createApartmentErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...VALIDATION,
  "USER_NOT_FOUND",
  "LOCATION_NOT_FOUND",
  "RELATED_RECORD_INVALID",
]);
const requestUploadTokensErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "MAX_PHOTOS_EXCEEDED",
]);
const confirmUploadErrors = errorResponses([
  ...AUTHED,
  ...ROLE,
  ...APARTMENT_SCOPED,
  ...VALIDATION,
  "MAX_PHOTOS_EXCEEDED",
  "DUPLICATE_RECORD",
]);
const getApartmentsByHostErrors = errorResponses([...AUTHED, ...ROLE, "USER_NOT_FOUND"]);

export const getApartmentsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Apartments"],
  middleware: [authGuard] as const,
  responses: {
    200: {
      description: "List apartments",
      content: {
        "application/json": {
          schema: ApartmentsListSchema,
        },
      },
    },
    ...getApartmentsErrors,
  },
});

export const getApartmentByIdRoute = createRoute({
  method: "get",
  path: "/{id}",
  tags: ["Apartments"],
  middleware: [authGuard] as const,
  request: {
    params: z.object({
      id: z.string().uuid("Invalid apartment UUID"),
    }),
  },
  responses: {
    200: {
      description: "Apartment detail",
      content: {
        "application/json": {
          schema: ApartmentWithLocationSchema,
        },
      },
    },
    ...getApartmentByIdErrors,
  },
});

export const createApartmentRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Apartments"],
  middleware: [authGuard, rolesGuard(["admin"])] as const,
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateApartmentSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Apartment created",
      content: {
        "application/json": {
          schema: ApartmentWithLocationSchema,
        },
      },
    },
    ...createApartmentErrors,
  },
});

export const requestUploadTokensRoute = createRoute({
  method: "post",
  path: "/{id}/photos/upload-tokens",
  tags: ["Apartments"],
  middleware: [authGuard, rolesGuard(["admin", "host"]), apartmentGuard(false)] as const,
  request: {
    params: z.object({
      id: z.string().uuid("Invalid apartment UUID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: RequestUploadTokensSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Presigned R2 upload URLs generated successfully",
      content: {
        "application/json": {
          schema: UploadTokensResponseSchema,
        },
      },
    },
    ...requestUploadTokensErrors,
  },
});

export const confirmUploadRoute = createRoute({
  method: "post",
  path: "/{id}/photos/confirm",
  tags: ["Apartments"],
  middleware: [authGuard, rolesGuard(["admin", "host"]), apartmentGuard(false)] as const,
  request: {
    params: z.object({
      id: z.string().uuid("Invalid apartment UUID"),
    }),
    body: {
      content: {
        "application/json": {
          schema: ConfirmUploadBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Uploaded image states synchronized successfully",
      content: {
        "application/json": {
          schema: ConfirmUploadResponseSchema,
        },
      },
    },
    ...confirmUploadErrors,
  },
});

export const getApartmentsByHostRoute = createRoute({
  method: "get",
  path: "/host/me",
  tags: ["Apartments"],
  middleware: [authGuard, rolesGuard(["host"])] as const,
  responses: {
    200: {
      description: "List apartments owned by the logged-in host",
      content: {
        "application/json": {
          schema: ApartmentsWithLocationListSchema,
        },
      },
    },
    ...getApartmentsByHostErrors,
  },
});