CREATE TABLE "photo_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "photo_deletions_path_unique" ON "photo_deletions" USING btree ("storage_path");--> statement-breakpoint
CREATE INDEX "photo_deletions_available_idx" ON "photo_deletions" USING btree ("status","available_at");
--> statement-breakpoint
ALTER TABLE public.photo_deletions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.photo_deletions FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION public.commons_photo_is_available(object_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.photo_deletions WHERE storage_path = object_path) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.commons_photo_is_available(text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.commons_photo_is_available(text) TO authenticated;
--> statement-breakpoint
DROP POLICY commons_moments_storage_select_members ON storage.objects;
--> statement-breakpoint
CREATE POLICY commons_moments_storage_select_members ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'commons-moments' AND public.commons_photo_is_available(name) AND EXISTS (
  SELECT 1 FROM public.commons c WHERE c.slug = (storage.foldername(storage.objects.name))[1] AND public.is_commons_member(c.id)
));
--> statement-breakpoint
DROP POLICY commons_moments_storage_insert_members ON storage.objects;
--> statement-breakpoint
CREATE POLICY commons_moments_storage_insert_members ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'commons-moments' AND public.commons_photo_is_available(name) AND EXISTS (
  SELECT 1 FROM public.commons c WHERE c.slug = (storage.foldername(storage.objects.name))[1] AND public.is_commons_member(c.id)
));
--> statement-breakpoint
DROP POLICY commons_moments_storage_delete_members ON storage.objects;
