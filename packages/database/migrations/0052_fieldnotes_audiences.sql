ALTER TABLE "poll_responses" ADD COLUMN "respondent_auth_user_id" uuid;--> statement-breakpoint
ALTER TABLE "polls" ADD COLUMN "audience" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_responses_poll_auth_unique" ON "poll_responses" USING btree ("poll_id","respondent_auth_user_id");