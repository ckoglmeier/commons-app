import assert from "node:assert/strict";
import test from "node:test";
import { readResearchPending, researchPendingKey } from "./research-workspace-pending";
test("research recovery retains the original body and UUID rather than constructing a replacement", () => {
  const value = { version: 1, body: { commandId: "97000000-0000-4000-8000-000000000001", expectedSourceFingerprint: "a".repeat(64), selection: { party: [] }, request: { title: "Original" } } };
  assert.deepEqual(readResearchPending(JSON.stringify(value)), value); assert.equal(readResearchPending(null), null);
  assert.notEqual(researchPendingKey("trip", "one"), researchPendingKey("trip", "two"));
  for (const bad of ["{}", "null", "not-json", JSON.stringify({ ...value, version: 2 }), "x".repeat(32_001)]) assert.throws(() => readResearchPending(bad));
});
