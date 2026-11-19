CREATE TABLE "poll_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"commons_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"last_command_id" uuid NOT NULL,
	"last_command_fingerprint" text NOT NULL,
	"published_poll_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_drafts_positive_version" CHECK ("poll_drafts"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "poll_drafts" ADD CONSTRAINT "poll_drafts_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_drafts" ADD CONSTRAINT "poll_drafts_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_drafts" ADD CONSTRAINT "poll_drafts_published_poll_id_polls_id_fk" FOREIGN KEY ("published_poll_id") REFERENCES "public"."polls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "poll_drafts_owner_event_idx" ON "poll_drafts" USING btree ("owner_person_id","commons_id","updated_at");
--> statement-breakpoint
ALTER TABLE public.poll_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.poll_drafts FROM anon, authenticated;
