ALTER TABLE "stays" ADD COLUMN "cost_source" text;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "includes_taxes_and_fees" boolean;--> statement-breakpoint
UPDATE "stays" SET "cost_source" = 'expense' WHERE "total_cents" IS NOT NULL AND "legacy_expense_id" IS NOT NULL;--> statement-breakpoint
UPDATE "stays" SET "cost_source" = 'estimate' WHERE "total_cents" IS NOT NULL AND "cost_source" IS NULL;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_cost_source_valid" CHECK ("cost_source" IS NULL OR "cost_source" IN ('estimate', 'confirmation', 'expense'));--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_cost_details_valid" CHECK (("total_cents" IS NULL AND "cost_source" IS NULL AND "includes_taxes_and_fees" IS NULL) OR ("total_cents" IS NOT NULL AND "cost_source" IS NOT NULL));
