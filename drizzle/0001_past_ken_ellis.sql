CREATE TYPE "public"."user_status" AS ENUM('created', 'invited', 'confirmed', 'disabled');--> statement-breakpoint
ALTER TABLE "users" RENAME COLUMN "roles" TO "role";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "first_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "user_status" DEFAULT 'created' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_auth_id_unique" UNIQUE("auth_id");