import { and, eq, isNull } from "drizzle-orm";
import {
  specialAccess,
  apartments,
  incidents,
  incidentItems,
  reservations,
  users,
  SpecialAccess,
  NewSpecialAccess,
  AccessScope,
  type User,
} from "@/db";
import { Variables } from "@/types";
import { makeToken } from "../incidents/incidents.service";
import type { CreateSpecialAccess } from "./special_access.schema";

export const HOUR_MS = 60 * 60 * 1000;

/** What a subject resolves to: the apartment, plus the subject column to store. */
export interface ResolvedSubject {
  apartmentId: string;
  reservationId: string | null;
  incidentItemId: string | null;
}

export const specialAccessService = {
  /**
   * Resolves a subject to the apartment ownership is asserted against (D12).
   *
   * One query per subject shape, each ONE join deep from the subject to its
   * apartment: a reservation carries its apartment directly, a claim item reaches
   * it through its claim. Storing the apartment on the grant is what lets the two
   * apartment-scoped routes need no join on redemption.
   *
   * Returns `null` when the subject does not exist, which the route reports in the
   * vocabulary of the module that owns the subject.
   */
  async resolveSubjectApartment(
    db: Variables["db"],
    subject: { reservationId: string } | { incidentItemId: string },
  ): Promise<ResolvedSubject | null> {
    if ("reservationId" in subject) {
      const [row] = await db
        .select({
          apartmentId: reservations.apartmentId,
          reservationId: reservations.id,
        })
        .from(reservations)
        .where(eq(reservations.id, subject.reservationId))
        .limit(1);

      if (!row) return null;

      return {
        apartmentId: row.apartmentId,
        reservationId: row.reservationId,
        incidentItemId: null,
      };
    }

    const [row] = await db
      .select({
        apartmentId: reservations.apartmentId,
        reservationId: reservations.id,
        incidentItemId: incidentItems.id,
      })
      .from(incidentItems)
      .innerJoin(incidents, eq(incidentItems.incidentId, incidents.id))
      .innerJoin(reservations, eq(incidents.reservationId, reservations.id))
      .where(eq(incidentItems.id, subject.incidentItemId))
      .limit(1);

    if (!row) return null;

    return {
      apartmentId: row.apartmentId,
      reservationId: row.reservationId,
      incidentItemId: row.incidentItemId,
    };
  },

  /**
   * The owner of an apartment, as a full `User` row.
   *
   * The guard sets `c.get("user")` to this so the handlers downstream keep
   * asserting ownership with the code they already have: a token that resolved to
   * a fabricated identity would make `apartment.owner === user.id` a coincidence
   * rather than a check. `null` when either row is gone, which the guard treats as
   * a dead link.
   */
  async resolveApartmentOwner(
    db: Variables["db"],
    apartmentId: string,
  ): Promise<User | null> {
    const [row] = await db
      .select({ owner: users })
      .from(apartments)
      .innerJoin(users, eq(apartments.owner, users.id))
      .where(eq(apartments.id, apartmentId))
      .limit(1);

    return (row?.owner as User | undefined) ?? null;
  },

  /**
   * Mints a grant and returns the row INCLUDING `accessId` (D14). The token is
   * generated here rather than in the route, so this and the resolver are the only
   * two places that ever handle it.
   */
  async create(
    db: Variables["db"],
    input: CreateSpecialAccess,
    subject: ResolvedSubject,
    createdBy: string | null,
  ): Promise<SpecialAccess> {
    const row: NewSpecialAccess = {
      accessId: makeToken(),
      scope: input.scope,
      apartmentId: subject.apartmentId,
      reservationId: subject.reservationId,
      incidentItemId: subject.incidentItemId,
      expiresAt: new Date(Date.now() + input.expiresInHours * HOUR_MS),
      createdBy,
    };

    const [created] = await db.insert(specialAccess).values(row).returning();

    return created!;
  },

  /**
   * Resolves a token to its LIVE grant, or `null` for every way it can fail.
   *
   * One indexed lookup on the UNIQUE `access_id` (D9) — unknown, expired and
   * revoked all collapse to `null`, so a caller cannot tell them apart, and this
   * is the entire per-request cost the feature adds. Revocation is filtered in SQL
   * so a revoked row is never read; expiry is checked here because the comparison
   * is trivial and keeps the predicate portable.
   */
  async resolveByToken(
    db: Variables["db"],
    token: string,
  ): Promise<SpecialAccess | null> {
    const [row] = await db
      .select()
      .from(specialAccess)
      .where(
        and(eq(specialAccess.accessId, token), isNull(specialAccess.revokedAt)),
      )
      .limit(1);

    if (!row) return null;

    if (new Date(row.expiresAt).getTime() <= Date.now()) return null;

    return row as SpecialAccess;
  },

  /**
   * Finds a grant by token for MANAGEMENT purposes: unlike `resolveByToken` this
   * does NOT filter on revocation or expiry. The caller is a host looking up a
   * grant they own in order to revoke it, and a grant that is already revoked must
   * still be findable or revoking could not be idempotent (D15).
   */
  async findByToken(
    db: Variables["db"],
    token: string,
  ): Promise<SpecialAccess | null> {
    const [row] = await db
      .select()
      .from(specialAccess)
      .where(eq(specialAccess.accessId, token))
      .limit(1);

    return (row as SpecialAccess | undefined) ?? null;
  },

  /**
   * Revokes one grant by row id, idempotently (D15): `"revoked"` when this call
   * did it, `"already"` when it was already revoked.
   *
   * The conditional `where` keeps a retry from overwriting the original revocation
   * timestamp, so the record keeps the moment access actually ended.
   */
  async revokeById(
    db: Variables["db"],
    id: string,
  ): Promise<"revoked" | "already"> {
    const [updated] = await db
      .update(specialAccess)
      .set({ revokedAt: new Date() })
      .where(and(eq(specialAccess.id, id), isNull(specialAccess.revokedAt)))
      .returning({ id: specialAccess.id });

    return updated ? "revoked" : "already";
  },

  /**
   * Marks a single-use grant as spent. The `damage_evidence` scope only (D7);
   * `inspection_proof` grants are multi-use for their window, so nothing calls
   * this for them.
   */
  async markUsed(db: Variables["db"], id: string): Promise<void> {
    await db
      .update(specialAccess)
      .set({ usedAt: new Date() })
      .where(eq(specialAccess.id, id));
  },
};

export type { AccessScope };
