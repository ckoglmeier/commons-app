CREATE TABLE "research_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"agent_id" text NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "research_attempts_status_check" CHECK ("research_attempts"."status" in ('processing','succeeded','failed','expired','cancelled'))
);
--> statement-breakpoint
ALTER TABLE "research_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "research_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"request" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_tasks_status_check" CHECK ("research_tasks"."status" in ('pending','processing','succeeded','failed','cancelled')),
	CONSTRAINT "research_tasks_attempts_check" CHECK ("research_tasks"."attempts" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "research_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "research_attempts" ADD CONSTRAINT "research_attempts_task_id_research_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."research_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_tasks" ADD CONSTRAINT "research_tasks_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "research_attempts_task_number_unique" ON "research_attempts" USING btree ("task_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "research_tasks_event_command_unique" ON "research_tasks" USING btree ("commons_id","command_id");--> statement-breakpoint
CREATE INDEX "research_tasks_ready_idx" ON "research_tasks" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
REVOKE ALL ON TABLE public.research_tasks, public.research_attempts FROM PUBLIC, anon, authenticated;
