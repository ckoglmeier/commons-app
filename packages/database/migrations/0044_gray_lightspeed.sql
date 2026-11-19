ALTER TABLE "commons" ADD COLUMN "location_names" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
UPDATE "commons" SET "location_names" = jsonb_build_array("location_name") WHERE "location_name" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "balances_disabled" boolean DEFAULT false NOT NULL;
