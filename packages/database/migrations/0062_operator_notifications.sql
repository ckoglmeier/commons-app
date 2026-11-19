CREATE TABLE "operator_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"first_attempt_at" timestamp with time zone,
	"provider_message_id" text,
	"error_code" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_notifications_status_check" CHECK ("operator_notification_deliveries"."status" in ('queued', 'processing', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "operator_notifications_dedupe_idx" ON "operator_notification_deliveries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "operator_notifications_ready_idx" ON "operator_notification_deliveries" USING btree ("status","available_at");
--> statement-breakpoint
ALTER TABLE public.operator_notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.operator_notification_deliveries FROM anon, authenticated;
