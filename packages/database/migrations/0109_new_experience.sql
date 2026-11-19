ALTER TABLE "commons" ADD COLUMN "new_experience" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "commons" SET "new_experience" = true WHERE "activation_draft_id" IS NOT NULL;
