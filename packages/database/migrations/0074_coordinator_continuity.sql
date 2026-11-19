CREATE TABLE "coordinator_task_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"actor_person_id" uuid,
	"kind" text NOT NULL,
	"revision" integer NOT NULL,
	"command_id" uuid,
	"fingerprint" text,
	"expected_revision" integer,
	"summary" text,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_task_events_kind_check" CHECK ("coordinator_task_events"."kind" in ('started', 'amended', 'cancelled', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "coordinator_task_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_task_state" (
	"task_id" uuid PRIMARY KEY NOT NULL,
	"commons_id" uuid NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"result_revision" integer,
	"needs_input" text,
	"attempts_base" integer DEFAULT 0 NOT NULL,
	"context_version" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_task_state_revision_check" CHECK ("coordinator_task_state"."revision" > 0 and "coordinator_task_state"."attempts_base" >= 0)
);
--> statement-breakpoint
ALTER TABLE "coordinator_task_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_thread_links" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"commons_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"parent_thread_id" uuid,
	"brief" text,
	"brief_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_thread_links_kind_check" CHECK ("coordinator_thread_links"."kind" in ('main', 'sub')),
	CONSTRAINT "coordinator_thread_links_main_has_no_parent" CHECK ("coordinator_thread_links"."kind" <> 'main' or ("coordinator_thread_links"."parent_thread_id" is null and "coordinator_thread_links"."brief" is null))
);
--> statement-breakpoint
ALTER TABLE "coordinator_thread_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_thread_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"source_thread_id" uuid NOT NULL,
	"target_thread_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"task_revision" integer NOT NULL,
	"summary" text NOT NULL,
	"created_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordinator_thread_outcomes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "research_attempts" DROP CONSTRAINT "research_attempts_status_check";--> statement-breakpoint
ALTER TABLE "research_tasks" DROP CONSTRAINT "research_tasks_status_check";--> statement-breakpoint
ALTER TABLE "research_tasks" DROP CONSTRAINT "research_tasks_attempts_check";--> statement-breakpoint
ALTER TABLE "coordinator_task_events" ADD CONSTRAINT "coordinator_task_events_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_task_events" ADD CONSTRAINT "coordinator_task_events_task_id_research_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."research_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_task_events" ADD CONSTRAINT "coordinator_task_events_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_task_events" ADD CONSTRAINT "coordinator_task_events_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_task_state" ADD CONSTRAINT "coordinator_task_state_task_id_research_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."research_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_task_state" ADD CONSTRAINT "coordinator_task_state_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_links" ADD CONSTRAINT "coordinator_thread_links_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_links" ADD CONSTRAINT "coordinator_thread_links_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_links" ADD CONSTRAINT "coordinator_thread_links_parent_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("parent_thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_outcomes" ADD CONSTRAINT "coordinator_thread_outcomes_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_outcomes" ADD CONSTRAINT "coordinator_thread_outcomes_source_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("source_thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_outcomes" ADD CONSTRAINT "coordinator_thread_outcomes_target_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("target_thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_outcomes" ADD CONSTRAINT "coordinator_thread_outcomes_task_id_research_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."research_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_thread_outcomes" ADD CONSTRAINT "coordinator_thread_outcomes_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_task_events_command_unique" ON "coordinator_task_events" USING btree ("commons_id","command_id") WHERE "coordinator_task_events"."command_id" is not null and "coordinator_task_events"."kind" in ('amended', 'cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_task_events_one_completion_per_revision" ON "coordinator_task_events" USING btree ("task_id","revision") WHERE "coordinator_task_events"."kind" = 'completed';--> statement-breakpoint
CREATE INDEX "coordinator_task_events_task_idx" ON "coordinator_task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "coordinator_task_state_commons_idx" ON "coordinator_task_state" USING btree ("commons_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_thread_links_one_main_per_trip" ON "coordinator_thread_links" USING btree ("commons_id") WHERE "coordinator_thread_links"."kind" = 'main';--> statement-breakpoint
CREATE INDEX "coordinator_thread_links_parent_idx" ON "coordinator_thread_links" USING btree ("parent_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_thread_outcomes_once" ON "coordinator_thread_outcomes" USING btree ("target_thread_id","task_id","task_revision");--> statement-breakpoint
CREATE INDEX "coordinator_thread_outcomes_target_idx" ON "coordinator_thread_outcomes" USING btree ("target_thread_id","created_at");--> statement-breakpoint
ALTER TABLE "research_attempts" ADD CONSTRAINT "research_attempts_status_check" CHECK ("research_attempts"."status" in ('processing','succeeded','failed','expired','cancelled','superseded'));--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_status_check" CHECK ("research_tasks"."status" in ('pending','processing','succeeded','failed','cancelled','needs_input'));--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_attempts_check" CHECK ("research_tasks"."attempts" between 0 and 1000);