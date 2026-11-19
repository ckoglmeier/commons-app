ALTER TABLE "poll_drafts" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "archived_at" timestamp with time zone;