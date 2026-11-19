ALTER TABLE "stays" ADD COLUMN "room_price_cents" integer;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "room_count" integer;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_room_price_positive" CHECK ("stays"."room_price_cents" IS NULL OR "stays"."room_price_cents" > 0);--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_room_count_range" CHECK ("stays"."room_count" IS NULL OR "stays"."room_count" BETWEEN 1 AND 50);--> statement-breakpoint
ALTER TABLE "stays" DROP CONSTRAINT "stays_cost_details_valid";--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_cost_details_valid" CHECK (("total_cents" IS NULL AND "cost_source" IS NULL AND ("includes_taxes_and_fees" IS NULL OR "room_price_cents" IS NOT NULL)) OR ("total_cents" IS NOT NULL AND "cost_source" IS NOT NULL));
