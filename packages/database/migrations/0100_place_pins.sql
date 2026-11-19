ALTER TABLE "itinerary_items" ADD COLUMN "pin_latitude" double precision;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "pin_longitude" double precision;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "pin_precision" text;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD COLUMN "pin_source" text;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "pin_latitude" double precision;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "pin_longitude" double precision;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "pin_precision" text;--> statement-breakpoint
ALTER TABLE "stays" ADD COLUMN "pin_source" text;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_pin_complete" CHECK (("itinerary_items"."pin_latitude" IS NULL AND "itinerary_items"."pin_longitude" IS NULL AND "itinerary_items"."pin_precision" IS NULL AND "itinerary_items"."pin_source" IS NULL)
    OR ("itinerary_items"."pin_latitude" BETWEEN -90 AND 90 AND "itinerary_items"."pin_longitude" BETWEEN -180 AND 180
      AND "itinerary_items"."pin_precision" IN ('exact', 'approximate') AND "itinerary_items"."pin_source" IN ('map_link', 'page', 'placed')));--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_pin_complete" CHECK (("stays"."pin_latitude" IS NULL AND "stays"."pin_longitude" IS NULL AND "stays"."pin_precision" IS NULL AND "stays"."pin_source" IS NULL)
    OR ("stays"."pin_latitude" BETWEEN -90 AND 90 AND "stays"."pin_longitude" BETWEEN -180 AND 180
      AND "stays"."pin_precision" IN ('exact', 'approximate') AND "stays"."pin_source" IN ('map_link', 'page', 'placed')));