CREATE TABLE "personal_coordinator_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"user_text" text NOT NULL,
	"reply" text,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_coordinator_status_check" CHECK ("personal_coordinator_turns"."status" in ('pending','completed','failed')),
	CONSTRAINT "personal_coordinator_bounds_check" CHECK (length("personal_coordinator_turns"."user_text") between 1 and 1800 and ("personal_coordinator_turns"."reply" is null or length("personal_coordinator_turns"."reply") between 1 and 4000) and "personal_coordinator_turns"."attempt" between 1 and 3)
);
--> statement-breakpoint
ALTER TABLE "personal_coordinator_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "personal_coordinator_turns" ADD CONSTRAINT "personal_coordinator_turns_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_coordinator_turns" ADD CONSTRAINT "personal_coordinator_turns_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_coordinator_command_unique" ON "personal_coordinator_turns" USING btree ("commons_id","person_id","command_id");--> statement-breakpoint
CREATE INDEX "personal_coordinator_history_idx" ON "personal_coordinator_turns" USING btree ("commons_id","person_id","created_at");