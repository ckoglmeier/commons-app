CREATE TABLE "coordinator_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"source_poll_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"prepared_by" text NOT NULL,
	"evidence_fingerprint" text NOT NULL,
	"recommendation" text NOT NULL,
	"freshness" text NOT NULL,
	"uncertainties" jsonb NOT NULL,
	"open_questions" jsonb NOT NULL,
	"next_action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordinator_recommendations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coordinator_recommendations" ADD CONSTRAINT "coordinator_recommendations_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_recommendations" ADD CONSTRAINT "coordinator_recommendations_source_poll_id_polls_id_fk" FOREIGN KEY ("source_poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_recommendations" ADD CONSTRAINT "coordinator_recommendations_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_recommendations_owner_poll_unique" ON "coordinator_recommendations" USING btree ("commons_id","owner_person_id","source_poll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_recommendations_command_unique" ON "coordinator_recommendations" USING btree ("commons_id","command_id");
--> statement-breakpoint
REVOKE ALL ON TABLE "coordinator_recommendations" FROM PUBLIC, anon, authenticated;
