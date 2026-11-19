ALTER TABLE "itinerary_items" ADD COLUMN "note" text;
--> statement-breakpoint
CREATE POLICY "commons_moments_storage_insert_members"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'commons-moments'
  AND EXISTS (
    SELECT 1
    FROM public.commons target_commons
    WHERE target_commons.slug = (storage.foldername(storage.objects.name))[1]
      AND public.is_commons_member(target_commons.id)
  )
);
--> statement-breakpoint
CREATE POLICY "commons_moments_storage_delete_members"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'commons-moments'
  AND EXISTS (
    SELECT 1
    FROM public.commons target_commons
    WHERE target_commons.slug = (storage.foldername(storage.objects.name))[1]
      AND public.is_commons_member(target_commons.id)
  )
);
