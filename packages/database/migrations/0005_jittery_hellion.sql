CREATE TYPE "public"."moment_source" AS ENUM('thread', 'web', 'import');--> statement-breakpoint
CREATE TABLE "moments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"kind" text DEFAULT 'photo' NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text DEFAULT 'image/jpeg' NOT NULL,
	"caption" text NOT NULL,
	"alt_text" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"added_by_person_id" uuid,
	"source" "moment_source" NOT NULL,
	"source_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_added_by_person_id_people_id_fk" FOREIGN KEY ("added_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moments_commons_occurred_idx" ON "moments" USING btree ("commons_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moments_commons_storage_unique" ON "moments" USING btree ("commons_id","storage_path");
--> statement-breakpoint
ALTER TABLE public.moments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "moments_select_members"
ON public.moments FOR SELECT
TO authenticated
USING (public.is_commons_member(commons_id));
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'commons-moments',
  'commons-moments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
--> statement-breakpoint
CREATE POLICY "commons_moments_storage_select_members"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'commons-moments'
  AND EXISTS (
    SELECT 1
    FROM public.commons target_commons
    WHERE target_commons.slug = (storage.foldername(name))[1]
      AND public.is_commons_member(target_commons.id)
  )
);
