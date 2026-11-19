CREATE TABLE "coordinator_turn_executions" (
	"turn_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"commons_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"status" text NOT NULL,
	"input" jsonb,
	"claim_token" uuid,
	"claimed_by" text,
	"claims" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"provider_started_at" timestamp with time zone,
	"progress" jsonb,
	"disposition" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "coordinator_turn_executions_turn_id_attempt_pk" PRIMARY KEY("turn_id","attempt"),
	CONSTRAINT "coordinator_turn_executions_status" CHECK ("coordinator_turn_executions"."status" in ('queued','running','completed','interrupted','cancelled')),
	CONSTRAINT "coordinator_turn_executions_attempt" CHECK ("coordinator_turn_executions"."attempt" between 1 and 3),
	CONSTRAINT "coordinator_turn_executions_claims" CHECK ("coordinator_turn_executions"."claims" between 0 and 10),
	CONSTRAINT "coordinator_turn_executions_running_claim" CHECK ("coordinator_turn_executions"."status" <> 'running' or ("coordinator_turn_executions"."claim_token" is not null and "coordinator_turn_executions"."lease_expires_at" is not null)),
	CONSTRAINT "coordinator_turn_executions_terminal_input" CHECK ("coordinator_turn_executions"."status" in ('queued','running') or "coordinator_turn_executions"."input" is null)
);
--> statement-breakpoint
ALTER TABLE "coordinator_turn_executions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coordinator_turn_executions" ADD CONSTRAINT "coordinator_turn_executions_turn_id_coordinator_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."coordinator_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_turn_executions" ADD CONSTRAINT "coordinator_turn_executions_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_turn_executions" ADD CONSTRAINT "coordinator_turn_executions_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coordinator_turn_executions_open_idx" ON "coordinator_turn_executions" USING btree ("status","created_at") WHERE "coordinator_turn_executions"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "coordinator_turn_executions_commons_idx" ON "coordinator_turn_executions" USING btree ("commons_id");