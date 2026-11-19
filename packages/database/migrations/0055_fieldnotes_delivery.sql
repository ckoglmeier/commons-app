CREATE TABLE "poll_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"person_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_deliveries_status_check" CHECK ("poll_deliveries"."status" in ('queued', 'processing', 'sent', 'failed', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "poll_deliveries" ADD CONSTRAINT "poll_deliveries_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_deliveries" ADD CONSTRAINT "poll_deliveries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_deliveries_poll_email_unique" ON "poll_deliveries" USING btree ("poll_id","recipient_email");--> statement-breakpoint
CREATE INDEX "poll_deliveries_ready_idx" ON "poll_deliveries" USING btree ("status","available_at");
--> statement-breakpoint
ALTER TABLE "poll_deliveries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "poll_deliveries" FROM anon, authenticated;
