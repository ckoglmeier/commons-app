create or replace function public.current_person_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.people
  where auth_user_id = auth.uid()
  limit 1
$$;
--> statement-breakpoint
create or replace function public.is_commons_member(target_commons_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships
    where commons_id = target_commons_id
      and person_id = public.current_person_id()
      and status = 'active'
  )
$$;
--> statement-breakpoint
create or replace function public.is_commons_organizer(target_commons_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships
    where commons_id = target_commons_id
      and person_id = public.current_person_id()
      and status = 'active'
      and role = 'organizer'
  )
$$;
--> statement-breakpoint
create or replace function public.shares_commons(target_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs
      on theirs.commons_id = mine.commons_id
    where mine.person_id = public.current_person_id()
      and mine.status = 'active'
      and theirs.person_id = target_person_id
      and theirs.status = 'active'
  )
$$;
--> statement-breakpoint
revoke all on function public.current_person_id() from public;
revoke all on function public.is_commons_member(uuid) from public;
revoke all on function public.is_commons_organizer(uuid) from public;
revoke all on function public.shares_commons(uuid) from public;
grant execute on function public.current_person_id() to authenticated;
grant execute on function public.is_commons_member(uuid) to authenticated;
grant execute on function public.is_commons_organizer(uuid) to authenticated;
grant execute on function public.shares_commons(uuid) to authenticated;
--> statement-breakpoint
alter table public.people enable row level security;
alter table public.identities enable row level security;
alter table public.commons enable row level security;
alter table public.memberships enable row level security;
alter table public.consent_events enable row level security;
alter table public.messages enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_evidence enable row level security;
alter table public.itinerary_items enable row level security;
alter table public.participation enable row level security;
alter table public.audit_events enable row level security;
alter table public.processed_commands enable row level security;
alter table public.jobs enable row level security;
--> statement-breakpoint
create policy "people_select_trip_peers"
on public.people for select
to authenticated
using (
  id = public.current_person_id()
  or public.shares_commons(id)
);
--> statement-breakpoint
create policy "identities_select_self"
on public.identities for select
to authenticated
using (person_id = public.current_person_id());
--> statement-breakpoint
create policy "commons_select_members"
on public.commons for select
to authenticated
using (public.is_commons_member(id));
--> statement-breakpoint
create policy "memberships_select_members"
on public.memberships for select
to authenticated
using (public.is_commons_member(commons_id));
--> statement-breakpoint
create policy "consent_events_select_self"
on public.consent_events for select
to authenticated
using (person_id = public.current_person_id());
--> statement-breakpoint
create policy "messages_select_members"
on public.messages for select
to authenticated
using (public.is_commons_member(commons_id));
--> statement-breakpoint
create policy "proposals_select_members"
on public.proposals for select
to authenticated
using (public.is_commons_member(commons_id));
--> statement-breakpoint
create policy "proposal_evidence_select_members"
on public.proposal_evidence for select
to authenticated
using (
  exists (
    select 1
    from public.proposals
    where proposals.id = proposal_evidence.proposal_id
      and public.is_commons_member(proposals.commons_id)
  )
);
--> statement-breakpoint
create policy "itinerary_select_members"
on public.itinerary_items for select
to authenticated
using (public.is_commons_member(commons_id));
--> statement-breakpoint
create policy "participation_select_members"
on public.participation for select
to authenticated
using (
  exists (
    select 1
    from public.itinerary_items
    where itinerary_items.id = participation.itinerary_item_id
      and public.is_commons_member(itinerary_items.commons_id)
  )
);
--> statement-breakpoint
create policy "participation_insert_self"
on public.participation for insert
to authenticated
with check (
  person_id = public.current_person_id()
  and exists (
    select 1
    from public.itinerary_items
    where itinerary_items.id = participation.itinerary_item_id
      and public.is_commons_member(itinerary_items.commons_id)
  )
);
--> statement-breakpoint
create policy "participation_update_self"
on public.participation for update
to authenticated
using (person_id = public.current_person_id())
with check (person_id = public.current_person_id());
--> statement-breakpoint
create policy "audit_events_select_members"
on public.audit_events for select
to authenticated
using (public.is_commons_member(commons_id));

-- No authenticated mutation policies exist for shared messages, proposals,
-- itinerary, audit, processed commands, or jobs. Those writes must pass through
-- the server command layer, which uses a narrowly held service credential and
-- records the verified actor in the same transaction.
