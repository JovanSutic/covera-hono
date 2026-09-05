import { and, eq, ne, sql } from "drizzle-orm";
import { users } from "@/db/schema/users";
import { locations } from "@/db/schema/locations";
import { apartments } from "@/db/schema/apartments";
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from "@/core/errors/error.exceptions";
import { inspections, reservations } from "@/db";

const schemaRegistry = {
  users: users,
  locations: locations,
  apartments: apartments,
  reservations: reservations,
} as const;

interface OwnershipContext {
  userId: string;
  role?: string;
  allowAdmin?: boolean;
}

type ResourceType = keyof typeof schemaRegistry;

export async function checkExistence(
  db: any,
  resource: ResourceType,
  id: string,
): Promise<void> {
  const table = schemaRegistry[resource];

  if (!table) {
    throw new Error(
      `Developer Error: Resource '${resource}' is not registered in checkExistence schemaRegistry.`,
    );
  }

  const result = await db
    .select({ id: (table as any).id })
    .from(table)
    .where(eq((table as any).id, id))
    .limit(1);

  if (result.length === 0) {
    throw new NotFoundException(`${resource.slice(0, -1)} with ID ${id}`);
  }
}

export async function assertApartmentOwnership(
  db: any,
  apartmentId: string,
  context: OwnershipContext,
): Promise<void> {
  const { userId, role, allowAdmin = true } = context;

  if (allowAdmin && role === "admin") {
    return;
  }

  const [apartment] = await db
    .select({ owner: apartments.owner })
    .from(apartments)
    .where(eq(apartments.id, apartmentId))
    .limit(1);

  if (!apartment) {
    throw new NotFoundException(`Apartment with ID ${apartmentId} not found`);
  }

  if (apartment.owner !== userId) {
    throw new ForbiddenException(
      "You do not have permission to modify or create resources for this apartment",
    );
  }
}

interface OverlapCheckParams {
  apartmentId: string;
  checkInDatetime: Date | string;
  checkOutDatetime: Date | string;
  alternativeCheckInDatetime?: Date | string | null;
  alternativeCheckOutDatetime?: Date | string | null;
  excludeReservationId?: string; // Optional: for update/edit operations
}

const isRealDate = (dateStr?: string | Date | null): boolean => {
  if (!dateStr) return false;
  const time = new Date(dateStr).getTime();
  // Ensures it's a valid date and strictly after the 1970 Unix epoch
  return !isNaN(time) && time > 0;
};

export async function assertNoOverlappingReservation(
  db: any,
  params: OverlapCheckParams,
): Promise<void> {
  const {
    apartmentId,
    checkInDatetime,
    checkOutDatetime,
    alternativeCheckInDatetime,
    alternativeCheckOutDatetime,
    excludeReservationId,
  } = params;

  // 1. Resolve target incoming range
  const newStart = isRealDate(alternativeCheckInDatetime)
    ? new Date(alternativeCheckInDatetime!)
    : new Date(checkInDatetime);

  const newEnd = isRealDate(alternativeCheckOutDatetime)
    ? new Date(alternativeCheckOutDatetime!)
    : new Date(checkOutDatetime);

  if (newStart >= newEnd) {
    throw new ConflictException(
      "Check-out date must be strictly after check-in date.",
    );
  }

  const isoStart = newStart.toISOString();
  const isoEnd = newEnd.toISOString();

  // 2. Direct SQL query comparing active ranges
  const conditions = [
    eq(reservations.apartmentId, apartmentId),
    ne(reservations.status, "CLOSED"),

    // Resolve existing effective start/end inline
    sql`COALESCE(
      CASE WHEN ${reservations.alternativeCheckInDatetime} > '1970-01-02'::timestamptz 
           THEN ${reservations.alternativeCheckInDatetime} 
           ELSE NULL END,
      ${reservations.checkInDatetime}
    ) < ${isoEnd}::timestamptz`,

    sql`COALESCE(
      CASE WHEN ${reservations.alternativeCheckOutDatetime} > '1970-01-02'::timestamptz 
           THEN ${reservations.alternativeCheckOutDatetime} 
           ELSE NULL END,
      ${reservations.checkOutDatetime}
    ) > ${isoStart}::timestamptz`,
  ];

  if (excludeReservationId) {
    conditions.push(ne(reservations.id, excludeReservationId));
  }

  const [overlapping] = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(...conditions))
    .limit(1);

  if (overlapping) {
    throw new ConflictException(
      "The apartment is already booked for the selected date range.",
    );
  }
}

export async function assertCanCreateInspection(
  db: any,
  reservationId: string,
): Promise<void> {
  const [record] = await db
    .select({
      reservationId: reservations.id,
      hasPhotoProof: reservations.hasPhotoProof,
      status: reservations.status,
      checkInDatetime: reservations.checkInDatetime,
      alternativeCheckInDatetime: reservations.alternativeCheckInDatetime,
      existingInspectionId: inspections.id,
    })
    .from(reservations)
    .leftJoin(inspections, eq(inspections.reservationId, reservations.id))
    .where(eq(reservations.id, reservationId))
    .limit(1);

  // 1. Existence check
  if (!record) {
    throw new NotFoundException(`Reservation with ID ${reservationId}`);
  }

  // 2. Prevent duplicate inspection
  if (record.existingInspectionId) {
    throw new ConflictException(
      `An inspection already exists for reservation ${reservationId}.`,
    );
  }

  // 3. Status precondition check
  if (record.status !== "COVERED") {
    throw new BadRequestException(
      `Cannot create inspection: reservation status must be 'COVERED' (current: '${record.status}').`,
    );
  }

  // 4. Photo proof requirement check
  if (!record.hasPhotoProof) {
    throw new BadRequestException(
      "Cannot create inspection: reservation does not have photo proof satisfied.",
    );
  }

  // 5. Time window check (Up to 1 hour past effective check-in time)
  const effectiveCheckIn =
    record.alternativeCheckInDatetime &&
    new Date(record.alternativeCheckInDatetime).getTime() > 0
      ? new Date(record.alternativeCheckInDatetime)
      : new Date(record.checkInDatetime);

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const deadline = new Date(effectiveCheckIn.getTime() + ONE_HOUR_MS);
  const now = new Date();

  if (now > deadline) {
    throw new BadRequestException(
      `Cannot create inspection: window expired. Inspections can only be created up to 1 hour after check-in (${effectiveCheckIn.toISOString()}).`,
    );
  }
}
