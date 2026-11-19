DROP POLICY IF EXISTS "commons_moments_storage_select_members" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "commons_moments_storage_select_members"
ON storage.objects FOR SELECT
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
