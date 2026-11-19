ALTER TABLE "itinerary_items" ADD COLUMN "meal_type" text;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_meal_type" CHECK ("itinerary_items"."meal_type" IS NULL OR "itinerary_items"."meal_type" IN ('restaurant', 'home'));
