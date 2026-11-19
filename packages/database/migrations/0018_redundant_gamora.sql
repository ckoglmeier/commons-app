CREATE TYPE "public"."event_creation_draft_status" AS ENUM('reviewing', 'committed', 'abandoned');--> statement-breakpoint
CREATE TABLE "event_creation_draft_people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"draft_id" uuid NOT NULL,
	"person_id" uuid,
	"source_membership_id" uuid,
	"display_name" text NOT NULL,
	"email" text,
	"source" text NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"needs_contact" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_creation_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"status" "event_creation_draft_status" DEFAULT 'reviewing' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_kind" text NOT NULL,
	"source_event_id" uuid,
	"source_event_name" text,
	"description" text,
	"proposed_name" text,
	"starts_on" date,
	"ends_on" date,
	"location_name" text,
	"timezone" text NOT NULL,
	"event_type_key" text DEFAULT 'travel' NOT NULL,
	"event_context_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"template_key" text DEFAULT 'travel-general' NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"supported" boolean DEFAULT true NOT NULL,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"interpretation_status" text DEFAULT 'not_required' NOT NULL,
	"interpretation_error_code" text,
	"committed_event_id" uuid,
	"committed_event_slug" text,
	"source_delete_after" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "event_type_key" text DEFAULT 'travel' NOT NULL;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "event_context_keys" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "template_version" integer;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "creation_source_kind" text;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "commons" ADD COLUMN "event_brief" jsonb;--> statement-breakpoint
ALTER TABLE "event_creation_draft_people" ADD CONSTRAINT "event_creation_draft_people_draft_id_event_creation_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."event_creation_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_creation_draft_people" ADD CONSTRAINT "event_creation_draft_people_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_creation_drafts" ADD CONSTRAINT "event_creation_drafts_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_creation_drafts" ADD CONSTRAINT "event_creation_drafts_source_event_id_commons_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."commons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_creation_drafts" ADD CONSTRAINT "event_creation_drafts_committed_event_id_commons_id_fk" FOREIGN KEY ("committed_event_id") REFERENCES "public"."commons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_creation_draft_people_draft_position_idx" ON "event_creation_draft_people" USING btree ("draft_id","position");--> statement-breakpoint
CREATE INDEX "event_creation_draft_people_person_idx" ON "event_creation_draft_people" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "event_creation_drafts_owner_updated_idx" ON "event_creation_drafts" USING btree ("created_by_person_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_creation_drafts_committed_event_unique" ON "event_creation_drafts" USING btree ("committed_event_id");--> statement-breakpoint
ALTER TABLE public.event_creation_drafts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.event_creation_draft_people ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "event_creation_drafts_select_owner"
ON public.event_creation_drafts FOR SELECT
TO authenticated
USING (created_by_person_id = public.current_person_id());--> statement-breakpoint
CREATE POLICY "event_creation_draft_people_select_owner"
ON public.event_creation_draft_people FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.event_creation_drafts draft
    WHERE draft.id = draft_id
      AND draft.created_by_person_id = public.current_person_id()
  )
);
