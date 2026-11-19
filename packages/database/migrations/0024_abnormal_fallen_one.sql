ALTER TYPE "public"."itinerary_status" ADD VALUE 'idea' BEFORE 'planned';--> statement-breakpoint
ALTER TABLE "itinerary_items" ALTER COLUMN "starts_at" DROP NOT NULL;