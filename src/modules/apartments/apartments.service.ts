import { eq, and, count, inArray, notInArray } from "drizzle-orm";

import {
  apartments,
  apartmentImages,
  type Apartment,
  type NewApartment,
} from "@/db";
import { Variables, Bindings } from "@/types";
import { BadRequestException } from "@/core/errors/error.exceptions";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const MAX_PHOTOS_PER_APARTMENT = 20;

export const apartmentsService = {
  async getAll(db: Variables["db"]): Promise<Apartment[]> {
    return db.select().from(apartments);
  },

  async getById(db: Variables["db"], id: string): Promise<Apartment | null> {
    const [apartment] = await db
      .select()
      .from(apartments)
      .where(eq(apartments.id, id));

    return apartment ?? null;
  },

  async create(
    db: Variables["db"],
    apartment: NewApartment,
  ): Promise<Apartment> {
    const [createdApartment] = await db
      .insert(apartments)
      .values(apartment)
      .returning();

    return createdApartment;
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
    uploadedKeys: string[]
  ): Promise<{ success: boolean; activeCount: number }> {
    
    if (uploadedKeys.length > MAX_PHOTOS_PER_APARTMENT) {
      throw new BadRequestException(
        `Sync rejected. Total confirmed photos (${uploadedKeys.length}) exceeds the maximum allowed limit of ${MAX_PHOTOS_PER_APARTMENT}.`,
        "MAX_PHOTOS_EXCEEDED"
      );
    }

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
            eq(apartmentImages.status, "active"),
            notInArray(apartmentImages.storageKey, uploadedKeys)
          )
        );
      const existingRecords = await tx
        .select({ storageKey: apartmentImages.storageKey })
        .from(apartmentImages)
        .where(
          and(
            eq(apartmentImages.apartmentId, apartmentId),
            inArray(apartmentImages.storageKey, uploadedKeys)
          )
        );

      const existingKeys = existingRecords.map((r: any) => r.storageKey);
      
      const uniqueNewKeys = uploadedKeys.filter((key) => !existingKeys.includes(key));

      if (uniqueNewKeys.length > 0) {
        const valuesToInsert = uniqueNewKeys.map((key) => ({
          apartmentId,
          storageKey: key,
          status: "active" as const,
        }));

        await tx.insert(apartmentImages).values(valuesToInsert);
      }

      return {
        success: true,
        activeCount: uploadedKeys.length,
      };
    });
  },
};
