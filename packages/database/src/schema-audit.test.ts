import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

function audit(environment: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, VERCEL_ENV: environment };
  delete env.DATABASE_URL;
  delete env.DATABASE_DIRECT_URL;
  return spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./schema-audit.ts", import.meta.url))], { env, encoding: "utf8" });
}

test("database-free Vercel preview can build without database access", () => {
  const result = audit("preview");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skipping schema audit/);
});

test("production schema audit fails closed without a database", () => {
  const result = audit("production");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DATABASE_DIRECT_URL or DATABASE_URL is required/);
});
