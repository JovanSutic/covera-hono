import { createMiddleware } from "hono/factory";
import { App, Variables } from "@/types";
import { authGuard } from "./authGuard";
import { rolesGuard, type UserRole } from "./roleGuard";
import { specialAccessService } from "../modules/special_access/special_access.service";
import { specialAccessErrors } from "../modules/special_access/special_access.errors";
import type { AccessScope } from "@/db";

/**
 * Where a route's protected target lives, and therefore what the grant must
 * match. Named explicitly per route because the routes disagree on their param
 * name (`/apartments/{id}` vs `/apartment-shots/apartment/{apartmentId}`), so an
 * implicit "find an id" resolver would be wrong on half of them (D11).
 *
 * `incidentParam` is the one kind that needs a read of its own: an incident id is
 * not a reservation id, so the guard resolves the incident's `reservationId` and
 * compares that. Binding such a route by `apartmentParam` instead would match the
 * grant's apartment while letting a link scoped to ONE reservation open a claim
 * for a different stay in the same apartment — which is precisely the narrowing
 * `targetMatches` exists to preserve.
 */
export type AccessBind =
  | { kind: "reservationParam"; param: string }
  | { kind: "apartmentParam"; param: string }
  | { kind: "incidentParam"; param: string }
  | { kind: "reservationBody"; field: string };

/**
 * The single guard for every token-enabled route (D10).
 *
 * EITHER-OR, never additive (D5, D6):
 *
 *  - No `?accessId=` → `authGuard` runs, then `rolesGuard(roles)` if `roles` was
 *    supplied, exactly as the route did before this guard existed. Reached by
 *    CALLING those middlewares rather than reimplementing them, so the session
 *    path cannot drift.
 *
 *  - `?accessId=` present → the session path is NOT consulted, not even as a
 *    fallback. A bad token with a valid session is a 403, because "additive" would
 *    let a host probe a token by observing what it changed, and would make the
 *    window unenforceable.
 *
 * `roles` is optional and that is load-bearing, not tidiness: `GET /apartments/{id}`
 * mounts `authGuard` alone today, so composing a role check onto it would narrow a
 * live surface — a `guest` who can read an apartment now would start getting 403.
 * Omitting `roles` reproduces that route exactly.
 *
 * The token is validated BEFORE the target is resolved (D9). That ordering is what
 * makes a 403 safe here: the response is a statement about the caller's own
 * credential, and a bad token never causes a single read of the reservation,
 * apartment or inspection it named.
 *
 * On success the guard sets `user` to the grant apartment's OWNER, so the handler
 * downstream keeps asserting ownership with the code it already has — the token
 * genuinely emulates the host rather than bypassing the checks.
 */
export const specialAccessGuard = (opts: {
  scope: AccessScope;
  bind: AccessBind;
  roles?: UserRole[];
}) =>
  createMiddleware<App>(async (c, next) => {
    const token = c.req.query("accessId");

    if (!token) {
      // Today's path, unchanged: the same middlewares, in the same order.
      await authGuard(c, async () => {
        if (!opts.roles) {
          await next();
          return;
        }

        await rolesGuard(opts.roles)(c, next);
      });
      return;
    }

    const db = c.get("db");
    const grant = await specialAccessService.resolveByToken(db, token);

    if (!grant) {
      throw specialAccessErrors.invalid({});
    }

    if (grant.scope !== opts.scope) {
      throw specialAccessErrors.scopeMismatch({ scope: grant.scope });
    }

    if (!(await targetMatches(c, grant, opts.bind, db))) {
      throw specialAccessErrors.scopeMismatch({ bind: opts.bind.kind });
    }

    // The apartment owner, whose identity the token borrows. Loaded rather than
    // synthesized so `c.get("user")` stays a real `User` row: the handlers that
    // follow assert `apartment.owner === user.id`, and handing them a fabricated
    // shape would make that comparison a coincidence instead of a check.
    const owner = await specialAccessService.resolveApartmentOwner(db, grant.apartmentId);

    if (!owner) {
      // The apartment was deleted out from under the grant, or its owner row is
      // gone. The link cannot act as anyone, so it is exactly as dead as an
      // expired one — same code, no new failure mode.
      throw specialAccessErrors.invalid({});
    }

    c.set("user", owner);

    await next();
  });

/**
 * Does the request's own target match the grant?
 *
 * This is the check that narrows a grant from "this apartment" to "this
 * reservation" — without it the token would open every reservation in the
 * apartment, because the handlers assert apartment ownership (which would pass)
 * and not reservation identity.
 *
 * Path params are always available here. `incidentParam` is the exception that
 * costs one indexed read of `incidents`, paid only on the token path, to turn the
 * param into a reservation id. The body is NOT yet validated —
 * `createRoute`'s validators run after `middleware` — so a body-bound target is
 * read from a clone of the raw request. If the body is unparseable the check is
 * skipped rather than failed: the validator that runs next will reject it with a
 * proper 400, and reporting a scope mismatch for malformed JSON would send the
 * caller to fix the wrong thing.
 */
async function targetMatches(
  c: { req: { param: (name: string) => string | undefined; raw: Request } },
  grant: { reservationId: string | null; apartmentId: string },
  bind: AccessBind,
  db: Variables["db"],
): Promise<boolean> {
  if (bind.kind === "reservationParam") {
    return c.req.param(bind.param) === grant.reservationId;
  }

  if (bind.kind === "apartmentParam") {
    return c.req.param(bind.param) === grant.apartmentId;
  }

  if (bind.kind === "incidentParam") {
    const incidentId = c.req.param(bind.param);

    if (!incidentId) return false;

    const reservationId = await specialAccessService.resolveIncidentReservation(
      db,
      incidentId,
    );

    return reservationId !== null && reservationId === grant.reservationId;
  }

  let body: Record<string, unknown>;

  try {
    body = (await c.req.raw.clone().json()) as Record<string, unknown>;
  } catch {
    return true;
  }

  return body?.[bind.field] === grant.reservationId;
}
