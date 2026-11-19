-- Schema-scoped revocation cannot remove grants inherited from global defaults.
ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Hosted defaults may have granted direct function access before migrations
-- revoked PUBLIC. Re-state the reviewed helper boundary for named roles too.
REVOKE ALL ON FUNCTION public.current_person_id(), public.is_commons_member(uuid), public.is_commons_organizer(uuid), public.shares_commons(uuid), public.can_read_private_travel_plan(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_person_id(), public.is_commons_member(uuid), public.is_commons_organizer(uuid), public.shares_commons(uuid), public.can_read_private_travel_plan(uuid) TO authenticated;
