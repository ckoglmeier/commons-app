CREATE TABLE "participant_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"answered_by_person_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_answers_bounds" CHECK ("participant_answers"."revision" > 0 and length("participant_answers"."body") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "participant_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "participant_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"goal_revision" integer NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"purpose" text NOT NULL,
	"question" text NOT NULL,
	"visibility" text DEFAULT 'task_organizers' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"create_command_id" uuid NOT NULL,
	"publish_command_id" uuid,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"answer_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participant_questions_status" CHECK ("participant_questions"."status" in ('draft','published','closed','cancelled')),
	CONSTRAINT "participant_questions_channel" CHECK ("participant_questions"."channel" = 'web'),
	CONSTRAINT "participant_questions_visibility" CHECK ("participant_questions"."visibility" = 'task_organizers'),
	CONSTRAINT "participant_questions_bounds" CHECK (length("participant_questions"."question") between 1 and 300 and length("participant_questions"."purpose") between 1 and 160 and "participant_questions"."version" > 0 and "participant_questions"."answer_revision" >= 0),
	CONSTRAINT "participant_questions_published" CHECK (("participant_questions"."status" = 'draft') = ("participant_questions"."published_at" is null)),
	CONSTRAINT "participant_questions_not_self" CHECK ("participant_questions"."recipient_person_id" <> "participant_questions"."created_by_person_id")
);
--> statement-breakpoint
ALTER TABLE "participant_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "participant_answers" ADD CONSTRAINT "participant_answers_question_id_participant_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."participant_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_answers" ADD CONSTRAINT "participant_answers_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_answers" ADD CONSTRAINT "participant_answers_answered_by_person_id_people_id_fk" FOREIGN KEY ("answered_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_questions" ADD CONSTRAINT "participant_questions_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_questions" ADD CONSTRAINT "participant_questions_goal_id_coordinator_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."coordinator_goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_questions" ADD CONSTRAINT "participant_questions_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_questions" ADD CONSTRAINT "participant_questions_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "participant_answers_revision_unique" ON "participant_answers" USING btree ("question_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_answers_submission_unique" ON "participant_answers" USING btree ("question_id","submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_questions_create_unique" ON "participant_questions" USING btree ("commons_id","created_by_person_id","create_command_id");--> statement-breakpoint
CREATE INDEX "participant_questions_recipient_idx" ON "participant_questions" USING btree ("recipient_person_id","commons_id","status");--> statement-breakpoint
CREATE INDEX "participant_questions_goal_idx" ON "participant_questions" USING btree ("goal_id");