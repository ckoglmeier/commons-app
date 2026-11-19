CREATE TABLE "coordinator_goal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"goal_revision" integer NOT NULL,
	"actor_person_id" uuid,
	"command_id" uuid,
	"fingerprint" text,
	"event_key" text,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordinator_goal_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_goal_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"main_thread_id" uuid NOT NULL,
	"goal_revision" integer NOT NULL,
	"kind" text NOT NULL,
	"discriminator" text DEFAULT '' NOT NULL,
	"headline" text NOT NULL,
	"detail" text,
	"next_action" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_goal_reports_kind_check" CHECK ("coordinator_goal_reports"."kind" in ('completed', 'needs_input', 'needs_approval', 'failed', 'milestone', 'late_reply'))
);
--> statement-breakpoint
ALTER TABLE "coordinator_goal_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_goal_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"goal_revision" integer NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"params" jsonb NOT NULL,
	"ref_id" uuid,
	"result" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_goal_steps_kind_check" CHECK ("coordinator_goal_steps"."kind" in ('research', 'poll', 'plan_action', 'outreach')),
	CONSTRAINT "coordinator_goal_steps_status_check" CHECK ("coordinator_goal_steps"."status" in ('pending', 'running', 'waiting', 'done', 'failed', 'cancelled', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "coordinator_goal_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_goal_suggestion_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"itinerary_item_id" uuid NOT NULL,
	"idea_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordinator_goal_suggestion_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"main_thread_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"completion_criterion" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"context_version" integer,
	"lifecycle" text DEFAULT 'ready' NOT NULL,
	"wait_detail" text,
	"envelope" jsonb NOT NULL,
	"goal_key" text NOT NULL,
	"idea_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"legacy_task_id" uuid,
	"outcome" jsonb,
	"outcome_revision" integer,
	"error_code" text,
	"command_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "coordinator_goals_kind_check" CHECK ("coordinator_goals"."kind" in ('research', 'poll', 'plan_action', 'participant', 'book')),
	CONSTRAINT "coordinator_goals_lifecycle_check" CHECK ("coordinator_goals"."lifecycle" in ('ready', 'running', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_event', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "coordinator_goals_revision_check" CHECK ("coordinator_goals"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "coordinator_goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_outreach" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"channel" text DEFAULT 'synthetic_sms' NOT NULL,
	"conversation_address" text NOT NULL,
	"status" text DEFAULT 'awaiting_approval' NOT NULL,
	"send_snapshot" jsonb NOT NULL,
	"approved_by_person_id" uuid,
	"approved_at" timestamp with time zone,
	"max_follow_ups" integer DEFAULT 1 NOT NULL,
	"follow_ups_sent" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_outreach_status_check" CHECK ("coordinator_outreach"."status" in ('awaiting_approval', 'sent', 'replied', 'closed', 'opted_out', 'timed_out', 'failed')),
	CONSTRAINT "coordinator_outreach_followups_check" CHECK ("coordinator_outreach"."follow_ups_sent" between 0 and "coordinator_outreach"."max_follow_ups")
);
--> statement-breakpoint
ALTER TABLE "coordinator_outreach" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "coordinator_outreach_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outreach_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"provider_message_id" text NOT NULL,
	"body" text NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_outreach_messages_direction_check" CHECK ("coordinator_outreach_messages"."direction" in ('outbound', 'inbound'))
);
--> statement-breakpoint
ALTER TABLE "coordinator_outreach_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coordinator_thread_links" DROP CONSTRAINT "coordinator_thread_links_kind_check";--> statement-breakpoint
ALTER TABLE "coordinator_goal_events" ADD CONSTRAINT "coordinator_goal_events_goal_id_coordinator_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."coordinator_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_events" ADD CONSTRAINT "coordinator_goal_events_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_events" ADD CONSTRAINT "coordinator_goal_events_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_reports" ADD CONSTRAINT "coordinator_goal_reports_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_reports" ADD CONSTRAINT "coordinator_goal_reports_goal_id_coordinator_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."coordinator_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_reports" ADD CONSTRAINT "coordinator_goal_reports_main_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("main_thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_steps" ADD CONSTRAINT "coordinator_goal_steps_goal_id_coordinator_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."coordinator_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_steps" ADD CONSTRAINT "coordinator_goal_steps_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_suggestion_dismissals" ADD CONSTRAINT "coordinator_goal_suggestion_dismissals_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_suggestion_dismissals" ADD CONSTRAINT "coordinator_goal_suggestion_dismissals_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goal_suggestion_dismissals" ADD CONSTRAINT "coordinator_goal_suggestion_dismissals_itinerary_item_id_itinerary_items_id_fk" FOREIGN KEY ("itinerary_item_id") REFERENCES "public"."itinerary_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goals" ADD CONSTRAINT "coordinator_goals_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goals" ADD CONSTRAINT "coordinator_goals_main_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("main_thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goals" ADD CONSTRAINT "coordinator_goals_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goals" ADD CONSTRAINT "coordinator_goals_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_goals" ADD CONSTRAINT "coordinator_goals_legacy_task_id_research_tasks_id_fk" FOREIGN KEY ("legacy_task_id") REFERENCES "public"."research_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_outreach" ADD CONSTRAINT "coordinator_outreach_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_outreach" ADD CONSTRAINT "coordinator_outreach_goal_id_coordinator_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."coordinator_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_outreach" ADD CONSTRAINT "coordinator_outreach_step_id_coordinator_goal_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."coordinator_goal_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_outreach" ADD CONSTRAINT "coordinator_outreach_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_outreach" ADD CONSTRAINT "coordinator_outreach_approved_by_person_id_people_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_outreach_messages" ADD CONSTRAINT "coordinator_outreach_messages_outreach_id_coordinator_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."coordinator_outreach"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_outreach_messages" ADD CONSTRAINT "coordinator_outreach_messages_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goal_events_command_unique" ON "coordinator_goal_events" USING btree ("commons_id","command_id") WHERE "coordinator_goal_events"."command_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goal_events_event_key_unique" ON "coordinator_goal_events" USING btree ("goal_id","event_key") WHERE "coordinator_goal_events"."event_key" is not null;--> statement-breakpoint
CREATE INDEX "coordinator_goal_events_goal_idx" ON "coordinator_goal_events" USING btree ("goal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goal_reports_once" ON "coordinator_goal_reports" USING btree ("goal_id","goal_revision","kind","discriminator");--> statement-breakpoint
CREATE INDEX "coordinator_goal_reports_main_idx" ON "coordinator_goal_reports" USING btree ("main_thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goal_steps_position_unique" ON "coordinator_goal_steps" USING btree ("goal_id","goal_revision","seq");--> statement-breakpoint
CREATE INDEX "coordinator_goal_steps_ref_idx" ON "coordinator_goal_steps" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX "coordinator_goal_steps_waiting_idx" ON "coordinator_goal_steps" USING btree ("kind","status");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goal_dismissals_unique" ON "coordinator_goal_suggestion_dismissals" USING btree ("person_id","itinerary_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goals_command_unique" ON "coordinator_goals" USING btree ("commons_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goals_thread_unique" ON "coordinator_goals" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goals_legacy_task_unique" ON "coordinator_goals" USING btree ("legacy_task_id") WHERE "coordinator_goals"."legacy_task_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_goals_one_active_per_key" ON "coordinator_goals" USING btree ("commons_id","goal_key") WHERE "coordinator_goals"."lifecycle" not in ('completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "coordinator_goals_trip_idx" ON "coordinator_goals" USING btree ("commons_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_outreach_address_unique" ON "coordinator_outreach" USING btree ("conversation_address");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_outreach_step_unique" ON "coordinator_outreach" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "coordinator_outreach_goal_idx" ON "coordinator_outreach" USING btree ("goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_outreach_messages_provider_unique" ON "coordinator_outreach_messages" USING btree ("outreach_id","provider_message_id");--> statement-breakpoint
ALTER TABLE "coordinator_thread_links" ADD CONSTRAINT "coordinator_thread_links_kind_check" CHECK ("coordinator_thread_links"."kind" in ('main', 'sub', 'task'));