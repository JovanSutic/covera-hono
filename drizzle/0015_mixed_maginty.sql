CREATE TYPE "public"."access_scope" AS ENUM('inspection_proof', 'damage_evidence');--> statement-breakpoint
CREATE TABLE "special_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_id" varchar(64) NOT NULL,
	"scope" "access_scope" NOT NULL,
	"apartment_id" uuid NOT NULL,
	"reservation_id" uuid,
	"incident_item_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "special_access_access_id_unique" UNIQUE("access_id"),
	CONSTRAINT "special_access_subject_matches_scope" CHECK (("special_access"."scope" = 'inspection_proof' AND "special_access"."reservation_id" IS NOT NULL AND "special_access"."incident_item_id" IS NULL) OR ("special_access"."scope" = 'damage_evidence' AND "special_access"."incident_item_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "special_access" ADD CONSTRAINT "special_access_apartment_id_apartments_id_fk" FOREIGN KEY ("apartment_id") REFERENCES "public"."apartments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_access" ADD CONSTRAINT "special_access_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_access" ADD CONSTRAINT "special_access_incident_item_id_incident_items_id_fk" FOREIGN KEY ("incident_item_id") REFERENCES "public"."incident_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "special_access" ADD CONSTRAINT "special_access_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_special_access_reservation" ON "special_access" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "idx_special_access_incident_item" ON "special_access" USING btree ("incident_item_id");