CREATE TYPE "public"."poll_ballot_mode" AS ENUM('transparent', 'secret');--> statement-breakpoint
CREATE TYPE "public"."poll_status" AS ENUM('open', 'closed', 'revoked');--> statement-breakpoint
CREATE TABLE "poll_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"respondent_person_id" uuid,
	"respondent_name" text NOT NULL,
	"receipt_token_hash" text NOT NULL,
	"answers" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"title" text NOT NULL,
	"intro" text,
	"ballot_mode" "poll_ballot_mode" NOT NULL,
	"status" "poll_status" DEFAULT 'open' NOT NULL,
	"questions" jsonb NOT NULL,
	"share_token_hash" text NOT NULL,
	"share_token_value" text NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "poll_responses" ADD CONSTRAINT "poll_responses_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_responses" ADD CONSTRAINT "poll_responses_respondent_person_id_people_id_fk" FOREIGN KEY ("respondent_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "poll_responses_receipt_token_unique" ON "poll_responses" USING btree ("receipt_token_hash");--> statement-breakpoint
CREATE INDEX "poll_responses_poll_updated_idx" ON "poll_responses" USING btree ("poll_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "polls_commons_command_unique" ON "polls" USING btree ("commons_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "polls_share_token_hash_unique" ON "polls" USING btree ("share_token_hash");--> statement-breakpoint
CREATE INDEX "polls_commons_created_idx" ON "polls" USING btree ("commons_id","created_at");
--> statement-breakpoint
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.poll_responses ENABLE ROW LEVEL SECURITY;
