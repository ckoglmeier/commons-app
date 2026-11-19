ALTER TABLE "commons" ADD COLUMN "setup_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "first_shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "recipient_email" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "delivery_state" text DEFAULT 'not_sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "delivery_error_code" text;--> statement-breakpoint
UPDATE "commons"
SET
  "setup_completed_at" = COALESCE("setup_completed_at", "created_at"),
  "first_shared_at" = COALESCE("first_shared_at", "created_at");
