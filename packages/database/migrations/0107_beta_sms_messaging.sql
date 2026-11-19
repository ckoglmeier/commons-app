CREATE TABLE "messaging_booking_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_digest" text NOT NULL,
	"source_text" text,
	"source_url" text,
	"confirmation_intake_id" uuid,
	"storage_path" text,
	"mime_type" text,
	"received_message_id" uuid,
	"draft" jsonb,
	"classification" text,
	"matched_plan_id" uuid,
	"uncertainty" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_token_hash" text,
	"review_expires_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_via" text,
	"saved_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_booking_intakes_status" CHECK ("messaging_booking_intakes"."status" in ('received','extracting','needs_info','awaiting_review','saved','declined','failed','superseded')),
	CONSTRAINT "messaging_booking_intakes_source" CHECK ("messaging_booking_intakes"."source" in ('text','link','mms','upload')),
	CONSTRAINT "messaging_booking_intakes_bounds" CHECK ("messaging_booking_intakes"."version" > 0 and ("messaging_booking_intakes"."source_text" is null or length("messaging_booking_intakes"."source_text") <= 60000))
);
--> statement-breakpoint
ALTER TABLE "messaging_booking_intakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"phone_hash" text NOT NULL,
	"scope" text NOT NULL,
	"status" text NOT NULL,
	"wording" text NOT NULL,
	"method" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_consents_status" CHECK ("messaging_consents"."status" in ('granted','revoked')),
	CONSTRAINT "messaging_consents_scope" CHECK ("messaging_consents"."scope" in ('conversation','updates'))
);
--> statement-breakpoint
ALTER TABLE "messaging_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direction" text NOT NULL,
	"provider" text NOT NULL,
	"provider_message_id" text,
	"idempotency_key" text,
	"phone_hash" text NOT NULL,
	"person_id" uuid,
	"commons_id" uuid,
	"purpose" text NOT NULL,
	"body" text NOT NULL,
	"media_count" integer DEFAULT 0 NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"status_detail" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"segments" integer DEFAULT 1 NOT NULL,
	"question_id" uuid,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_messages_direction" CHECK ("messaging_messages"."direction" in ('inbound','outbound')),
	CONSTRAINT "messaging_messages_status" CHECK ("messaging_messages"."status" in ('received','processed','ignored','held','queued','sending','sent','delivered','undelivered','failed','suppressed','cancelled')),
	CONSTRAINT "messaging_messages_bounds" CHECK (length("messaging_messages"."body") <= 4000 and "messaging_messages"."attempts" >= 0 and "messaging_messages"."media_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "messaging_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_phones" (
	"phone_hash" text PRIMARY KEY NOT NULL,
	"phone_protected" text NOT NULL,
	"opted_out" boolean DEFAULT false NOT NULL,
	"opted_out_at" timestamp with time zone,
	"reenrolled_at" timestamp with time zone,
	"handoff_sent_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_phones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text,
	"version" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"held_message_id" uuid,
	"answer" text,
	"approval_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_questions_status" CHECK ("messaging_questions"."status" in ('open','answered','superseded','expired','resolved_elsewhere','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "messaging_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"kind" text NOT NULL,
	"message_id" uuid,
	"outcome" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_webhook_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging_booking_intakes" ADD CONSTRAINT "messaging_booking_intakes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_booking_intakes" ADD CONSTRAINT "messaging_booking_intakes_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_consents" ADD CONSTRAINT "messaging_consents_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_consents" ADD CONSTRAINT "messaging_consents_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_messages" ADD CONSTRAINT "messaging_messages_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_questions" ADD CONSTRAINT "messaging_questions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_questions" ADD CONSTRAINT "messaging_questions_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_booking_intakes_digest" ON "messaging_booking_intakes" USING btree ("person_id","commons_id","source_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_booking_intakes_review_token" ON "messaging_booking_intakes" USING btree ("review_token_hash") WHERE "messaging_booking_intakes"."review_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "messaging_booking_intakes_person_idx" ON "messaging_booking_intakes" USING btree ("person_id","commons_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_consents_person_trip_scope" ON "messaging_consents" USING btree ("person_id","commons_id","scope");--> statement-breakpoint
CREATE INDEX "messaging_consents_phone_idx" ON "messaging_consents" USING btree ("phone_hash","status");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_messages_provider_id" ON "messaging_messages" USING btree ("provider","direction","provider_message_id") WHERE "messaging_messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_messages_idempotency" ON "messaging_messages" USING btree ("idempotency_key") WHERE "messaging_messages"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "messaging_messages_ready_idx" ON "messaging_messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "messaging_messages_person_idx" ON "messaging_messages" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "messaging_questions_person_idx" ON "messaging_questions" USING btree ("person_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_questions_one_open" ON "messaging_questions" USING btree ("person_id","commons_id","kind","ref_id") WHERE "messaging_questions"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_webhook_events_key" ON "messaging_webhook_events" USING btree ("provider","event_key");