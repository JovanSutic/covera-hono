ALTER TABLE "apartment_images" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "apartment_images" ADD COLUMN "deleted_at" timestamp;