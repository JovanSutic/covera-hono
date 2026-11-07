ALTER TABLE "claim_evidence" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD COLUMN "deleted_at" timestamp with time zone;