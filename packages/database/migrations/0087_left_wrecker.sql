ALTER TABLE "commons" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "target_budget_currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "expected_cost_currency" text DEFAULT 'USD' NOT NULL;