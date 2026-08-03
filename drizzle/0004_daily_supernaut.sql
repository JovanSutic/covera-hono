CREATE TYPE "public"."currency" AS ENUM('EUR', 'USD', 'GBP', 'RSD', 'CHF', 'CAD', 'AUD');--> statement-breakpoint
CREATE TYPE "public"."photo_proof_requirement" AS ENUM('SWEEP_ONLY', 'CLOSEUP', 'FUNCTIONAL_ACTION');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"apartment_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(100) NOT NULL,
	"room_location" varchar(100) NOT NULL,
	"description" text,
	"photo_proof_requirement" "photo_proof_requirement" DEFAULT 'SWEEP_ONLY' NOT NULL,
	"approximate_value_cents" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apartments" ADD COLUMN "currency" "currency" DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_apartment_id_apartments_id_fk" FOREIGN KEY ("apartment_id") REFERENCES "public"."apartments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_active_apartment_room" ON "assets" USING btree ("apartment_id","room_location","is_active");