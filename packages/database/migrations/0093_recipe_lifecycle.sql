CREATE TABLE "recipe_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"poll_id" uuid NOT NULL,
	"decision_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"result" jsonb NOT NULL,
	"base" jsonb NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"approved_by_person_id" uuid NOT NULL,
	"approved_by_name" text NOT NULL,
	"applied_by_person_id" uuid,
	"applied_at" timestamp with time zone,
	"applied_targets" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_outcomes_kind" CHECK ("recipe_outcomes"."kind" in ('dates_location')),
	CONSTRAINT "recipe_outcomes_status" CHECK ("recipe_outcomes"."status" in ('approved','applied','superseded')),
	CONSTRAINT "recipe_outcomes_applied_consistent" CHECK (("recipe_outcomes"."status" = 'applied') = ("recipe_outcomes"."applied_at" is not null and "recipe_outcomes"."applied_targets" is not null and "recipe_outcomes"."applied_by_person_id" is not null) or "recipe_outcomes"."status" = 'superseded')
);
--> statement-breakpoint
ALTER TABLE "recipe_outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recipe_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"commons_id" uuid NOT NULL,
	"recipe" text NOT NULL,
	"workflow" jsonb NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_runs_recipe" CHECK ("recipe_runs"."recipe" in ('dates_location','attendance','lodging','transport','itinerary','custom_poll')),
	CONSTRAINT "recipe_runs_status" CHECK ("recipe_runs"."status" in ('active','archived'))
);
--> statement-breakpoint
ALTER TABLE "recipe_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "poll_drafts" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "recipe_outcomes" ADD CONSTRAINT "recipe_outcomes_run_id_recipe_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recipe_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_outcomes" ADD CONSTRAINT "recipe_outcomes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_outcomes" ADD CONSTRAINT "recipe_outcomes_decision_id_poll_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."poll_decisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_outcomes" ADD CONSTRAINT "recipe_outcomes_approved_by_person_id_people_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_outcomes" ADD CONSTRAINT "recipe_outcomes_applied_by_person_id_people_id_fk" FOREIGN KEY ("applied_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_runs" ADD CONSTRAINT "recipe_runs_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_runs" ADD CONSTRAINT "recipe_runs_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_outcomes_poll_unique" ON "recipe_outcomes" USING btree ("poll_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_outcomes_decision_unique" ON "recipe_outcomes" USING btree ("decision_id");--> statement-breakpoint
CREATE INDEX "recipe_outcomes_run_idx" ON "recipe_outcomes" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recipe_runs_commons_command" ON "recipe_runs" USING btree ("commons_id","command_id");--> statement-breakpoint
CREATE INDEX "recipe_runs_commons_recipe_idx" ON "recipe_runs" USING btree ("commons_id","recipe","created_at");--> statement-breakpoint
ALTER TABLE "poll_drafts" ADD CONSTRAINT "poll_drafts_run_id_recipe_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recipe_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_drafts_run_idx" ON "poll_drafts" USING btree ("run_id");--> statement-breakpoint
-- Server-only records: participants reach them through authorized application commands, never directly.
REVOKE ALL ON "recipe_runs" FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON "recipe_outcomes" FROM anon, authenticated;
