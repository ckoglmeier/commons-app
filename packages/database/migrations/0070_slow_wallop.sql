CREATE TABLE "coordinator_research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"query" text NOT NULL,
	"status" text NOT NULL,
	"sources" jsonb NOT NULL,
	"limitations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordinator_research_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_thread_ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"itinerary_item_id" uuid NOT NULL,
	"linked_by_person_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coordinator_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_command_id" uuid NOT NULL,
	"last_command_fingerprint" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_threads_positive_version" CHECK ("coordinator_threads"."version" > 0),
	CONSTRAINT "coordinator_threads_status_check" CHECK ("coordinator_threads"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "coordinator_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "coordinator_turns_owner_sequence_unique";--> statement-breakpoint
DROP INDEX "coordinator_turns_shared_sequence_unique";--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "poll_drafts" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "coordinator_research_runs" ADD CONSTRAINT "coordinator_research_runs_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_research_runs" ADD CONSTRAINT "coordinator_research_runs_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_ideas" ADD CONSTRAINT "coordinator_thread_ideas_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_ideas" ADD CONSTRAINT "coordinator_thread_ideas_itinerary_item_id_itinerary_items_id_fk" FOREIGN KEY ("itinerary_item_id") REFERENCES "public"."itinerary_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_ideas" ADD CONSTRAINT "coordinator_thread_ideas_linked_by_person_id_people_id_fk" FOREIGN KEY ("linked_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_threads" ADD CONSTRAINT "coordinator_threads_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_threads" ADD CONSTRAINT "coordinator_threads_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_research_runs_thread_command_unique" ON "coordinator_research_runs" USING btree ("thread_id","command_id");--> statement-breakpoint
CREATE INDEX "coordinator_research_runs_thread_created_idx" ON "coordinator_research_runs" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_thread_ideas_thread_item_unique" ON "coordinator_thread_ideas" USING btree ("thread_id","itinerary_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_thread_ideas_thread_command_unique" ON "coordinator_thread_ideas" USING btree ("thread_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_threads_commons_command_unique" ON "coordinator_threads" USING btree ("commons_id","last_command_id");--> statement-breakpoint
CREATE INDEX "coordinator_threads_commons_updated_idx" ON "coordinator_threads" USING btree ("commons_id","updated_at");--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD CONSTRAINT "coordinator_turns_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_drafts" ADD CONSTRAINT "poll_drafts_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_turns_thread_sequence_unique" ON "coordinator_turns" USING btree ("thread_id","sequence") WHERE "coordinator_turns"."thread_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_turns_owner_sequence_unique" ON "coordinator_turns" USING btree ("commons_id","owner_person_id","sequence") WHERE not "coordinator_turns"."organizer_shared" and "coordinator_turns"."thread_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_turns_shared_sequence_unique" ON "coordinator_turns" USING btree ("commons_id","sequence") WHERE "coordinator_turns"."organizer_shared" and "coordinator_turns"."thread_id" is null;
--> statement-breakpoint
ALTER TABLE "coordinator_thread_ideas" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "coordinator_threads" FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE "coordinator_research_runs" FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE "coordinator_thread_ideas" FROM PUBLIC, anon, authenticated;
