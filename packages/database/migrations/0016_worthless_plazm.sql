CREATE TABLE "product_analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_name" text NOT NULL,
	"anonymous_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"auth_user_id" text,
	"commons_slug" text,
	"page_path" text NOT NULL,
	"referrer" text,
	"properties" jsonb NOT NULL,
	"user_agent" text,
	"country" text,
	"region" text,
	"city" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "product_analytics_events_name_created_idx" ON "product_analytics_events" USING btree ("event_name","created_at");--> statement-breakpoint
CREATE INDEX "product_analytics_events_session_idx" ON "product_analytics_events" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "product_analytics_events_auth_user_idx" ON "product_analytics_events" USING btree ("auth_user_id","created_at");--> statement-breakpoint
CREATE INDEX "product_analytics_events_commons_idx" ON "product_analytics_events" USING btree ("commons_slug","created_at");--> statement-breakpoint
ALTER TABLE public.product_analytics_events ENABLE ROW LEVEL SECURITY;
