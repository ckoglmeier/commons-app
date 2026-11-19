CREATE TABLE "coordinator_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordinator_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "coordinator_settings" jsonb DEFAULT '{"version":0,"personality":{"id":"commons","specificationVersion":1}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "event_creation_drafts" ADD COLUMN "coordinator" jsonb DEFAULT '{"personality":{"id":"commons","specificationVersion":1},"startingPoint":null,"turns":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "coordinator_preferences" ADD CONSTRAINT "coordinator_preferences_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_preferences" ADD CONSTRAINT "coordinator_preferences_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_preferences_person_trip_unique" ON "coordinator_preferences" USING btree ("commons_id","person_id");