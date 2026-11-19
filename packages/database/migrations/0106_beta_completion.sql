CREATE TABLE "attribution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event" text NOT NULL,
	"entry_kind" text DEFAULT 'unknown' NOT NULL,
	"entry_ref" text,
	"subject_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attribution_events_event" CHECK ("attribution_events"."event" in ('draft_started','approved','paid_activation','traveler_participation','traveler_to_organizer')),
	CONSTRAINT "attribution_events_entry" CHECK ("attribution_events"."entry_kind" in ('direct','template','destination','assistant','partner','recap','unknown')),
	CONSTRAINT "attribution_events_ref" CHECK ("attribution_events"."entry_ref" is null or "attribution_events"."entry_ref" ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
	CONSTRAINT "attribution_events_subject" CHECK (length("attribution_events"."subject_key") between 8 and 80)
);
--> statement-breakpoint
ALTER TABLE "attribution_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "operator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_person_id" uuid NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_actions_kind" CHECK ("operator_actions"."subject_kind" in ('partner_inquiry','notification','invitation','digest','intake','feedback','usage_control')),
	CONSTRAINT "operator_actions_action" CHECK ("operator_actions"."action" in ('reviewed','resolved','reopened','retry_requested','control_changed')),
	CONSTRAINT "operator_actions_bounds" CHECK (length("operator_actions"."subject_id") between 1 and 80 and ("operator_actions"."note" is null or length("operator_actions"."note") <= 300))
);
--> statement-breakpoint
ALTER TABLE "operator_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "partner_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"organization" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"website" text,
	"region" text,
	"message" text NOT NULL,
	"source_path" text DEFAULT '/' NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"client_hash" text NOT NULL,
	"delivery_status" text DEFAULT 'queued' NOT NULL,
	"delivery_attempts" integer DEFAULT 0 NOT NULL,
	"delivery_error_code" text,
	"delivery_last_attempt_at" timestamp with time zone,
	"routed_to" text,
	"provider_message_id" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partner_inquiries_kind" CHECK ("partner_inquiries"."kind" in ('dmo','travel_assistant')),
	CONSTRAINT "partner_inquiries_delivery" CHECK ("partner_inquiries"."delivery_status" in ('queued','sending','sent','failed','not_routed')),
	CONSTRAINT "partner_inquiries_bounds" CHECK (length("partner_inquiries"."organization") between 1 and 160 and length("partner_inquiries"."contact_name") between 1 and 120 and length("partner_inquiries"."contact_email") between 3 and 254 and length("partner_inquiries"."message") between 10 and 2000 and "partner_inquiries"."delivery_attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "partner_inquiries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"reported_by_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"note" text,
	"status" text DEFAULT 'reported' NOT NULL,
	"reimbursement_id" uuid,
	"command_id" uuid NOT NULL,
	"resolved_by_person_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reports_status" CHECK ("payment_reports"."status" in ('reported','recorded','dismissed')),
	CONSTRAINT "payment_reports_bounds" CHECK ("payment_reports"."amount_cents" > 0 and "payment_reports"."amount_cents" <= 100000000 and length("payment_reports"."currency") = 3 and ("payment_reports"."note" is null or length("payment_reports"."note") <= 200) and "payment_reports"."reported_by_person_id" <> "payment_reports"."to_person_id"),
	CONSTRAINT "payment_reports_resolution" CHECK (("payment_reports"."status" = 'reported') = ("payment_reports"."resolved_at" is null))
);
--> statement-breakpoint
ALTER TABLE "payment_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_recaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"approved_moment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_by_person_id" uuid,
	"approved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_recaps_status" CHECK ("trip_recaps"."status" in ('draft','shared')),
	CONSTRAINT "trip_recaps_bounds" CHECK (length("trip_recaps"."summary") <= 1200 and "trip_recaps"."version" > 0 and jsonb_typeof("trip_recaps"."approved_moment_ids") = 'array' and jsonb_array_length("trip_recaps"."approved_moment_ids") <= 24),
	CONSTRAINT "trip_recaps_shared" CHECK (("trip_recaps"."status" = 'shared') = ("trip_recaps"."approved_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "trip_recaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_usage_controls" (
	"commons_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"limit_units" integer,
	"disabled" boolean DEFAULT false NOT NULL,
	"updated_by_person_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_usage_controls_commons_id_kind_pk" PRIMARY KEY("commons_id","kind"),
	CONSTRAINT "trip_usage_controls_kind" CHECK ("trip_usage_controls"."kind" in ('sms_segment','extraction_call','model_call','map_lookup','payment_fee')),
	CONSTRAINT "trip_usage_controls_limit" CHECK ("trip_usage_controls"."limit_units" is null or "trip_usage_controls"."limit_units" between 0 and 100000)
);
--> statement-breakpoint
ALTER TABLE "trip_usage_controls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"units" integer NOT NULL,
	"cost_micros" integer,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_usage_kind" CHECK ("trip_usage_events"."kind" in ('sms_segment','extraction_call','model_call','map_lookup','payment_fee')),
	CONSTRAINT "trip_usage_bounds" CHECK ("trip_usage_events"."units" between 1 and 10000 and ("trip_usage_events"."cost_micros" is null or "trip_usage_events"."cost_micros" >= 0))
);
--> statement-breakpoint
ALTER TABLE "trip_usage_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_operator_person_id_people_id_fk" FOREIGN KEY ("operator_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_reported_by_person_id_people_id_fk" FOREIGN KEY ("reported_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_to_person_id_people_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_reimbursement_id_reimbursements_id_fk" FOREIGN KEY ("reimbursement_id") REFERENCES "public"."reimbursements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reports" ADD CONSTRAINT "payment_reports_resolved_by_person_id_people_id_fk" FOREIGN KEY ("resolved_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_recaps" ADD CONSTRAINT "trip_recaps_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_recaps" ADD CONSTRAINT "trip_recaps_approved_by_person_id_people_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_usage_controls" ADD CONSTRAINT "trip_usage_controls_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_usage_controls" ADD CONSTRAINT "trip_usage_controls_updated_by_person_id_people_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_usage_events" ADD CONSTRAINT "trip_usage_events_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribution_events_subject_unique" ON "attribution_events" USING btree ("event","subject_key");--> statement-breakpoint
CREATE INDEX "attribution_events_created_idx" ON "attribution_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "operator_actions_subject_idx" ON "operator_actions" USING btree ("subject_kind","subject_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_inquiries_idempotency_unique" ON "partner_inquiries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "partner_inquiries_created_idx" ON "partner_inquiries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "partner_inquiries_rate_idx" ON "partner_inquiries" USING btree ("client_hash","created_at");--> statement-breakpoint
CREATE INDEX "partner_inquiries_fingerprint_idx" ON "partner_inquiries" USING btree ("fingerprint","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_reports_command_unique" ON "payment_reports" USING btree ("commons_id","reported_by_person_id","command_id");--> statement-breakpoint
CREATE INDEX "payment_reports_commons_status_idx" ON "payment_reports" USING btree ("commons_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_recaps_commons_unique" ON "trip_recaps" USING btree ("commons_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_usage_dedupe_unique" ON "trip_usage_events" USING btree ("commons_id","kind","dedupe_key") WHERE "trip_usage_events"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "trip_usage_trip_kind_idx" ON "trip_usage_events" USING btree ("commons_id","kind","created_at");