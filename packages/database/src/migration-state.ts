import { readMigrationFiles } from "drizzle-orm/migrator";
import type postgres from "postgres";
import { legacySchemaContractFingerprint, readSchemaContract, schemaContractFingerprint } from "./schema-contract";
import { RELEASE_SCHEMA_FINGERPRINTS, RELEASE_BEHAVIOR_FINGERPRINTS } from "./release-schemas";

export const LEGACY_BASELINE_TIMESTAMP = 1788303736553;
export const LEGACY_PRODUCTION_SCHEMA_FINGERPRINT = "2b920feb095b141365b18e04052e6455361e782c41446a571d7c7091071ba5c3";
const LEGACY_CANONICAL_FINGERPRINT = "2d9637ab9436b2e1d725410d6c6e6086531c87eace71f41c595d89fe2148854e";
export const CANONICAL_SCHEMA_FINGERPRINT = RELEASE_SCHEMA_FINGERPRINTS[Math.max(...Object.keys(RELEASE_SCHEMA_FINGERPRINTS).map(Number))];

const constraintRenames = [
  ["conversation_digest_deliveries", "conversation_digest_deliveries_recipient_person_id_fkey", "conversation_digest_deliveries_recipient_person_id_people_id_fk"],
  ["event_creation_access", "event_creation_access_decided_by_person_id_fkey", "event_creation_access_decided_by_person_id_people_id_fk"],
  ["event_creation_access", "event_creation_access_person_id_fkey", "event_creation_access_person_id_people_id_fk"],
  ["event_creation_draft_people", "event_creation_draft_people_draft_id_fkey", "event_creation_draft_people_draft_id_event_creation_drafts_id_f"],
  ["event_creation_draft_people", "event_creation_draft_people_person_id_fkey", "event_creation_draft_people_person_id_people_id_fk"],
  ["event_creation_drafts", "event_creation_drafts_committed_event_id_fkey", "event_creation_drafts_committed_event_id_commons_id_fk"],
  ["event_creation_drafts", "event_creation_drafts_created_by_person_id_fkey", "event_creation_drafts_created_by_person_id_people_id_fk"],
  ["event_creation_drafts", "event_creation_drafts_source_event_id_fkey", "event_creation_drafts_source_event_id_commons_id_fk"],
  ["invitation_delivery_attempts", "invitation_delivery_attempts_commons_id_fkey", "invitation_delivery_attempts_commons_id_commons_id_fk"],
  ["invitation_delivery_attempts", "invitation_delivery_attempts_invitation_id_fkey", "invitation_delivery_attempts_invitation_id_invitations_id_fk"],
  ["operator_audit_events", "operator_audit_events_actor_person_id_fkey", "operator_audit_events_actor_person_id_people_id_fk"],
  ["poll_responses", "poll_responses_poll_id_fkey", "poll_responses_poll_id_polls_id_fk"],
  ["poll_responses", "poll_responses_respondent_person_id_fkey", "poll_responses_respondent_person_id_people_id_fk"],
  ["polls", "polls_commons_id_fkey", "polls_commons_id_commons_id_fk"],
  ["polls", "polls_created_by_person_id_fkey", "polls_created_by_person_id_people_id_fk"],
  ["travel_plans", "travel_plans_commons_id_fkey", "travel_plans_commons_id_commons_id_fk"],
  ["travel_plans", "travel_plans_companion_person_id_fkey", "travel_plans_companion_person_id_people_id_fk"],
  ["travel_plans", "travel_plans_person_id_fkey", "travel_plans_person_id_people_id_fk"],
] as const;

type SqlClient = postgres.Sql;
type Migration = ReturnType<typeof readMigrationFiles>[number];

function quotedIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function journalExists(client: SqlClient) {
  const [row] = await client`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS name`;
  return Boolean(row?.name);
}

async function createJournal(client: SqlClient) {
  await client.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.unsafe(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint
  )`);
}

async function renameConstraints(client: SqlClient, direction: "canonical" | "legacy") {
  for (const [table, legacy, canonical] of constraintRenames) {
    await client.unsafe(`ALTER TABLE public.${quotedIdentifier(table)} RENAME CONSTRAINT ${quotedIdentifier(direction === "canonical" ? legacy : canonical)} TO ${quotedIdentifier(direction === "canonical" ? canonical : legacy)}`);
  }
}

export function validateMigrationHistory(
  rows: Array<{ hash: string; created_at: string | number | null }>,
  migrations: Migration[],
) {
  let previous = -1;
  for (const row of rows) {
    const index = migrations.findIndex((migration) => migration.folderMillis === Number(row.created_at));
    if (index < 0 || index <= previous || migrations[index].hash !== row.hash) {
      throw new Error(`Unknown, repeated, or altered migration history at ${row.created_at}.`);
    }
    // The completed legacy baseline may follow a preserved contiguous prefix.
    // Every migration after that fixed baseline must be present in order.
    if (index !== previous + 1 && migrations[index].folderMillis !== LEGACY_BASELINE_TIMESTAMP) {
      throw new Error(`Missing migration history before ${row.created_at}.`);
    }
    previous = index;
  }
  return previous < 0 ? null : migrations[previous];
}

async function recordedMigration(client: SqlClient, migrations: Migration[]) {
  if (!await journalExists(client)) return null;
  const rows = await client<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at
  `;
  return validateMigrationHistory(rows, migrations);
}

async function prepareLocked(client: SqlClient, migrations: Migration[]) {
  const recorded = await recordedMigration(client, migrations);
  const contract = await readSchemaContract(client);
  if (!contract.tables.length) {
    if (recorded) throw new Error("A journaled application schema is missing its tables.");
    return "fresh" as const;
  }
  const actual = schemaContractFingerprint(contract);
  if (recorded && RELEASE_SCHEMA_FINGERPRINTS[recorded.folderMillis] === actual) return "journaled" as const;
  // 0047 deliberately replaces pre-boundary browser grants. The source must
  // still match every reviewed table, policy, function body, owner, and trigger.
  // Only a pending 0047 may consume this allowance; the destination check below
  // includes all access grants and defaults, including on every later rerun.
  const boundary = migrations.find(migration => migration.folderMillis === 1788581465917);
  if (recorded && boundary && recorded.folderMillis < boundary.folderMillis
    && RELEASE_BEHAVIOR_FINGERPRINTS[recorded.folderMillis]
      === schemaContractFingerprint({ ...contract, access: [] })) return "journaled" as const;


  if (legacySchemaContractFingerprint(contract) !== LEGACY_PRODUCTION_SCHEMA_FINGERPRINT) {
    throw new Error(`Refusing migration from unknown schema/security fingerprint ${actual}.`);
  }
  const baseline = migrations.find((migration) => migration.folderMillis === LEGACY_BASELINE_TIMESTAMP);
  if (!baseline || (recorded && recorded.folderMillis >= LEGACY_BASELINE_TIMESTAMP)) {
    throw new Error("The fixed legacy baseline does not match the recorded history.");
  }
  await client.unsafe("CREATE INDEX event_creation_draft_people_person_idx ON public.event_creation_draft_people USING btree (person_id)");
  await renameConstraints(client, "canonical");
  const reconciled = await readSchemaContract(client);
  if (legacySchemaContractFingerprint(reconciled) !== LEGACY_CANONICAL_FINGERPRINT
    || schemaContractFingerprint(reconciled) !== RELEASE_SCHEMA_FINGERPRINTS[LEGACY_BASELINE_TIMESTAMP]) {
    throw new Error("Legacy reconciliation did not produce the reviewed schema/security contract.");
  }
  await createJournal(client);
  await client`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${baseline.hash}, ${baseline.folderMillis})`;
  return "baselined" as const;
}

export async function prepareMigrationState(client: SqlClient, migrationsFolder: string) {
  return client.begin(async (transaction) => {
    const tx = transaction as unknown as SqlClient;
    await tx`SELECT pg_advisory_xact_lock(1129270605, 1)`;
    return prepareLocked(tx, readMigrationFiles({ migrationsFolder }));
  });
}

export async function runDatabaseMigrations(client: SqlClient, migrationsFolder: string) {
  const migrations = readMigrationFiles({ migrationsFolder });
  const latest = migrations.at(-1);
  if (!latest || !RELEASE_SCHEMA_FINGERPRINTS[latest.folderMillis]) {
    throw new Error("Register the reviewed destination schema fingerprint before migrating.");
  }
  // The lock, source check, Drizzle SQL/journal application, and destination
  // check share one transaction, including on a transaction-pooled connection.
  return client.begin(async (transaction) => {
    const tx = transaction as unknown as SqlClient;
    await tx`SELECT pg_advisory_xact_lock(1129270605, 1)`;
    const state = await prepareLocked(tx, migrations);
    const recorded = await recordedMigration(tx, migrations);
    await createJournal(tx);
    for (const migration of migrations) {
      if (recorded && migration.folderMillis <= recorded.folderMillis) continue;
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
    }
    const actual = schemaContractFingerprint(await readSchemaContract(tx));
    if (actual !== RELEASE_SCHEMA_FINGERPRINTS[latest.folderMillis]) {
      throw new Error(`Migration destination differs from its reviewed schema/security contract: ${actual}.`);
    }
    return state;
  });
}

export async function rollbackBaselineForRehearsal(client: SqlClient) {
  await client.begin(async (transaction) => {
    const tx = transaction as unknown as SqlClient;
    await tx`SELECT pg_advisory_xact_lock(1129270605, 1)`;
    const contract = await readSchemaContract(tx);
    if (schemaContractFingerprint(contract) !== RELEASE_SCHEMA_FINGERPRINTS[LEGACY_BASELINE_TIMESTAMP]) {
      throw new Error("Baseline rollback is limited to the fixed 0031 schema.");
    }
    await tx.unsafe("DROP SCHEMA drizzle CASCADE");
    await renameConstraints(tx, "legacy");
    await tx.unsafe("DROP INDEX public.event_creation_draft_people_person_idx");
    if (legacySchemaContractFingerprint(await readSchemaContract(tx)) !== LEGACY_PRODUCTION_SCHEMA_FINGERPRINT) {
      throw new Error("Baseline rollback produced an unexpected schema.");
    }
  });
}
