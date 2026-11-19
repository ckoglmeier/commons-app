CREATE TABLE "trip_activation_payments" (
	"draft_id" uuid PRIMARY KEY NOT NULL,
	"organizer_id" uuid NOT NULL,
	"attempt_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text,
	"checkout_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_code" text,
	"paid_event_id" text,
	"payment_intent_id" text,
	"amount_cents" integer DEFAULT 2000 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"tax_amount_cents" integer,
	"livemode" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"fee_recorded_at" timestamp with time zone,
	"fee_expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_activation_amount" CHECK ("trip_activation_payments"."amount_cents" = 2000 AND "trip_activation_payments"."currency" = 'USD'),
	CONSTRAINT "trip_activation_status" CHECK ("trip_activation_payments"."status" IN ('pending', 'processing', 'paid')),
	CONSTRAINT "trip_activation_test_mode" CHECK ("trip_activation_payments"."livemode" = false),
	CONSTRAINT "trip_activation_tax_range" CHECK ("trip_activation_payments"."tax_amount_cents" BETWEEN 0 AND "trip_activation_payments"."amount_cents")
);
--> statement-breakpoint
ALTER TABLE "trip_activation_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_activation_refunds" (
	"refund_id" text PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"event_id" text NOT NULL,
	"provider_event_at" timestamp with time zone NOT NULL,
	"after_activation" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_activation_refund_amount" CHECK ("trip_activation_refunds"."amount_cents" > 0 AND "trip_activation_refunds"."amount_cents" <= 2000),
	CONSTRAINT "trip_activation_refund_status" CHECK ("trip_activation_refunds"."status" IN ('pending', 'succeeded', 'failed', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "trip_activation_refunds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "activation_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "event_creation_access" ADD COLUMN "grants_pilot_capabilities" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "event_creation_access" ADD COLUMN "resume_draft_id" uuid;--> statement-breakpoint
ALTER TABLE "event_creation_access" ADD COLUMN "approval_notice_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_creation_access" ADD COLUMN "approval_notice_lease_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_creation_access" ADD COLUMN "approval_notice_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_creation_drafts" ADD COLUMN "beta_activation_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "event_creation_drafts" ADD COLUMN "entry_context" jsonb;--> statement-breakpoint
ALTER TABLE "trip_activation_payments" ADD CONSTRAINT "trip_activation_payments_draft_id_event_creation_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."event_creation_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_activation_payments" ADD CONSTRAINT "trip_activation_payments_organizer_id_people_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_activation_refunds" ADD CONSTRAINT "trip_activation_refunds_draft_id_trip_activation_payments_draft_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."trip_activation_payments"("draft_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_activation_refunds" ADD CONSTRAINT "trip_activation_refunds_resolved_by_person_id_people_id_fk" FOREIGN KEY ("resolved_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_activation_session_unique" ON "trip_activation_payments" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_activation_paid_event_unique" ON "trip_activation_payments" USING btree ("paid_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_activation_intent_unique" ON "trip_activation_payments" USING btree ("payment_intent_id");--> statement-breakpoint
CREATE INDEX "trip_activation_refunds_draft_idx" ON "trip_activation_refunds" USING btree ("draft_id");--> statement-breakpoint
ALTER TABLE "commons" ADD CONSTRAINT "commons_activation_draft_id_event_creation_drafts_id_fk" FOREIGN KEY ("activation_draft_id") REFERENCES "public"."event_creation_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_creation_access" ADD CONSTRAINT "event_creation_access_resume_draft_id_event_creation_drafts_id_fk" FOREIGN KEY ("resume_draft_id") REFERENCES "public"."event_creation_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
REVOKE ALL ON TABLE "trip_activation_payments" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE "trip_activation_refunds" FROM PUBLIC, anon, authenticated;
