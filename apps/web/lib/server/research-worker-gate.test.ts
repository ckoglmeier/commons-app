import test from "node:test";
import assert from "node:assert/strict";
import { registerComponentImportStubs } from "../test-support/hook-harness";
registerComponentImportStubs();

test("research-off stops the cron worker before database or provider access even with credentials", async () => {
  const values = { NODE_ENV: "development", CRON_SECRET: "synthetic-cron-key", COMMONS_COORDINATOR_RESEARCH_ENABLED: "false", COMMONS_DURABLE_RESEARCH_ENABLED: "true", TAVILY_API_KEY: "synthetic-key", DATABASE_URL: "postgresql://postgres@127.0.0.1:1/no-connection" };
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]])), fetch = globalThis.fetch;
  let calls = 0;
  try {
    Object.assign(process.env, values);
    globalThis.fetch = async () => { calls++; throw new Error("Research must remain offline"); };
    const { GET } = await import("../../app/api/internal/research-tasks/route");
    const result = await GET(new Request("http://localhost/api/internal/research-tasks", { headers: { authorization: "Bearer synthetic-cron-key" } }));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { enabled: false });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = fetch;
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
