import assert from "node:assert/strict";
import test from "node:test";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { LEGACY_BASELINE_TIMESTAMP, validateMigrationHistory } from "./migration-state";

test("history validation checks early entries and permits only the fixed baseline gap", () => {
  const migrations = readMigrationFiles({ migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  const rows = migrations.map(m => ({ hash: m.hash, created_at: m.folderMillis }));
  assert.equal(validateMigrationHistory(rows, migrations)?.hash, rows.at(-1)?.hash);
  assert.throws(() => validateMigrationHistory([{ ...rows[0], hash: "changed" }, ...rows.slice(1)], migrations), /altered/);
  assert.throws(() => validateMigrationHistory([rows[0], ...rows.slice(2)], migrations), /Missing/);
  assert.throws(() => validateMigrationHistory([rows[0], rows[0]], migrations), /repeated/);
  const baseline = rows.findIndex(row => row.created_at === LEGACY_BASELINE_TIMESTAMP);
  assert.equal(validateMigrationHistory([rows[0], ...rows.slice(baseline)], migrations)?.hash, rows.at(-1)?.hash);
  assert.throws(() => validateMigrationHistory(rows.slice(baseline + 1), migrations), /Missing/);
});
