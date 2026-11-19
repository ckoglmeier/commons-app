CREATE TABLE "travel_plan_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"travel_plan_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "travel_plans_commons_person_kind_unique";--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "driver_person_id" uuid;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "vehicle" text;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "return_date" date;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "return_time" text;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "status" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_plan_participants" ADD CONSTRAINT "travel_plan_participants_travel_plan_id_travel_plans_id_fk" FOREIGN KEY ("travel_plan_id") REFERENCES "public"."travel_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_plan_participants" ADD CONSTRAINT "travel_plan_participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travel_plan_participants_plan_person_unique" ON "travel_plan_participants" USING btree ("travel_plan_id","person_id");--> statement-breakpoint
CREATE INDEX "travel_plan_participants_person_idx" ON "travel_plan_participants" USING btree ("person_id");--> statement-breakpoint
INSERT INTO "travel_plan_participants" ("travel_plan_id", "person_id")
SELECT "id", "person_id" FROM "travel_plans"
ON CONFLICT ("travel_plan_id", "person_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "travel_plan_participants" ("travel_plan_id", "person_id")
SELECT "id", "companion_person_id" FROM "travel_plans" WHERE "companion_person_id" IS NOT NULL
ON CONFLICT ("travel_plan_id", "person_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_driver_person_id_people_id_fk" FOREIGN KEY ("driver_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travel_plans_commons_person_kind_unique" ON "travel_plans" USING btree ("commons_id","person_id","kind") WHERE "travel_plans"."kind" <> 'car_rental';--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_status_check" CHECK ("travel_plans"."status" in ('considering', 'booked', 'confirmed'));--> statement-breakpoint
ALTER TABLE public.travel_plan_participants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.can_read_private_travel_plan(target_travel_plan_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.travel_plans plan
    LEFT JOIN public.travel_plan_participants participant ON participant.travel_plan_id = plan.id
    LEFT JOIN public.people owner ON owner.id = plan.person_id
    LEFT JOIN public.people traveler ON traveler.id = participant.person_id
    WHERE plan.id = target_travel_plan_id
      AND (owner.auth_user_id = (SELECT auth.uid()) OR traveler.auth_user_id = (SELECT auth.uid()))
  );
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.can_read_private_travel_plan(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.can_read_private_travel_plan(uuid) TO authenticated;--> statement-breakpoint
DROP POLICY travel_plans_select_members ON public.travel_plans;--> statement-breakpoint
CREATE POLICY travel_plans_select_members
ON public.travel_plans FOR SELECT TO authenticated
USING (public.can_read_private_travel_plan(id));--> statement-breakpoint
CREATE POLICY "travel_plan_participants_select_visible"
ON public.travel_plan_participants FOR SELECT TO authenticated
USING (public.can_read_private_travel_plan(travel_plan_id));
