import { createModuleApp } from "@/core/utils/module-app";
import {
  createIncidentRoute,
  getIncidentRoute,
  confirmAirbnbFilingRoute,
} from "./incidents.contract";
import { incidentsService } from "./incidents.service";
import { incidentErrors } from "./incidents.errors";
import { reservationsService } from "../reservations/reservations.service";
import { assertApartmentOwnership } from "@/core/utils/db-validator";

const app = createModuleApp();

const FILE_WINDOW_DAYS = 14;

/** `alternative ?? primary`, with the epoch guard the repo uses everywhere. */
const effectiveTime = (
  primary: Date | string,
  alternative?: Date | string | null,
): Date => {
  if (alternative) {
    const alt = new Date(alternative);
    if (!Number.isNaN(alt.getTime()) && alt.getTime() > 0) return alt;
  }
  return new Date(primary);
};

/**
 * Resolves one claim and asserts the caller may read it — the shared front half
 * of the two id-scoped routes. Extracted rather than duplicated because they
 * must fail identically: a divergence here would make the filing route answer
 * 403 where the read answers 404, and the client cannot tell those apart.
 *
 * Ownership is asserted through the reservation's apartment rather than by
 * `apartmentGuard`, which resolves an unknown id through the apartments table
 * first and would report APARTMENT_NOT_FOUND for a claim that does not exist
 * (D21, mirroring reservations.route.ts D5).
 */
async function resolveOwnedIncident(c: any, id: string) {
  const db = c.get("db");
  const user = c.get("user");

  if (!user) {
    throw incidentErrors.unauthenticated();
  }

  const incident = await incidentsService.getById(db, id);

  if (!incident) {
    throw incidentErrors.notFound({ id });
  }

  const reservation = await reservationsService.getById(db, incident.reservationId);

  if (!reservation) {
    throw incidentErrors.notFound({ id });
  }

  await assertApartmentOwnership(db, reservation.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  return { db, incident };
}

app.openapi(createIncidentRoute, async (c) => {
  const db = c.get("db");
  const body = c.req.valid("json");
  const user = c.get("user");

  if (!user) {
    throw incidentErrors.unauthenticated();
  }

  // The reservation first: it carries the apartment ownership is asserted
  // against, and it is the row both windows are computed from.
  const reservation = await reservationsService.getById(db, body.reservationId);

  if (!reservation) {
    throw incidentErrors.reservationNotFound({ id: body.reservationId });
  }

  await assertApartmentOwnership(db, reservation.apartmentId, {
    userId: user.id,
    role: user.role,
    allowAdmin: true,
  });

  const effectiveCheckOut = effectiveTime(
    reservation.checkOutDatetime,
    reservation.alternativeCheckOutDatetime,
  );
  const now = new Date();

  // Trigger A, clause 1 (D9): Airbnb's filing limit, measured from this stay's
  // effective check-out.
  if (now > new Date(effectiveCheckOut.getTime() + FILE_WINDOW_DAYS * 24 * 60 * 60 * 1000)) {
    throw incidentErrors.windowExpired({
      reason: "checkout",
      deadline: effectiveCheckOut.toISOString(),
    });
  }

  // Trigger A, clause 2 and the emergency flag come out of ONE call, so the
  // two can never disagree about which guest is next or when they arrive. The
  // next guest's arrival is the deadline: while they are still ahead the claim
  // is open, and once they have arrived the turnover is over.
  const feasibility = await incidentsService.assessFeasibility(
    db,
    reservation.apartmentId,
    {
      reservationId: reservation.id,
      effectiveCheckOut,
      now,
    },
  );

  if (feasibility.nextCheckIn && now > feasibility.nextCheckIn) {
    throw incidentErrors.windowExpired({
      reason: "checkin",
      deadline: feasibility.nextCheckIn.toISOString(),
    });
  }

  const existing = await incidentsService.getByReservationId(db, body.reservationId);

  if (existing) {
    throw incidentErrors.alreadyExists({ reservationId: body.reservationId });
  }

  // Every claimed asset must belong to the apartment the stay was in. Checked
  // before the insert so the client gets the offending asset named, rather than
  // a constraint failure.
  for (const item of body.items) {
    const asset = await incidentsService.getAssetApartment(db, item.assetId);

    if (!asset) {
      throw incidentErrors.assetNotFound({ id: item.assetId });
    }

    if (asset.apartmentId !== reservation.apartmentId) {
      throw incidentErrors.assetNotInApartment({ assetId: item.assetId });
    }
  }

  const created = await incidentsService.create(db, body, {
    effectiveCheckOut,
    isEmergencyMode: feasibility.isEmergency,
  });

  return c.json(created, 201);
});

app.openapi(getIncidentRoute, async (c) => {
  const { id } = c.req.valid("param");

  const { incident } = await resolveOwnedIncident(c, id);

  return c.json(incident, 200);
});

app.openapi(confirmAirbnbFilingRoute, async (c) => {
  const { id } = c.req.valid("param");

  const { db, incident } = await resolveOwnedIncident(c, id);

  if (incident.status === "submitted_to_guest") {
    throw incidentErrors.alreadyFiled({ id });
  }

  if (incident.status !== "ready_to_file") {
    throw incidentErrors.notReady({ status: incident.status });
  }

  const filed = await incidentsService.confirmAirbnbFiling(db, id);

  if (!filed) {
    // Lost a race with a concurrent filing: the row moved out of the
    // filable set between the read above and this update.
    throw incidentErrors.alreadyFiled({ id });
  }

  return c.json(filed, 200);
});

export default app;
