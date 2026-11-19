ALTER TABLE "commons" ADD COLUMN "target_budget_cents" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "balance_mode" text DEFAULT 'allocated' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "confirmation_code" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "access_mode" text DEFAULT 'account' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "managed_by_person_ids" jsonb;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "can_claim_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "visibility" text DEFAULT 'group' NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "confirmation_code" text;