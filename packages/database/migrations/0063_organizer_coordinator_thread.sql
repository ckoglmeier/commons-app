CREATE TABLE "coordinator_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"command_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"user_text" text NOT NULL,
	"assistant_text" text NOT NULL,
	"draft_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_turns_positive_sequence" CHECK ("coordinator_turns"."sequence" > 0)
);
--> statement-breakpoint
ALTER TABLE "coordinator_turns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD CONSTRAINT "coordinator_turns_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD CONSTRAINT "coordinator_turns_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD CONSTRAINT "coordinator_turns_draft_id_poll_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."poll_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_turns_owner_sequence_unique" ON "coordinator_turns" USING btree ("commons_id","owner_person_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_turns_owner_command_unique" ON "coordinator_turns" USING btree ("commons_id","owner_person_id","command_id");
--> statement-breakpoint
REVOKE ALL ON public.coordinator_turns FROM PUBLIC, anon, authenticated;
