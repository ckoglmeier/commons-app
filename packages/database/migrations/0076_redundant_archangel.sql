CREATE TABLE "trip_brain_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"snapshot_hash" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"finding_key" text NOT NULL,
	"finding" jsonb NOT NULL,
	"disposition" text DEFAULT 'new' NOT NULL,
	"snoozed_until" timestamp with time zone,
	"goal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trip_brain_recommendations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_brain_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"snapshot_hash" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"local_day" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"reserved_cents" integer NOT NULL,
	"actual_cents" integer,
	"model_policy" text NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "trip_brain_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_brain_settings" (
	"commons_id" uuid PRIMARY KEY NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"paused" boolean DEFAULT true NOT NULL,
	"entitled" boolean DEFAULT false NOT NULL,
	"budget_cents" integer,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"opted_by_person_id" uuid,
	"last_review_at" timestamp with time zone,
	"next_review_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_brain_budget_valid" CHECK ("trip_brain_settings"."reserved_cents" >= 0 and "trip_brain_settings"."spent_cents" >= 0 and ("trip_brain_settings"."budget_cents" is null or "trip_brain_settings"."budget_cents" >= 0))
);
--> statement-breakpoint
ALTER TABLE "trip_brain_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trip_brain_recommendations" ADD CONSTRAINT "trip_brain_recommendations_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_brain_recommendations" ADD CONSTRAINT "trip_brain_recommendations_review_id_trip_brain_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."trip_brain_reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_brain_recommendations" ADD CONSTRAINT "trip_brain_recommendations_goal_id_coordinator_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."coordinator_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_brain_reviews" ADD CONSTRAINT "trip_brain_reviews_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_brain_reviews" ADD CONSTRAINT "trip_brain_reviews_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_brain_settings" ADD CONSTRAINT "trip_brain_settings_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_brain_settings" ADD CONSTRAINT "trip_brain_settings_opted_by_person_id_people_id_fk" FOREIGN KEY ("opted_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trip_brain_recommendations_evidence" ON "trip_brain_recommendations" USING btree ("commons_id","finding_key","evidence_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_brain_reviews_one_day" ON "trip_brain_reviews" USING btree ("commons_id","local_day");--> statement-breakpoint
CREATE INDEX "trip_brain_reviews_status" ON "trip_brain_reviews" USING btree ("status","lease_until");