import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { readSchemaContract, schemaContractFingerprint } from "./schema-contract";
import { runDatabaseMigrations, CANONICAL_SCHEMA_FINGERPRINT } from "./migration-state";
import { bootstrapTestDatabase } from "./test-database-bootstrap";

// Creates two disposable databases. Never restores over the supplied database.
const directUrl = process.env.DATABASE_DIRECT_URL;
if (!directUrl || process.env.COMMONS_RUN_DATABASE_TESTS !== "1") {
  throw new Error("Recovery rehearsal requires an explicitly disposable DATABASE_DIRECT_URL and COMMONS_RUN_DATABASE_TESTS=1.");
}
const execute = promisify(execFile);
const suffix = randomUUID().replaceAll("-", "");
const sourceName = `commons_backup_${suffix}`, restoredName = `commons_restore_${suffix}`;
const sourceUrl = new URL(directUrl); sourceUrl.pathname = `/${sourceName}`;
const restoredUrl = new URL(directUrl); restoredUrl.pathname = `/${restoredName}`;
const options = { max: 1, prepare: false, onnotice: () => {} };
const admin = postgres(directUrl, options);
const source = postgres(sourceUrl.toString(), options), restored = postgres(restoredUrl.toString(), options);
const directory = await mkdtemp(join(tmpdir(), "commons-recovery-"));
const archive = join(directory, "backup.dump");
try {
  await admin.unsafe(`CREATE DATABASE "${sourceName}"`);
  await admin.unsafe(`CREATE DATABASE "${restoredName}"`);
  await bootstrapTestDatabase(sourceUrl.toString());
  await runDatabaseMigrations(source, "./migrations");
  const marker = randomUUID();
  await source`INSERT INTO public.feedback_submissions (id, commons_slug, source, question_version, answers, page_path, idempotency_key)
    VALUES (${marker}, 'restore-test', 'test', 1, '{"sample":"before-backup"}', '/test', ${randomUUID()})`;
  const backupAt = new Date().toISOString();
  // Environment variables keep connection credentials out of process arguments.
  await execute(process.env.PG_DUMP_BIN ?? "pg_dump", ["--format=custom", "--file", archive],
    { env: { ...process.env, PGDATABASE: sourceName, PGHOST: sourceUrl.hostname, PGPORT: sourceUrl.port,
      PGUSER: decodeURIComponent(sourceUrl.username), PGPASSWORD: decodeURIComponent(sourceUrl.password) } });
  await source`UPDATE public.feedback_submissions SET answers = '{"sample":"after-backup"}' WHERE id = ${marker}`;
  const start = performance.now();
  await execute(process.env.PG_RESTORE_BIN ?? "pg_restore", ["--exit-on-error", "--dbname", restoredName, archive],
    { env: { ...process.env, PGHOST: restoredUrl.hostname, PGPORT: restoredUrl.port,
      PGUSER: decodeURIComponent(restoredUrl.username), PGPASSWORD: decodeURIComponent(restoredUrl.password) } });
  assert.equal(schemaContractFingerprint(await readSchemaContract(restored)), CANONICAL_SCHEMA_FINGERPRINT);
  const [row] = await restored`SELECT answers FROM public.feedback_submissions WHERE id = ${marker}`;
  assert.deepEqual(row.answers, { sample: "before-backup" });
  await runDatabaseMigrations(restored, "./migrations");
  console.log(JSON.stringify({ scope: "isolated PostgreSQL schema, security, journal and application row restore",
    backupAt, restoreVerificationMs: Math.round(performance.now() - start),
    verifiedRecoveryPoint: "dump snapshot; later write correctly absent", productionRecoveryVerified: false,
    excluded: ["Supabase Auth service recovery", "Storage object bytes", "managed backup availability"] }));
} finally {
  await source.end(); await restored.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${sourceName}"`);
  await admin.unsafe(`DROP DATABASE IF EXISTS "${restoredName}"`);
  await admin.end(); await rm(directory, { recursive: true, force: true });
}
