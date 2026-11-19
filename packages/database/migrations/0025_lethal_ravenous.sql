ALTER TABLE "expenses" ADD COLUMN "itinerary_item_id" uuid;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "expected_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_itinerary_item_id_itinerary_items_id_fk" FOREIGN KEY ("itinerary_item_id") REFERENCES "public"."itinerary_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_itinerary_item_idx" ON "expenses" USING btree ("itinerary_item_id");