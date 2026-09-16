CREATE TYPE "public"."flag_reason" AS ENUM('missing_asset', 'damaged', 'poor_photo', 'wrong_room', 'other');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('pending', 'under_review', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "inspection_flag_assets" (
	"flag_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "inspection_flag_assets_flag_id_asset_id_pk" PRIMARY KEY("flag_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "inspection_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"shot_id" uuid,
	"reason" "flag_reason" NOT NULL,
	"details" text NOT NULL,
	"reported_by_user_id" uuid,
	"status" "flag_status" DEFAULT 'pending' NOT NULL,
	"resolution_notes" text,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inspection_flag_assets" ADD CONSTRAINT "inspection_flag_assets_flag_id_inspection_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."inspection_flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_flag_assets" ADD CONSTRAINT "inspection_flag_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_flags" ADD CONSTRAINT "inspection_flags_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_flags" ADD CONSTRAINT "inspection_flags_shot_id_apartment_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."apartment_shots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_flags" ADD CONSTRAINT "inspection_flags_reported_by_user_id_users_id_fk" FOREIGN KEY ("reported_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_flags" ADD CONSTRAINT "inspection_flags_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;