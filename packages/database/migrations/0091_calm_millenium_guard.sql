CREATE TABLE "coordinator_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"commons_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"bound_thread_id" uuid,
	"filename" text NOT NULL,
	"digest" text NOT NULL,
	"extracted_text" text NOT NULL,
	"limitations" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coordinator_sources_text_bound" CHECK (length("coordinator_sources"."extracted_text") between 1 and 30000),
	CONSTRAINT "coordinator_sources_digest_bound" CHECK (length("coordinator_sources"."digest") = 64)
);
--> statement-breakpoint
ALTER TABLE "coordinator_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "coordinator_sources" ADD CONSTRAINT "coordinator_sources_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_sources" ADD CONSTRAINT "coordinator_sources_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_sources" ADD CONSTRAINT "coordinator_sources_bound_thread_id_coordinator_threads_id_fk" FOREIGN KEY ("bound_thread_id") REFERENCES "public"."coordinator_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coordinator_sources_owner_trip_idx" ON "coordinator_sources" USING btree ("owner_person_id","commons_id");
--> statement-breakpoint
REVOKE ALL ON TABLE coordinator_sources FROM PUBLIC, anon, authenticated;
