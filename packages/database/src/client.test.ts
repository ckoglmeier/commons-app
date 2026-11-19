import assert from "node:assert/strict";
import test from "node:test";
import { createResourceRegistry, shouldReuseDatabaseClient } from "./client";

test("concurrent serverless acquisitions reuse one bounded resource", async () => {
  let created = 0;
  let closed = 0;
  const registry = createResourceRegistry((key) => ({
    key,
    instance: ++created,
    close: async () => { closed += 1; },
  }));

  const resources = await Promise.all(
    Array.from({ length: 20 }, async () => registry.acquire("production", true)),
  );
  assert.equal(created, 1);
  assert.equal(registry.sharedCount(), 1);
  assert.ok(resources.every((resource) => resource.value === resources[0]?.value));
  await Promise.all(resources.map((resource) => resource.release()));
  assert.equal(closed, 0);
  await registry.closeShared();
  assert.equal(closed, 1);
});

test("scripts and tests retain disposable connection ownership", async () => {
  let closed = 0;
  const registry = createResourceRegistry(() => ({ close: async () => { closed += 1; } }));
  const first = registry.acquire("test", false);
  const second = registry.acquire("test", false);
  assert.notEqual(first.value, second.value);
  await first.release();
  await second.release();
  assert.equal(closed, 2);
});

test("database reuse is explicit to hosted production runtimes", () => {
  assert.equal(shouldReuseDatabaseClient({ NODE_ENV: "test" }), false);
  assert.equal(shouldReuseDatabaseClient({ VERCEL: "1", VERCEL_ENV: "preview" }), true);
  assert.equal(shouldReuseDatabaseClient({ VERCEL_ENV: "production" }), true);
});
