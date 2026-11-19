CREATE TABLE "event_digest_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"resume_after" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_digest_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_digest_preferences" ADD CONSTRAINT "event_digest_preferences_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_digest_preferences" ADD CONSTRAINT "event_digest_preferences_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_digest_preferences_person_event_unique" ON "event_digest_preferences" USING btree ("person_id","commons_id");