ALTER TABLE "moments" ADD COLUMN "itinerary_item_id" uuid;--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "event_match_source" text;--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "event_match_confidence" integer;--> statement-breakpoint
ALTER TABLE "moments" ADD COLUMN "event_match_reason" text;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_itinerary_item_id_itinerary_items_id_fk" FOREIGN KEY ("itinerary_item_id") REFERENCES "public"."itinerary_items"("id") ON DELETE set null ON UPDATE no action;