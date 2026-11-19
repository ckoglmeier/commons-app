-- Relational data is served by authorized server repositories. Storage still
-- needs event id/slug lookup under commons_select_members and the four helpers.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Table revocation does not remove previously granted column privileges.
DO $$
DECLARE col record;
BEGIN
  FOR col IN SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON TABLE public.%I FROM PUBLIC, anon, authenticated', col.column_name, col.table_name);
  END LOOP;
END $$;
--> statement-breakpoint
GRANT SELECT (id, slug) ON public.commons TO authenticated;
--> statement-breakpoint
DROP POLICY IF EXISTS participation_insert_self ON public.participation;
DROP POLICY IF EXISTS participation_update_self ON public.participation;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
