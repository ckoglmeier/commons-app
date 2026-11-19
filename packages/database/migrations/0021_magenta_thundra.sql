CREATE TABLE "travel_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"companion_person_id" uuid,
	"kind" text NOT NULL,
	"date" date NOT NULL,
	"route" text NOT NULL,
	"time" text NOT NULL,
	"note" text,
	"source_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_companion_person_id_people_id_fk" FOREIGN KEY ("companion_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travel_plans_commons_person_kind_unique" ON "travel_plans" USING btree ("commons_id","person_id","kind");--> statement-breakpoint
CREATE INDEX "travel_plans_commons_date_idx" ON "travel_plans" USING btree ("commons_id","date");--> statement-breakpoint
ALTER TABLE public.travel_plans ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY travel_plans_select_members
ON public.travel_plans FOR SELECT TO authenticated
USING (public.is_commons_member(commons_id));
