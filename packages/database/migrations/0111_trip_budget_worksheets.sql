CREATE TABLE "trip_budget_worksheets" (
	"commons_id" uuid PRIMARY KEY NOT NULL,
	"inputs" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_person_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_budget_worksheets" ADD CONSTRAINT "trip_budget_worksheets_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_budget_worksheets" ADD CONSTRAINT "trip_budget_worksheets_updated_by_person_id_people_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "trip_budget_worksheets" ENABLE ROW LEVEL SECURITY;
