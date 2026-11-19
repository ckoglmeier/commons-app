ALTER TABLE "commons" ADD COLUMN "expenses_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "expenses_closed_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "expenses_complete_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commons" ADD CONSTRAINT "commons_expenses_closed_by_person_id_people_id_fk" FOREIGN KEY ("expenses_closed_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;