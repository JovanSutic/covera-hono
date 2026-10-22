CREATE TYPE "public"."asset_age_bracket" AS ENUM('UNDER_1_YEAR', 'ONE_TO_THREE_YEARS', 'THREE_TO_FIVE_YEARS', 'OVER_FIVE_YEARS');--> statement-breakpoint
CREATE TYPE "public"."asset_value_tier" AS ENUM('BUDGET', 'STANDARD', 'PREMIUM', 'LUXURY');--> statement-breakpoint
CREATE TABLE "asset_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"category" "asset_category" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "asset_type_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "age_bracket" "asset_age_bracket";--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "value_tier" "asset_value_tier";--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_asset_type_id_asset_types_id_fk" FOREIGN KEY ("asset_type_id") REFERENCES "public"."asset_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_asset_type" ON "assets" USING btree ("asset_type_id");