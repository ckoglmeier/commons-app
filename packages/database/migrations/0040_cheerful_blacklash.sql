ALTER TABLE "travel_plans" ALTER COLUMN "visibility" SET DEFAULT 'private';--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "total_cents" integer;--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
UPDATE "travel_plans" SET "visibility" = 'basic' WHERE "visibility" = 'group';--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_visibility_check" CHECK ("travel_plans"."visibility" in ('private', 'basic', 'all'));--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_total_positive" CHECK ("travel_plans"."total_cents" is null or "travel_plans"."total_cents" > 0);--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_currency_check" CHECK ("travel_plans"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
DROP POLICY IF EXISTS travel_plans_select_members ON public.travel_plans;--> statement-breakpoint
CREATE POLICY travel_plans_select_members
ON public.travel_plans FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.people
    WHERE people.auth_user_id = auth.uid()
      AND people.id IN (travel_plans.person_id, travel_plans.companion_person_id)
  )
);
