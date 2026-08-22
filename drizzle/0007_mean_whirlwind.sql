CREATE TYPE "public"."photo_type" AS ENUM('checkin_state', 'damage');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('UPCOMING', 'CHECK_IN_DUE', 'ACTIVE', 'CHECK_OUT_DUE', 'CLOSED', 'DISPUTED');--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"apartment_id" uuid NOT NULL,
	"platform_reservation_id" varchar(255),
	"guest_name" varchar(255) NOT NULL,
	"guest_email" varchar(255),
	"check_in_datetime" timestamp with time zone NOT NULL,
	"check_out_datetime" timestamp with time zone NOT NULL,
	"status" "reservation_status" DEFAULT 'UPCOMING' NOT NULL,
	"proof_window_hours" integer DEFAULT 4 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apartment_images" ALTER COLUMN "uploaded_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apartment_images" ALTER COLUMN "uploaded_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "apartment_images" ALTER COLUMN "deleted_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apartment_images" ADD COLUMN "shot_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "apartment_images" ADD COLUMN "reservation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "apartment_images" ADD COLUMN "type" "photo_type" DEFAULT 'checkin_state' NOT NULL;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_apartment_id_apartments_id_fk" FOREIGN KEY ("apartment_id") REFERENCES "public"."apartments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reservations_apartment" ON "reservations" USING btree ("apartment_id");--> statement-breakpoint
CREATE INDEX "idx_reservations_status" ON "reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_reservations_dates" ON "reservations" USING btree ("apartment_id","check_in_datetime","check_out_datetime");--> statement-breakpoint
ALTER TABLE "apartment_images" ADD CONSTRAINT "apartment_images_shot_id_apartment_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."apartment_shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apartment_images" ADD CONSTRAINT "apartment_images_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_images_apartment" ON "apartment_images" USING btree ("apartment_id");--> statement-breakpoint
CREATE INDEX "idx_images_reservation_shot" ON "apartment_images" USING btree ("reservation_id","shot_id");