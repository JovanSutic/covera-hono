import { z } from "@hono/zod-openapi";
import { accessScopeEnum } from "@/db";

export const AccessScopeSchema = z
  .enum(accessScopeEnum.enumValues)
  .openapi("AccessScope", {
    description: "The named resource group this link opens.",
    example: "inspection_proof",
  });

export const SpecialAccessSchema = z
  .object({
    id: z.uuid(),
    accessId: z.string(),
    scope: AccessScopeSchema,
    apartmentId: z.uuid(),
    reservationId: z.uuid().nullable(),
    incidentItemId: z.uuid().nullable(),
    expiresAt: z.string().datetime(),
    revokedAt: z.string().datetime().nullable(),
    usedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi("SpecialAccess");

export const CreateSpecialAccessSchema = z
  .object({
    scope: AccessScopeSchema,
    reservationId: z.uuid().optional(),
    incidentItemId: z.uuid().optional(),
    expiresInHours: z.number().int().min(1).max(72).default(12),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "inspection_proof" && !value.reservationId) {
      ctx.addIssue({ code: "custom", path: ["reservationId"], message: "An inspection_proof link must name the reservation it covers." });
    }
    if (value.scope === "damage_evidence" && !value.incidentItemId) {
      ctx.addIssue({ code: "custom", path: ["incidentItemId"], message: "A damage_evidence link must name the claim item it covers." });
    }
    if (value.reservationId && value.incidentItemId) {
      ctx.addIssue({ code: "custom", path: ["scope"], message: "A link covers one subject: supply a reservationId or an incidentItemId, not both." });
    }
  })
  .openapi("CreateSpecialAccess", {
    description:
      "Mints one access link. Exactly one subject is required, and which one depends " +
      "on the scope: `inspection_proof` requires `reservationId`, `damage_evidence` " +
      "requires `incidentItemId`, and supplying both is refused. That rule is enforced " +
      "at runtime by `superRefine`, which JSON Schema cannot express — so this document " +
      "shows only `scope` as required, and a `400 VALIDATION_ERROR` is the enforcement.",
  });

export const CreateSpecialAccessResponseSchema = z.object({ access: SpecialAccessSchema }).openapi("CreateSpecialAccessResponse");
export const RevokeSpecialAccessResponseSchema = z.object({ success: z.literal(true), accessId: z.string() }).openapi("RevokeSpecialAccessResponse");

export const AccessIdParamSchema = z.object({
  accessId: z.string().openapi({ param: { name: "accessId", in: "path" }, example: "9f1c2b3a4d5e6f708192a3b4c5d6e7f8" }),
});

/**
 * The credential a link-holder sends, as a QUERY parameter. One definition, spread
 * into every token-enabled route's `request.query` (D6):
 *
 *   request: { query: AccessIdQuerySchema }
 *   request: { query: GetShotsQuerySchema.extend(AccessIdQuerySchema.shape) }
 *
 * It must stay OPTIONAL, and it must never be paired with a route-level
 * `security: [...]` array: the guard is either-or (session OR token) and an
 * OpenAPI `security` entry means "required" (D7).
 */
export const AccessIdQuerySchema = z.object({
  accessId: z
    .string()
    .optional()
    .openapi({
      param: { name: "accessId", in: "query" },
      description:
        "The access link's credential. Supplying it selects the token path — the " +
        "bearer session is then not consulted, not even as a fallback. Omitting it " +
        "(or sending it empty) uses the session path as before.",
      example: "9f1c2b3a4d5e6f708192a3b4c5d6e7f8",
    }),
});

export type CreateSpecialAccess = z.infer<typeof CreateSpecialAccessSchema>;
export type SpecialAccessGrant = z.infer<typeof SpecialAccessSchema>;

/**
 * The introspection payload, deliberately NARROWER than `SpecialAccess` (D21).
 *
 * The route is anonymous — the `accessId` in the path is the caller's own
 * credential — so it must not return more than the link already grants. The row
 * `id`, `revokedAt`, `usedAt` and `createdAt` are internal or management data
 * with no use to a link-holder, so they are not in this shape at all.
 */
export const SpecialAccessIntrospectionSchema = z
  .object({
    scope: AccessScopeSchema,
    apartmentId: z.uuid(),
    reservationId: z.uuid().nullable(),
    incidentItemId: z.uuid().nullable(),
    expiresAt: z.string().datetime(),
  })
  .openapi("SpecialAccessIntrospection");

/**
 * The list filter. `reservationId` is REQUIRED rather than optional (D24): the
 * only consumer is the reservation page, and an apartment-wide list would need
 * its own ownership resolution for no caller that exists.
 */
export const ListSpecialAccessQuerySchema = z.object({
  reservationId: z.uuid().openapi({
    param: { name: "reservationId", in: "query" },
    description: "The reservation whose access links should be listed.",
    example: "987e6543-e21b-12d3-a456-426614174000",
  }),
});

/**
 * The host's list of links (D25, D26).
 *
 * It reuses `SpecialAccessSchema` rather than declaring a near-copy — so it DOES
 * carry `accessId`, which is a deliberate relaxation of the rule stated on
 * `createSpecialAccessRoute` ("the response carries `accessId` — the only payload
 * that does"). It is safe only because this route is host-authorized against the
 * grant's own apartment, and it is required: without `accessId` the host cannot
 * rebuild the shareable URL, which is the whole point of the list.
 *
 * Revoked grants are included for the same reason: a host needs to see that a
 * link is dead, and needs the id to say which.
 */
export const SpecialAccessListSchema = z
  .array(SpecialAccessSchema)
  .openapi("SpecialAccessList");
