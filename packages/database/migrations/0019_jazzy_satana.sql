CREATE TABLE "event_creation_access" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"requester_email" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_person_id" uuid,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_person_id" uuid NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_creation_access" ADD CONSTRAINT "event_creation_access_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_creation_access" ADD CONSTRAINT "event_creation_access_decided_by_person_id_people_id_fk" FOREIGN KEY ("decided_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_audit_events" ADD CONSTRAINT "operator_audit_events_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_creation_access_status_requested_idx" ON "event_creation_access" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "operator_audit_events_occurred_idx" ON "operator_audit_events" USING btree ("occurred_at");
--> statement-breakpoint
ALTER TABLE public.event_creation_access ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.operator_audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.event_creation_access
ADD CONSTRAINT event_creation_access_status_check CHECK (status IN ('requested', 'approved', 'revoked'));
--> statement-breakpoint
CREATE POLICY event_creation_access_select_owner
ON public.event_creation_access FOR SELECT TO authenticated
USING (person_id = public.current_person_id());
