CREATE TYPE "public"."evidence_file_type" AS ENUM('damage_photo_wide', 'damage_photo_closeup', 'theft_empty_space_photo', 'original_purchase_receipt', 'replacement_retail_quote', 'handyman_invoice', 'police_report');--> statement-breakpoint
CREATE TYPE "public"."asset_incident_type" AS ENUM('damage', 'theft');--> statement-breakpoint
CREATE TYPE "public"."incident_item_status" AS ENUM('link_generated', 'photos_collected', 'documents_pending', 'complete');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('draft', 'ready_to_file', 'submitted_to_guest', 'escalated_to_aircover', 'resolved', 'unfeasible');--> statement-breakpoint
CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_item_id" uuid NOT NULL,
	"evidence_type" "evidence_file_type" NOT NULL,
	"storage_key" text NOT NULL,
	"exif_captured_at" timestamp with time zone,
	"exif_latitude" numeric(9, 6),
	"exif_longitude" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_evidence_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "incident_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"type" "asset_incident_type" NOT NULL,
	"status" "incident_item_status" DEFAULT 'link_generated' NOT NULL,
	"cleaner_token" varchar(64) NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"estimated_placeholder_value_cents" integer DEFAULT 0 NOT NULL,
	"description_by_cleaner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_items_cleaner_token_unique" UNIQUE("cleaner_token"),
	CONSTRAINT "incident_items_incident_asset_unique" UNIQUE("incident_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" "incident_status" DEFAULT 'draft' NOT NULL,
	"is_emergency_mode" boolean DEFAULT false NOT NULL,
	"placeholder_total_amount_cents" integer DEFAULT 0 NOT NULL,
	"final_payout_requested_cents" integer DEFAULT 0 NOT NULL,
	"resolution_center_submitted_at" timestamp with time zone,
	"guest_response_deadline_at" timestamp with time zone,
	"aircover_escalation_deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_reservation_id_unique" UNIQUE("reservation_id")
);
--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_incident_item_id_incident_items_id_fk" FOREIGN KEY ("incident_item_id") REFERENCES "public"."incident_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_items" ADD CONSTRAINT "incident_items_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_items" ADD CONSTRAINT "incident_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_claim_evidence_item" ON "claim_evidence" USING btree ("incident_item_id");--> statement-breakpoint
CREATE INDEX "idx_incident_items_incident" ON "incident_items" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "idx_incident_items_asset" ON "incident_items" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "idx_incidents_status" ON "incidents" USING btree ("status");