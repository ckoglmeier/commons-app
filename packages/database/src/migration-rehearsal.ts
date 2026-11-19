import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { bootstrapTestDatabase } from "./test-database-bootstrap";
import { LEGACY_BASELINE_TIMESTAMP, prepareMigrationState, rollbackBaselineForRehearsal, runDatabaseMigrations } from "./migration-state";
import { readSchemaContract, schemaContractFingerprint } from "./schema-contract";
import { RELEASE_SCHEMA_FINGERPRINTS } from "./release-schemas";

const directUrl = process.env.DATABASE_DIRECT_URL;
if (!directUrl || process.env.COMMONS_RUN_DATABASE_TESTS !== "1") {
  throw new Error("Migration rehearsal requires DATABASE_DIRECT_URL and COMMONS_RUN_DATABASE_TESTS=1 for a disposable server.");
}
const name = `commons_rehearsal_${randomUUID().replaceAll("-", "")}`;
const url = new URL(directUrl);
url.pathname = `/${name}`;
const admin = postgres(directUrl, { max: 1, prepare: false, onnotice: () => {} });
const options = { max: 1, prepare: false, onnotice: () => {} };
let client: postgres.Sql | undefined;
let second: postgres.Sql | undefined;
const markerId = randomUUID();
const migrations = readMigrationFiles({ migrationsFolder: "./migrations" });
const baseline = migrations.find(m => m.folderMillis === LEGACY_BASELINE_TIMESTAMP)!;

try {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await bootstrapTestDatabase(url.toString());
  client = postgres(url.toString(), options);
  second = postgres(url.toString(), options);
  // Recreate the previous released version, never downgrade the caller's DB.
  await client.begin(async tx => {
    await tx.unsafe("CREATE SCHEMA drizzle");
    await tx.unsafe("CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
    for (const migration of migrations) {
      if (migration.folderMillis > LEGACY_BASELINE_TIMESTAMP) break;
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
    }
  });
  assert.equal(schemaContractFingerprint(await readSchemaContract(client)), RELEASE_SCHEMA_FINGERPRINTS[LEGACY_BASELINE_TIMESTAMP]);
  await client`INSERT INTO public.feedback_submissions (id, commons_slug, source, question_version, answers, page_path, idempotency_key)
    VALUES (${markerId}, 'rehearsal', 'ci', 1, '{}'::jsonb, '/ci/rehearsal', ${randomUUID()})`;
  await rollbackBaselineForRehearsal(client);
  await client.unsafe("CREATE SCHEMA drizzle");
  await client.unsafe("CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
  await client`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migrations[0].hash}, ${migrations[0].folderMillis})`;
  assert.equal(await prepareMigrationState(client, "./migrations"), "baselined");
  const rows = await client`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  assert.deepEqual(rows.map(r => r.hash), [migrations[0].hash, baseline.hash]);
  await rollbackBaselineForRehearsal(client);
  assert.equal(await prepareMigrationState(client, "./migrations"), "baselined");
  // Bring the fixture to the actual 0046 release. Browser ACLs may differ on
  // hosted PostgreSQL; 0047 explicitly replaces them, never policy/function drift.
  await client.begin(async tx => {
    for (const migration of migrations) {
      if (migration.folderMillis <= LEGACY_BASELINE_TIMESTAMP || migration.folderMillis >= 1788581465917) continue;
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`;
    }
  });
  await client.unsafe("GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated");
  await client.unsafe("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated");
  await client.unsafe("ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon, authenticated");
  await client.unsafe("ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon, authenticated");
  await client.unsafe("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated");
  const [sourceFunction] = await client`SELECT pg_get_functiondef('public.is_commons_member(uuid)'::regprocedure) AS definition`;
  await client.unsafe("CREATE OR REPLACE FUNCTION public.is_commons_member(target_commons_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$SELECT true$$");
  await assert.rejects(runDatabaseMigrations(client, "./migrations"), /unknown schema\/security fingerprint/);
  await client.unsafe(sourceFunction.definition);
  // Race two actual connections against the previous released schema.
  await Promise.all([runDatabaseMigrations(client, "./migrations"), runDatabaseMigrations(second, "./migrations")]);
  assert.equal(await runDatabaseMigrations(client, "./migrations"), "journaled");
  const [{ count }] = await client`SELECT count(*)::int AS count FROM public.feedback_submissions WHERE id = ${markerId}`;
  assert.equal(count, 1);
  await client`UPDATE drizzle.__drizzle_migrations SET hash = 'tampered' WHERE created_at = ${baseline.folderMillis}`;
  await assert.rejects(runDatabaseMigrations(client, "./migrations"), /altered migration history/);
  await client`UPDATE drizzle.__drizzle_migrations SET hash = ${baseline.hash} WHERE created_at = ${baseline.folderMillis}`;
  const [original] = await client`SELECT pg_get_functiondef('public.is_commons_member(uuid)'::regprocedure) AS definition`;
  await client.unsafe("CREATE OR REPLACE FUNCTION public.is_commons_member(target_commons_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$SELECT true$$");
  await assert.rejects(runDatabaseMigrations(client, "./migrations"), /unknown schema\/security fingerprint/);
  await client.unsafe(original.definition);
  await runDatabaseMigrations(client, "./migrations");
  await client.unsafe("GRANT SELECT ON public.people TO anon");
  await assert.rejects(runDatabaseMigrations(client, "./migrations"), /unknown schema\/security fingerprint/);
  await client.unsafe("REVOKE SELECT ON public.people FROM anon");
  await runDatabaseMigrations(client, "./migrations");
  console.log("Verified fixed baseline, preserved partial history/rows, previous-release upgrade, concurrent migrators, rerun, tampered journal and authorization-function rejection.");
} finally {
  await second?.end();
  await client?.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`);
  await admin.end();
}
