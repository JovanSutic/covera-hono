ALTER TABLE "reservations" ADD COLUMN "alternative_check_in_datetime" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "alternative_check_out_datetime" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reservations" ADD COLUMN "has_photo_proof" boolean DEFAULT false NOT NULL;