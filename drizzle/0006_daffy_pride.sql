CREATE TABLE "apartment_shot_assets" (
	"shot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "apartment_shot_assets_shot_id_asset_id_pk" PRIMARY KEY("shot_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "apartment_shots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"apartment_id" uuid NOT NULL,
	"room_location" "room_location" NOT NULL,
	"shot_type" "photo_proof_requirement" NOT NULL,
	"title" varchar(255) NOT NULL,
	"instructions" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apartment_shot_assets" ADD CONSTRAINT "apartment_shot_assets_shot_id_apartment_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."apartment_shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apartment_shot_assets" ADD CONSTRAINT "apartment_shot_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apartment_shots" ADD CONSTRAINT "apartment_shots_apartment_id_apartments_id_fk" FOREIGN KEY ("apartment_id") REFERENCES "public"."apartments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shot_assets_asset" ON "apartment_shot_assets" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "idx_shots_apartment_room" ON "apartment_shots" USING btree ("apartment_id","room_location");