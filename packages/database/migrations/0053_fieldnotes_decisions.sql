CREATE TABLE "poll_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"approved_by_person_id" uuid NOT NULL,
	"approved_by_name" text NOT NULL,
	"evidence_fingerprint" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"approval" jsonb NOT NULL,
	"summary" text NOT NULL,
	"target" text NOT NULL,
	"plan_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poll_decisions" ADD CONSTRAINT "poll_decisions_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_decisions" ADD CONSTRAINT "poll_decisions_approved_by_person_id_people_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_decisions" ADD CONSTRAINT "poll_decisions_plan_id_itinerary_items_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."itinerary_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_decisions_poll_unique" ON "poll_decisions" USING btree ("poll_id");
--> statement-breakpoint
ALTER TABLE public.poll_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.poll_decisions FROM anon, authenticated;
