CREATE TABLE "feedback_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_slug" text NOT NULL,
	"source" text NOT NULL,
	"question_version" integer NOT NULL,
	"respondent_name" text,
	"answers" jsonb NOT NULL,
	"page_path" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_submissions_idempotency_unique" ON "feedback_submissions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "feedback_submissions_created_idx" ON "feedback_submissions" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
