DO $$
DECLARE
  has_rows boolean;
BEGIN
  IF to_regclass('public.jobs') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.jobs LIMIT 1)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'Refusing to remove public.jobs because it contains rows.';
    END IF;
  END IF;
END
$$;--> statement-breakpoint
DROP TABLE IF EXISTS "jobs";--> statement-breakpoint
DROP TYPE IF EXISTS "public"."job_status";
