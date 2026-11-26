import { createModuleApp } from "@/core/utils/module-app";
import {
  createSpecialAccessRoute,
  getSpecialAccessRoute,
  listSpecialAccessRoute,
  revokeSpecialAccessRoute,
} from "./special_access.contract";
import { specialAccessService } from "./special_access.service";
import { specialAccessErrors } from "./special_access.errors";
import { incidentErrors } from "../incidents/incidents.errors";
import { reservationErrors } from "../reservations/reservations.errors";
import { assertApartmentOwnership } from "@/core/utils/db-validator";

const app = createModuleApp();

app.openapi(createSpecialAccessRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const user = c.get("user");

  if (!user) {
    throw incidentErrors.unauthenticated();
  }

  // The subject decides the apartment, and the apartment is what ownership is
  // asserted against — so a client cannot bind a grant to an apartment it does
  // not own (D13, D16). The schema's `superRefine` already guarantees exactly one
  // subject is present for the scope, so the branch below cannot fall through.
  const subject = await specialAccessService.resolveSubjectApartment(
    db,
    body.scope === "inspection_proof"
      ? { reservationId: body.reservationId! }
      : { incidentItemId: body.incidentItemId! },
  );

  if (!subject) {
    // Reported in the vocabulary of the module that owns the subject, so the
    // caller sees RESERVATION_NOT_FOUND / INCIDENT_ITEM_NOT_FOUND rather than a
    // special-access code about something they did not ask for.
    if (body.scope === "inspection_proof") {
      throw reservationErrors.notFound({ id: body.reservationId! });
    }

    throw incidentErrors.itemNotFound({ itemId: body.incidentItemId! });
  }

  await assertApartmentOwnership(db, subject.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  const access = await specialAccessService.create(db, body, subject, user.id);

  return c.json({ access }, 201);
});

app.openapi(revokeSpecialAccessRoute, async (c) => {
  const db = c.get("db");
  const { accessId } = c.req.valid("param");
  const user = c.get("user");

  if (!user) {
    throw incidentErrors.unauthenticated();
  }

  // MANAGEMENT lookup, not the redemption one: a revoked or expired grant must
  // still be findable so that revoking it again is the idempotent 200 of D15
  // rather than a 404 that a client cannot distinguish from a lost response.
  const grant = await specialAccessService.findByToken(db, accessId);

  if (!grant) {
    throw specialAccessErrors.notFound({ accessId });
  }

  // Ownership, asserted against the grant's own apartment. Without this any host
  // could revoke a link belonging to another host's apartment — the 403 this
  // contract already declares would never have been produced.
  await assertApartmentOwnership(db, grant.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  await specialAccessService.revokeById(db, grant.id);

  return c.json({ success: true as const, accessId }, 200);
});

app.openapi(getSpecialAccessRoute, async (c) => {
  const db = c.get("db");
  const { accessId } = c.req.valid("param");

  const grant = await specialAccessService.resolveByToken(db, accessId);

  if (!grant) {
    // One code for unknown, expired and revoked alike — asking which one it was
    // is asking for an existence oracle.
    throw specialAccessErrors.invalid({});
  }

  // Built field by field rather than spreading the row: `SpecialAccessSchema`
  // includes `id`, `revokedAt`, `usedAt` and `createdAt`, and an anonymous caller
  // must not receive them (D21). A spread here would silently widen the payload
  // the day a column is added.
  return c.json(
    {
      scope: grant.scope,
      apartmentId: grant.apartmentId,
      reservationId: grant.reservationId,
      incidentItemId: grant.incidentItemId,
      expiresAt: new Date(grant.expiresAt).toISOString(),
    },
    200,
  );
});

app.openapi(listSpecialAccessRoute, async (c) => {
  const db = c.get("db");
  const { reservationId } = c.req.valid("query");
  const user = c.get("user");

  if (!user) {
    throw incidentErrors.unauthenticated();
  }

  // Ownership is asserted against the SUBJECT's apartment, exactly as create and
  // revoke do. Resolving through the reservation is what makes this host-scoped:
  // the apartment comes from the reservation, never from the caller.
  const subject = await specialAccessService.resolveSubjectApartment(db, {
    reservationId,
  });

  if (!subject) {
    throw reservationErrors.notFound({ id: reservationId });
  }

  await assertApartmentOwnership(db, subject.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  const grants = await specialAccessService.listByReservation(db, reservationId);

  return c.json(grants, 200);
});

export default app;
