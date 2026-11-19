ALTER TABLE "traveler_profiles" ADD COLUMN "usual_origin_supplied_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD COLUMN "dietary_preferences" text;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD COLUMN "dietary_preferences_supplied_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD COLUMN "accessibility_needs" text;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD COLUMN "accessibility_needs_supplied_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD COLUMN "lodging_preferences" text;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD COLUMN "lodging_preferences_supplied_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD COLUMN "transportation_preferences" text;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD COLUMN "transportation_preferences_supplied_by_person_id" uuid;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_usual_origin_supplied_by_person_id_people_id_fk" FOREIGN KEY ("usual_origin_supplied_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_dietary_preferences_supplied_by_person_id_people_id_fk" FOREIGN KEY ("dietary_preferences_supplied_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_accessibility_needs_supplied_by_person_id_people_id_fk" FOREIGN KEY ("accessibility_needs_supplied_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_lodging_preferences_supplied_by_person_id_people_id_fk" FOREIGN KEY ("lodging_preferences_supplied_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_transportation_preferences_supplied_by_person_id_people_id_fk" FOREIGN KEY ("transportation_preferences_supplied_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;