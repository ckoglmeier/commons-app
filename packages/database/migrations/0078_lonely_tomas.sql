CREATE TABLE "coordinator_worker_health" (
	"kind" text PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coordinator_worker_health" ENABLE ROW LEVEL SECURITY;