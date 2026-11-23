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
  .openapi("CreateSpecialAccess");

export const CreateSpecialAccessResponseSchema = z.object({ access: SpecialAccessSchema }).openapi("CreateSpecialAccessResponse");
export const RevokeSpecialAccessResponseSchema = z.object({ success: z.literal(true), accessId: z.string() }).openapi("RevokeSpecialAccessResponse");

export const AccessIdParamSchema = z.object({
  accessId: z.string().openapi({ param: { name: "accessId", in: "path" }, example: "9f1c2b3a4d5e6f708192a3b4c5d6e7f8" }),
});

export type CreateSpecialAccess = z.infer<typeof CreateSpecialAccessSchema>;
export type SpecialAccessGrant = z.infer<typeof SpecialAccessSchema>;
