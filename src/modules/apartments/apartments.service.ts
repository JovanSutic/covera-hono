import { eq, and, inArray, notInArray } from "drizzle-orm";

import {
  apartments,
  locations,
  apartmentImages,
  type Apartment,
  type NewApartment,
} from "@/db";
import { Variables, Bindings } from "@/types";
import {
  AppError,
  BadRequestException,
} from "@/core/errors/error.exceptions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConfirmUploadBody } from "./apartments.schema";

/**
 * The photo cap, and it is PER RESERVATION — not per apartment, despite what this
 * module's name suggests.
 *
 * `apartment_images` is keyed by `reservationId`; a row's apartment is only the
 * apartment the reservation happened in. An apartment accumulates one active set per
 * reservation it has ever had, so its active count grows without bound while any
 * single reservation's stays at or under this number.
 */
export const MAX_PHOTOS_PER_RESERVATION = 20;

export const apartmentsService = {
  async getAll(db: Variables["db"]) {
    const rows = await db
      .select({
        apartment: apartments,
        location: locations,
      })
      .from(apartments)
      .innerJoin(locations, eq(apartments.location, locations.id));

    return rows.map(({ apartment, location }) => ({
      ...apartment,
      location,
    }));
  },

  async getById(db: Variables["db"], id: string) {
    const [row] = await db
      .select({
        apartment: apartments,
        location: locations,
      })
      .from(apartments)
      .innerJoin(locations, eq(apartments.location, locations.id))
      .where(eq(apartments.id, id));

    if (!row) return null;

    return {
      ...row.apartment,
      location: row.location,
    };
  },

  async create(db: Variables["db"], apartment: NewApartment) {
    const [createdApartment] = await db
      .insert(apartments)
      .values(apartment)
      .returning();

    const result = await this.getById(db, createdApartment.id);

    if (!result) {
      throw new AppError(500, {
        code: "INTERNAL_SERVER_ERROR",
        message: "Something went wrong on our end. Please try again.",
        meta: { origin: "DEVELOPER", reason: "Apartment vanished between insert and read", id: createdApartment.id },
      });
    }

    return result;
  },

  async generateUploadTokens(
    s3: Variables["s3"],
    bucketName: Bindings["R2_BUCKET_NAME"],
    apartmentId: string,
    fileTypes: string[],
  ): Promise<{ uploadUrl: string; key: string }[]> {
    // The cap here is on ONE BATCH of token requests, not on the apartment.
    //
    // It used to count every active photo on the apartment and refuse past 20, which
    // made this route permanently unreachable for any apartment with 20+ photos —
    // including photos belonging to reservations that closed long ago. That count is
    // the wrong quantity twice over: it is apartment-scoped where the limit is
    // reservation-scoped, and this route is not given a `reservationId`, so it has no
    // way to compute the right one. Minting a presigned URL writes nothing, so the
    // batch size is all that needs bounding here; the per-reservation limit is
    // enforced by `syncUploadedPhotos`, which is keyed by reservation and is the
    // call that actually INSERTs.
    if (fileTypes.length > MAX_PHOTOS_PER_RESERVATION) {
      throw new BadRequestException({
        code: "MAX_PHOTOS_EXCEEDED",
        message:
          `You can request at most ${MAX_PHOTOS_PER_RESERVATION} upload tokens at once, ` +
          `but ${fileTypes.length} were requested.`,
        meta: {
          origin: "DOMAIN",
          limit: MAX_PHOTOS_PER_RESERVATION,
          requested: fileTypes.length,
        },
      });
    }

    return Promise.all(
      fileTypes.map(async (fileType) => {
        const ext = fileType.split("/")[1] || "jpg";
        const uniqueId = crypto.randomUUID();
        const key = `apartments/${apartmentId}/${uniqueId}.${ext}`;

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          ContentType: fileType,
        });

        const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

        return { uploadUrl, key };
      }),
    );
  },

  /**
   * Records the confirmed uploads for ONE reservation. Every write below is scoped by
   * `reservationId`, so the 20-photo bound is a reservation's, which is exactly the
   * quantity this call has: the batch replaces this reservation's photos for the shots
   * it targets. Photos already stored for this reservation's OTHER shots are not in
   * `photos` and are not touched, so this compares a batch against the limit rather
   * than a running total — the apartment's total across all its reservations is
   * deliberately unbounded.
   */
  async syncUploadedPhotos(
    db: Variables["db"],
    apartmentId: string,
    payload: ConfirmUploadBody,
  ): Promise<{ success: boolean; activeCount: number }> {
    const { reservationId, type, photos } = payload;

    if (photos.length > MAX_PHOTOS_PER_RESERVATION) {
      throw new BadRequestException({
        code: "MAX_PHOTOS_EXCEEDED",
        message:
          `You are confirming ${photos.length} photos but the limit is ${MAX_PHOTOS_PER_RESERVATION} per reservation. ` +
          "Remove some photos and try again.",
        meta: {
          origin: "DOMAIN",
          limit: MAX_PHOTOS_PER_RESERVATION,
          submitted: photos.length,
          reservationId,
        },
      });
    }

    const targetShotIds = Array.from(new Set(photos.map((p) => p.shotId)));
    const incomingKeys = photos.map((p) => p.uploadedKey);

    return await db.transaction(async (tx: any) => {
      await tx
        .update(apartmentImages)
        .set({
          status: "soft_deleted",
          deletedAt: new Date(),
        })
        .where(
          and(
            eq(apartmentImages.apartmentId, apartmentId),
            eq(apartmentImages.reservationId, reservationId),
            inArray(apartmentImages.shotId, targetShotIds),
            eq(apartmentImages.status, "active"),
            notInArray(apartmentImages.storageKey, incomingKeys),
          ),
        );

      const valuesToInsert = photos.map((photo) => ({
        apartmentId,
        shotId: photo.shotId,
        reservationId,
        type,
        storageKey: photo.uploadedKey,
        status: "active" as const,
        deletedAt: null,
      }));

      await tx
        .insert(apartmentImages)
        .values(valuesToInsert)
        .onConflictDoUpdate({
          target: apartmentImages.storageKey,
          set: {
            status: "active",
            deletedAt: null,
            type,
          },
        });

      return {
        success: true,
        activeCount: photos.length,
      };
    });
  },

  async getByOwnerId(db: Variables["db"], ownerId: string) {
    const rows = await db
      .select({
        apartment: apartments,
        location: locations,
      })
      .from(apartments)
      .innerJoin(locations, eq(apartments.location, locations.id))
      .where(eq(apartments.owner, ownerId));

    return rows.map(({ apartment, location }) => ({
      ...apartment,
      location,
    }));
  },
};
