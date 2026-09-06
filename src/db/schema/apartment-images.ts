import { pgTable, uuid, text, timestamp, index, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { apartments } from "./apartments";
import { apartmentShots } from "./apartment-shots";
import { reservations } from "./reservations";
import { apartmentShotAssets } from "./apartment-shot-assets";

export const photoTypeEnum = pgEnum("photo_type", ["checkin_state", "damage"]);

export const apartmentImages = pgTable(
  "apartment_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    apartmentId: uuid("apartment_id")
      .notNull()
      .references(() => apartments.id, { onDelete: "cascade" }),

    shotId: uuid("shot_id")
      .notNull()
      .references(() => apartmentShots.id, { onDelete: "cascade" }),

    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),

    type: photoTypeEnum("type")
      .default("checkin_state")
      .notNull(),

    storageKey: text("storage_key").notNull().unique(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    status: text("status", { enum: ["active", "soft_deleted"] })
      .default("active")
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_images_apartment").on(table.apartmentId),
    index("idx_images_reservation_shot").on(table.reservationId, table.shotId),
  ]
);

export const apartmentImagesRelations = relations(
  apartmentImages,
  ({ one }) => ({
    apartment: one(apartments, {
      fields: [apartmentImages.apartmentId],
      references: [apartments.id],
    }),
    shot: one(apartmentShots, {
      fields: [apartmentImages.shotId],
      references: [apartmentShots.id],
    }),
    reservation: one(reservations, {
      fields: [apartmentImages.reservationId],
      references: [reservations.id],
    }),
  })
);

export const apartmentShotsRelations = relations(
  apartmentShots,
  ({ one, many }) => ({
    apartment: one(apartments, {
      fields: [apartmentShots.apartmentId],
      references: [apartments.id],
    }),
    images: many(apartmentImages),
    shotAssets: many(apartmentShotAssets),
  })
);

export const SelectApartmentImageSchema = createSelectSchema(apartmentImages);
export const InsertApartmentImageSchema = createInsertSchema(apartmentImages);