ALTER TABLE "commons" ADD COLUMN "welcome_message" text;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "welcome_author_person_id" uuid;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "letter_sections" jsonb;--> statement-breakpoint
ALTER TABLE "commons" ADD CONSTRAINT "commons_welcome_author_person_id_people_id_fk" FOREIGN KEY ("welcome_author_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;