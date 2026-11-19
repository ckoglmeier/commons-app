import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("prepared coordinator recommendations are additive and denied to browser database roles", async () => {
  const migration = await readFile(new URL("../migrations/0064_unknown_blockbuster.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "coordinator_recommendations"/);
  assert.match(migration, /ALTER TABLE "coordinator_recommendations" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE "coordinator_recommendations" FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /coordinator_recommendations_owner_poll_unique/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|CREATE POLICY|GRANT /i);
});

const rlsTables = [
  "people",
  "identities",
  "commons",
  "memberships",
  "consent_events",
  "expenses",
  "expense_shares",
  "reimbursements",
  "travel_plans",
  "moments",
  "feedback_submissions",
  "messages",
  "proposals",
  "proposal_evidence",
  "itinerary_items",
  "participation",
  "audit_events",
  "processed_commands",
  "invitation_delivery_attempts",
  "event_creation_drafts",
  "event_creation_draft_people",
  "event_creation_access",
  "operator_audit_events",
  "polls",
  "poll_responses",
  "stays",
  "stay_participants",
  "confirmation_documents",
  "travel_plan_participants",
] as const;

test("Fieldnotes drafts are additive and accessible only through server commands", async () => {
  const migration = await readFile(new URL("../migrations/0050_fieldnotes_working_drafts.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE "poll_drafts"/i);
  assert.match(migration, /ALTER TABLE public\.poll_drafts ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON public\.poll_drafts FROM anon, authenticated/i);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE|CREATE POLICY/i);
});

test("enables RLS across every pilot table", async () => {
  const migration = (
    await Promise.all([
      readFile(new URL("../migrations/0001_row_level_security.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0004_aspiring_captain_flint.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0005_jittery_hellion.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0008_demo_feedback.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0015_superb_leper_queen.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0018_redundant_gamora.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0019_jazzy_satana.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0021_magenta_thundra.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0028_lucky_aqueduct.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0032_first_class_stays.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0041_loving_killmonger.sql", import.meta.url), "utf8"),
      readFile(new URL("../migrations/0043_glossy_dark_phoenix.sql", import.meta.url), "utf8"),
    ])
  ).join("\n");

  for (const table of rlsTables) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security;`, "i"),
      `${table} must have RLS enabled`,
    );
  }
});

test("makes rental cars independent, multi-traveler records without opening direct writes", async () => {
  const migration = await readFile(new URL("../migrations/0043_glossy_dark_phoenix.sql", import.meta.url), "utf8");
  assert.match(migration, /create table "travel_plan_participants"/i);
  assert.match(migration, /where "travel_plans"\."kind" <> 'car_rental'/i);
  assert.match(migration, /select "id", "companion_person_id" from "travel_plans"/i);
  assert.match(migration, /alter table public\.travel_plan_participants enable row level security/i);
  assert.match(migration, /can_read_private_travel_plan/i);
  assert.doesNotMatch(migration, /on public\.travel_plan_participants for (insert|update|delete)/i);
});

test("persists first-class stays and backfills existing lodging without opening direct writes", async () => {
  const migration = await readFile(
    new URL("../migrations/0032_first_class_stays.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table "stays"/i);
  assert.match(migration, /create table "stay_participants"/i);
  assert.match(migration, /"booking_url" text/i);
  assert.match(migration, /"poll_id" uuid/i);
  assert.match(migration, /from "expenses" e[\s\S]*"category" = 'Lodging'/i);
  assert.match(migration, /alter table public\.stays enable row level security/i);
  assert.match(migration, /alter table public\.stay_participants enable row level security/i);
  assert.doesNotMatch(migration, /on public\.(stays|stay_participants) for (insert|update|delete)/i);
});

test("adds explicit Stay cost provenance without changing ledger write access", async () => {
  const migration = await readFile(
    new URL("../migrations/0039_tearful_black_cat.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /add column "cost_source" text/i);
  assert.match(migration, /add column "includes_taxes_and_fees" boolean/i);
  assert.match(migration, /legacy_expense_id.*is not null/i);
  assert.match(migration, /stays_cost_details_valid/i);
  assert.doesNotMatch(migration, /on public\.(stays|expenses) for (insert|update|delete)/i);
});

test("removes the unused generic jobs queue only when it is empty", async () => {
  const migration = await readFile(
    new URL("../migrations/0029_big_living_mummy.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /refusing to remove public\.jobs because it contains rows/i);
  assert.match(migration, /drop table if exists "jobs"/i);
  assert.match(migration, /drop type if exists "public"\."job_status"/i);
});

test("keeps shared-state writes behind the server command layer", async () => {
  const migration = await readFile(
    new URL("../migrations/0001_row_level_security.sql", import.meta.url),
    "utf8",
  );

  for (const table of [
    "messages",
    "proposals",
    "itinerary_items",
    "audit_events",
    "processed_commands",
    "travel_plans",
  ]) {
    assert.doesNotMatch(
      migration,
      new RegExp(`on public\\.${table} for (insert|update|delete)`, "i"),
      `${table} must not accept direct authenticated writes`,
    );
  }
});

test("keeps travel private by default and protects cost at the database edge", async () => {
  const migration = await readFile(
    new URL("../migrations/0040_cheerful_blacklash.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /visibility.*set default 'private'/i);
  assert.match(migration, /visibility.*'basic'.*where.*'group'/is);
  assert.match(migration, /add column "total_cents" integer/i);
  assert.match(migration, /travel_plans_visibility_check/i);
  assert.match(migration, /people\.auth_user_id = auth\.uid\(\)/i);
  assert.match(migration, /travel_plans\.person_id, travel_plans\.companion_person_id/i);
  assert.doesNotMatch(migration, /on public\.travel_plans for (insert|update|delete)/i);
});

test("stores confirmation PDFs in an owner-only table behind server writes", async () => {
  const migration = await readFile(
    new URL("../migrations/0041_loving_killmonger.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table "confirmation_documents"/i);
  assert.match(migration, /confirmation_documents_pdf_only/i);
  assert.match(migration, /alter table public\.confirmation_documents enable row level security/i);
  assert.match(migration, /people\.auth_user_id = \(select auth\.uid\(\)\)/i);
  assert.match(migration, /memberships\.status = 'active'/i);
  assert.doesNotMatch(migration, /on public\.confirmation_documents for (insert|update|delete)/i);
});

test("limits disposable database reset to an explicit local-only CI path", async () => {
  const source = await readFile(new URL("./test-database-bootstrap.ts", import.meta.url), "utf8");
  assert.match(source, /COMMONS_RESET_TEST_DATABASE === "true"/);
  assert.match(source, /127\.0\.0\.1.*localhost.*::1/);
  assert.match(source, /Refusing to reset a database that is not local/);
  assert.match(source, /DROP SCHEMA IF EXISTS public CASCADE/);
});

test("protects invitations with member-only reads and server-only writes", async () => {
  const migration = await readFile(
    new URL("../migrations/0003_brainy_nightshade.sql", import.meta.url),
    "utf8",
  );

  assert.match(
    migration,
    /alter table public\.invitations enable row level security;/i,
  );
  assert.match(migration, /using \(public\.is_commons_member\(commons_id\)\)/i);
  assert.doesNotMatch(
    migration,
    /on public\.invitations for (insert|update|delete)/i,
  );
});

test("protects the expense ledger with member-only reads and server-only writes", async () => {
  const migration = await readFile(
    new URL("../migrations/0004_aspiring_captain_flint.sql", import.meta.url),
    "utf8",
  );

  for (const table of ["expenses", "expense_shares", "reimbursements"]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security;`, "i"),
    );
    assert.doesNotMatch(
      migration,
      new RegExp(`on public\\.${table} for (insert|update|delete)`, "i"),
    );
  }
  assert.match(migration, /expenses_select_members/i);
  assert.match(migration, /expense_shares_select_members/i);
  assert.match(migration, /reimbursements_select_members/i);
});

test("keeps imported Moments private to active Commons members", async () => {
  const migration = await readFile(
    new URL("../migrations/0005_jittery_hellion.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /alter table public\.moments enable row level security;/i);
  assert.match(migration, /moments_select_members/i);
  assert.doesNotMatch(migration, /on public\.moments for (insert|update|delete)/i);
  assert.match(migration, /'commons-moments',[\s\S]*false/i);
  assert.match(migration, /commons_moments_storage_select_members/i);
  assert.match(migration, /public\.is_commons_member\(target_commons\.id\)/i);
});

test("matches Moment storage paths against the object name, not the Commons name", async () => {
  const migration = await readFile(
    new URL("../migrations/0007_storage_moments_policy_fix.sql", import.meta.url),
    "utf8",
  );

  assert.match(
    migration,
    /storage\.foldername\(storage\.objects\.name\)/i,
  );
  assert.doesNotMatch(
    migration,
    /storage\.foldername\(target_commons\.name\)/i,
  );
});

test("persists whether a photo has a confirmed trip day", async () => {
  const migration = await readFile(
    new URL("../migrations/0009_flawless_anita_blake.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /add column "date_status" text default 'confirmed' not null/i);
});

test("connects plan estimates to recorded expenses", async () => {
  const migration = await readFile(
    new URL("../migrations/0025_lethal_ravenous.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /itinerary_items.*expected_cost_cents/is);
  assert.match(migration, /expenses.*itinerary_item_id/is);
  assert.match(migration, /on delete set null/i);
});

test("stores whether a plan estimate is total or per person", async () => {
  const migration = await readFile(
    new URL("../migrations/0026_tidy_ezekiel_stane.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /itinerary_items.*expected_cost_basis/is);
  assert.match(migration, /default 'total' not null/i);
});

test("makes trip invitations durable and restores recoverable legacy links", async () => {
  const migration = await readFile(
    new URL("../migrations/0034_durable_trip_invitations.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /invitations.*expires_at.*drop not null/is);
  assert.match(migration, /set "expires_at" = null/is);
  assert.match(migration, /status.*expired.*token_value.*pending/is);
});

test("persists plan notes and lets active members store trip photos", async () => {
  const migration = await readFile(
    new URL("../migrations/0010_great_toad_men.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /itinerary_items" add column "note" text/i);
  assert.match(migration, /commons_moments_storage_insert_members/i);
  assert.match(migration, /commons_moments_storage_delete_members/i);
  assert.match(migration, /public\.is_commons_member\(target_commons\.id\)/i);
});

test("applies the approved Hawaiifest content updates without requiring seed data", async () => {
  const migration = await readFile(
    new URL("../migrations/0011_hawaiifest_persistence_polish.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /Road to Hanekamp’s loop/);
  assert.match(migration, /Thanks for getting money settled Mike, I''m paying now/);
  assert.match(migration, /Marked settled by the organizer/);
  assert.match(migration, /WHERE EXISTS \(/);
});

test("accepts original trip photos up to 50 MB", async () => {
  const migration = await readFile(
    new URL("../migrations/0012_larger_commons_photos.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /commons-moments/);
  assert.match(migration, /file_size_limit = 52428800/);
});

test("stores cover originals and lightweight card derivatives outside Moments", async () => {
  const migration = await readFile(
    new URL("../migrations/0038_acoustic_vargas.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /cover_original_storage_path/i);
  assert.match(migration, /cover_card_storage_path/i);
  assert.match(migration, /cover_card_image_url/i);
  assert.match(migration, /cover_source_moment_id/i);
});

test("allows a Commons to exist before destination or dates are decided", async () => {
  const migration = await readFile(
    new URL("../migrations/0013_small_star_brand.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /commons.*starts_on.*drop not null/is);
  assert.match(migration, /commons.*ends_on.*drop not null/is);
});

test("persists resumable setup and invitation delivery state", async () => {
  const migration = await readFile(
    new URL("../migrations/0014_curly_terror.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /commons.*setup_completed_at/is);
  assert.match(migration, /commons.*first_shared_at/is);
  assert.match(migration, /invitations.*recipient_email/is);
  assert.match(migration, /invitations.*delivery_state.*not_sent/is);
  assert.match(migration, /invitations.*delivery_error_code/is);
  assert.match(migration, /update "commons"[\s\S]*setup_completed_at[\s\S]*created_at/i);
});

test("keeps invitation links recoverable and delivery retryable", async () => {
  const migration = await readFile(
    new URL("../migrations/0015_superb_leper_queen.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /invitations.*token_value/is);
  assert.match(migration, /invitations.*token_version/is);
  assert.match(migration, /create table "invitation_delivery_attempts"/i);
  assert.match(migration, /invitation_delivery_attempts_ready_idx/i);
  assert.match(migration, /enable row level security/i);
  assert.doesNotMatch(
    migration,
    /on public\.invitation_delivery_attempts for (insert|update|delete)/i,
  );
});

test("keeps poll definitions and guest ballots behind server routes", async () => {
  const migration = await readFile(
    new URL("../migrations/0028_lucky_aqueduct.sql", import.meta.url),
    "utf8",
  );
  for (const table of ["polls", "poll_responses"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`, "i"));
    assert.doesNotMatch(migration, new RegExp(`on public\\.${table} for (select|insert|update|delete)`, "i"));
  }
  assert.match(migration, /poll_responses_receipt_token_unique/i);
  assert.match(migration, /polls_share_token_hash_unique/i);
});

test("preserves short public poll IDs already introduced in production", async () => {
  const migration = await readFile(
    new URL("../migrations/0030_melodic_swordsman.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /polls.*public_id.*varchar\(12\).*gen_random_uuid/is);
  assert.match(migration, /polls_public_id_unique/i);
  assert.match(migration, /polls_public_id_format_check/i);
  assert.doesNotMatch(migration, /drop column.*share_token/i);
});

test("reconciles production-only security state in fresh databases", async () => {
  const migration = await readFile(
    new URL("../migrations/0031_reconcile-production-security.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /event_creation_draft_people_person_idx/i);
  assert.match(migration, /conversation_digest_deliveries enable row level security/i);
});

test("keeps durable digest activity behind server-owned delivery work", async () => {
  const migration = await readFile(
    new URL("../migrations/0036_adorable_vindicator.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /create table "conversation_digest_items"/i);
  assert.match(migration, /conversation_digest_item_source_unique/i);
  assert.match(migration, /conversation_digest_items enable row level security/i);
  assert.doesNotMatch(
    migration,
    /on public\.conversation_digest_items for (select|insert|update|delete)/i,
  );
});

test("adds a backward-compatible daily email preference", async () => {
  const migration = await readFile(
    new URL("../migrations/0037_lean_scarlet_witch.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /traveler_profiles.*daily_digest_enabled.*boolean.*default true.*not null/is);
});

test("adds private traveler preferences with a supplier for every field", async () => {
  const migration = await readFile(
    new URL("../migrations/0042_petite_ultron.sql", import.meta.url),
    "utf8",
  );
  for (const field of ["usual_origin", "dietary_preferences", "accessibility_needs", "lodging_preferences", "transportation_preferences"]) {
    assert.match(migration, new RegExp(`${field}.*supplied_by_person_id`, "is"));
  }
  assert.match(migration, /on delete set null/i);
});

test("allows rental plans to omit an unknown pick-up time", async () => {
  const migration = await readFile(
    new URL("../migrations/0046_keen_sphinx.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /travel_plans.*time.*drop not null/is);
});

test("adds organizer-only stable goal threads without exposing legacy private turns", async () => {
  const migration = await readFile(new URL("../migrations/0070_slow_wallop.sql", import.meta.url), "utf8");
  for (const table of ["coordinator_threads", "coordinator_research_runs", "coordinator_thread_ideas"]) {
    assert.match(migration, new RegExp(`create table "${table}"`, "i"));
    assert.match(migration, new RegExp(`${table}" enable row level security`, "i"));
    assert.match(migration, new RegExp(`revoke all on table "${table}" from public, anon, authenticated`, "i"));
  }
  assert.match(migration, /coordinator_turns.*add column "thread_id"/i);
  assert.match(migration, /poll_drafts.*add column "thread_id"/i);
  assert.match(migration, /polls.*add column "thread_id"/i);
  assert.doesNotMatch(migration, /update\s+"?coordinator_turns"?/i, "legacy private turns must never be backfilled into shared goal threads");
});

test("retains every reviewed release contract without rewriting immutable migrations", async () => {
  const { RELEASE_SCHEMA_FINGERPRINTS } = await import("./release-schemas");
  assert.match(RELEASE_SCHEMA_FINGERPRINTS[1788467491759]!, /^[a-f0-9]{64}$/);
  assert.match(RELEASE_SCHEMA_FINGERPRINTS[1788581466361]!, /^[a-f0-9]{64}$/);
  assert.notEqual(RELEASE_SCHEMA_FINGERPRINTS[1788467491759], RELEASE_SCHEMA_FINGERPRINTS[1788581466361]);
  const journal = JSON.parse(await readFile(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { when: number }[] };
  for (const migration of journal.entries.filter(entry => entry.when >= 1788303736553)) {
    assert.match(RELEASE_SCHEMA_FINGERPRINTS[migration.when] ?? "", /^[a-f0-9]{64}$/, "Register a reviewed fingerprint for every migration before pushing CI");
  }
});

test("keeps pilot access and operator audit mutations server-only", async () => {
  const migration = await readFile(new URL("../migrations/0019_jazzy_satana.sql", import.meta.url), "utf8");
  assert.match(migration, /event_creation_access_select_owner/i);
  assert.match(migration, /person_id = public\.current_person_id\(\)/i);
  for (const table of ["event_creation_access", "operator_audit_events"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.doesNotMatch(migration, new RegExp(`on public\\.${table} for (insert|update|delete)`, "i"));
  }
});

test("persists individual expense confirmations separately from organizer closure", async () => {
  const migration = await readFile(
    new URL("../migrations/0017_cuddly_sandman.sql", import.meta.url),
    "utf8",
  );

  assert.match(migration, /memberships.*expenses_complete_at/is);
  assert.match(migration, /commons.*expenses_closed_at/is);
  assert.match(migration, /expenses_closed_by_person_id/is);
});

test("keeps event creation drafts private and server-written", async () => {
  const migration = await readFile(
    new URL("../migrations/0018_redundant_gamora.sql", import.meta.url),
    "utf8",
  );

  for (const table of ["event_creation_drafts", "event_creation_draft_people"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.doesNotMatch(migration, new RegExp(`on public\\.${table} for (insert|update|delete)`, "i"));
  }
  assert.match(migration, /event_creation_drafts_select_owner/i);
  assert.match(migration, /created_by_person_id = public\.current_person_id\(\)/i);
  assert.match(migration, /commons.*event_type_key/is);
  assert.match(migration, /commons.*event_brief/is);
});

test("durable research tasks and attempts remain server-only", async () => {
  const migration = await readFile(new URL("../migrations/0072_nappy_echo.sql", import.meta.url), "utf8");
  assert.match(migration, /ALTER TABLE "research_tasks" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE "research_attempts" ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public.research_tasks, public.research_attempts FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /research_tasks_event_command_unique/);
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|CREATE POLICY|GRANT /i);
});
