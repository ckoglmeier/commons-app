DROP INDEX "coordinator_turns_owner_sequence_unique";--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD COLUMN "organizer_shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD COLUMN "context_poll_id" uuid;--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD COLUMN "context_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "poll_drafts" ADD COLUMN "organizer_shared" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "coordinator_turns" ADD CONSTRAINT "coordinator_turns_context_poll_id_polls_id_fk" FOREIGN KEY ("context_poll_id") REFERENCES "public"."polls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_turns_shared_sequence_unique" ON "coordinator_turns" USING btree ("commons_id","sequence") WHERE "coordinator_turns"."organizer_shared";--> statement-breakpoint
CREATE UNIQUE INDEX "coordinator_turns_owner_sequence_unique" ON "coordinator_turns" USING btree ("commons_id","owner_person_id","sequence") WHERE not "coordinator_turns"."organizer_shared";