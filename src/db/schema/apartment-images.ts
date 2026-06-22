import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { apartments } from "./apartments";

export const apartmentImages = pgTable("apartment_images", {
  id: uuid("id").defaultRandom().primaryKey(),
  apartmentId: uuid("apartment_id")
    .references(() => apartments.id, { onDelete: "cascade" })
    .notNull(),
  storageKey: text("storage_key").notNull().unique(),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  status: text("status", { enum: ["active", "soft_deleted"] }).default("active").notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const apartmentsRelations = relations(apartments, ({ many }) => ({
  images: many(apartmentImages),
}));

export const apartmentImagesRelations = relations(apartmentImages, ({ one }) => ({
  apartment: one(apartments, {
    fields: [apartmentImages.apartmentId],
    references: [apartments.id],
  }),
}));
