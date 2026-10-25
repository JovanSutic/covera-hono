import { and, eq, inArray, ne, sql } from "drizzle-orm";
import {
  AppError,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from "@/core/errors/error.exceptions";
import type { ErrorCode } from "@/core/errors/error.codes";
import { inspections, reservations, users, locations, apartments, inspectionFlags, assets, apartmentShotAssets, apartmentShots, assetTypes } from "@/db";

/**
 * Maps a registry resource key to its table and its NOT_FOUND code.
 * Adding a resource here is what makes `checkExistence(db, "<key>", id)` type-check.
 */
const resourceRegistry = {
  users:        { table: users,        code: "USER_NOT_FOUND",        label: "User" },
  locations:    { table: locations,    code: "LOCATION_NOT_FOUND",    label: "Location" },
  apartments:   { table: apartments,   code: "APARTMENT_NOT_FOUND",   label: "Apartment" },
  reservations: { table: reservations, code: "RESERVATION_NOT_FOUND", label: "Reservation" },
  inspections:  { table: inspections,  code: "INSPECTION_NOT_FOUND",  label: "Inspection" },
  assets:       { table: assets,       code: "ASSET_NOT_FOUND",       label: "Asset" },
  assetTypes:   { table: assetTypes,   code: "ASSET_TYPE_NOT_FOUND",  label: "Asset type" },
} as const satisfies Record<string, { table: unknown; code: ErrorCode; label: string }>;

type ResourceType = keyof typeof resourceRegistry;

interface OwnershipContext {
  userId: string;
  role?: string;
  allowAdmin?: boolean;
}

/**
 * Asserts that a row exists.
 * Order: existence only.
 */
export async function checkExistence(
  db: any,
  resource: ResourceType,
  id: string,
): Promise<void> {
  const entry = resourceRegistry[resource];

  // Unreachable via the type system; a real assertion failure, not a client error.
  if (!entry) {
    throw new AppError(500, {
      code: "INTERNAL_SERVER_ERROR",
      message: "Something went wrong on our end.",
      meta: { origin: "DEVELOPER", reason: `Unregistered resource '${resource}'` },
    });
  }

  const [row] = await db
    .select({ id: (entry.table as any).id })
    .from(entry.table)
    .where(eq((entry.table as any).id, id))
    .limit(1);

  if (!row) {
    throw new NotFoundException({
      code: entry.code,
      message: `${entry.label} does not exist.`,
      meta: { origin: "DOMAIN", resource, id },
    });
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
    throw new NotFoundException({
      code: "APARTMENT_NOT_FOUND",
      message: "Apartment does not exist.",
      meta: { origin: "DOMAIN", apartmentId },
    });
  }

  if (apartment.owner !== userId) {
    throw new ForbiddenException({
      code: "FORBIDDEN_APARTMENT_ACCESS",
      message: "You do not have access to this apartment.",
      meta: { origin: "DOMAIN", apartmentId },
    });
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

/**
 * Asserts the requested range does not overlap an existing reservation.
 * Order: range validity → overlap. The first violation wins.
 */
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
    throw new BadRequestException({
      code: "RESERVATION_INVALID_RANGE",
      message: "Check-out must be strictly after check-in.",
      details: [
        {
          field: "body.checkOutDatetime",
          message: "Check-out must be strictly after check-in.",
        },
      ],
      meta: { origin: "DOMAIN" },
    });
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
    throw new ConflictException({
      code: "RESERVATION_OVERLAP",
      message:
        "This apartment already has a reservation overlapping the requested dates. " +
        "Choose dates outside that range or cancel the existing reservation.",
      meta: { origin: "DOMAIN", apartmentId, conflictingReservationId: overlapping.id },
    });
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

interface FlagCreationParams {
  inspectionId: string;
  shotId: string;
  maxHoursWindow?: number; // Defaults to 12 hours if not specified
}

export async function assertCanCreateFlag(
  db: any,
  params: FlagCreationParams,
): Promise<void> {
  const { inspectionId, shotId, maxHoursWindow = 12 } = params;

  const [record] = await db
    .select({
      inspectionId: inspections.id,
      checkInDatetime: reservations.checkInDatetime,
      alternativeCheckInDatetime: reservations.alternativeCheckInDatetime,
      existingFlagId: inspectionFlags.id,
    })
    .from(inspections)
    .innerJoin(reservations, eq(inspections.reservationId, reservations.id))
    .leftJoin(
      inspectionFlags,
      and(
        eq(inspectionFlags.inspectionId, inspections.id),
        eq(inspectionFlags.shotId, shotId),
      ),
    )
    .where(eq(inspections.id, inspectionId))
    .limit(1);

  if (!record) {
    throw new NotFoundException(`Inspection with ID ${inspectionId}`);
  }

  if (record.existingFlagId) {
    throw new ConflictException(
      `A flag has already been submitted for shot ${shotId} under inspection ${inspectionId}.`,
    );
  }

  const effectiveCheckIn =
    record.alternativeCheckInDatetime &&
    isRealDate(record.alternativeCheckInDatetime)
      ? new Date(record.alternativeCheckInDatetime)
      : new Date(record.checkInDatetime);

  const windowMs = maxHoursWindow * 60 * 60 * 1000;
  const deadline = new Date(effectiveCheckIn.getTime() + windowMs);
  const now = new Date();

  if (now > deadline) {
    throw new BadRequestException(
      `Cannot submit flag: time window expired. Flags can only be created up to ${maxHoursWindow} hours after check-in (${effectiveCheckIn.toISOString()}).`,
    );
  }
}

/**
 * Asserts that an Asset can be updated or deleted.
 * Blocks modifications if the asset is linked to a shot under a reservation
 * that is COVERED or DISPUTED and has an active or future check-in window.
 */
export async function assertCanModifyAsset(
  db: any,
  assetId: string,
  action: "update" | "delete" = "delete",
): Promise<void> {
  const [lockedRecord] = await db
    .select({
      assetId: assets.id,
      reservationId: reservations.id,
      status: reservations.status,
    })
    .from(assets)
    .innerJoin(
      apartmentShotAssets,
      eq(apartmentShotAssets.assetId, assets.id),
    )
    .innerJoin(
      apartmentShots,
      eq(apartmentShots.id, apartmentShotAssets.shotId),
    )
    .innerJoin(
      reservations,
      eq(reservations.apartmentId, assets.apartmentId),
    )
    .where(
      and(
        eq(assets.id, assetId),
        inArray(reservations.status, ["COVERED", "DISPUTED"]),
        // Ensures check-in hasn't expired / reservation cycle is current or future
        sql`COALESCE(
          CASE WHEN ${reservations.alternativeCheckInDatetime} > '1970-01-02'::timestamptz 
               THEN ${reservations.alternativeCheckInDatetime} 
               ELSE NULL END,
          ${reservations.checkInDatetime}
        ) >= NOW()`
      ),
    )
    .limit(1);

  if (lockedRecord) {
    throw new ConflictException(
      `Cannot ${action} asset '${assetId}': it is linked to a shot with locked photo proof for an upcoming or active reservation (Reservation Status: ${lockedRecord.status}).`,
    );
  }
}

/**
 * Asserts that shots belonging to an apartment can be bulk-synced, modified, or removed.
 * Blocks operations if the apartment has any upcoming/active reservations in 'COVERED' or 'DISPUTED' status.
 */
export async function assertCanModifyApartmentShots(
  db: any,
  apartmentId: string,
): Promise<void> {
  const [lockedRecord] = await db
    .select({
      apartmentId: reservations.apartmentId,
      status: reservations.status,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.apartmentId, apartmentId),
        inArray(reservations.status, ["COVERED", "DISPUTED"]),
        // Ensures check-in is in the future or currently active
        sql`COALESCE(
          CASE WHEN ${reservations.alternativeCheckInDatetime} > '1970-01-02'::timestamptz 
               THEN ${reservations.alternativeCheckInDatetime} 
               ELSE NULL END,
          ${reservations.checkInDatetime}
        ) >= NOW()`
      ),
    )
    .limit(1);

  if (lockedRecord) {
    throw new ConflictException(
      `Cannot sync or modify shots for apartment '${apartmentId}': there is an upcoming reservation with locked photo proof (Reservation Status: ${lockedRecord.status}).`,
    );
  }
}
