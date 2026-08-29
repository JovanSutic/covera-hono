import { eq, and, count, inArray, notInArray } from "drizzle-orm";

import {
  apartments,
  locations,
  apartmentImages,
  type Apartment,
  type NewApartment,
} from "@/db";
import { Variables, Bindings } from "@/types";
import {
  BadRequestException,
  NotFoundException,
} from "@/core/errors/error.exceptions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConfirmUploadBody } from "./apartments.schema";

export const MAX_PHOTOS_PER_APARTMENT = 20;

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
      throw new NotFoundException("Failed to retrieve created apartment");
    }

    return result;
  },

  async generateUploadTokens(
    db: Variables["db"],
    s3: Variables["s3"],
    bucketName: Bindings["R2_BUCKET_NAME"],
    apartmentId: string,
    fileTypes: string[],
  ): Promise<{ uploadUrl: string; key: string }[]> {
    const [existingCount] = await db
      .select({ val: count() })
      .from(apartmentImages)
      .where(
        and(
          eq(apartmentImages.apartmentId, apartmentId),
          eq(apartmentImages.status, "active"),
        ),
      );

    const activeCount = existingCount?.val || 0;

    if (activeCount + fileTypes.length > MAX_PHOTOS_PER_APARTMENT) {
      throw new BadRequestException(
        `Upload limit exceeded. Maximum allowed: ${MAX_PHOTOS_PER_APARTMENT}. Currently active: ${activeCount}.`,
        "MAX_PHOTOS_EXCEEDED",
      );
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

  async syncUploadedPhotos(
    db: Variables["db"],
    apartmentId: string,
    payload: ConfirmUploadBody,
  ): Promise<{ success: boolean; activeCount: number }> {
    const { reservationId, type, photos } = payload;

    if (photos.length > MAX_PHOTOS_PER_APARTMENT) {
      throw new BadRequestException(
        `Sync rejected. Total confirmed photos (${photos.length}) exceeds maximum limit of ${MAX_PHOTOS_PER_APARTMENT}.`,
        "MAX_PHOTOS_EXCEEDED",
      );
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
