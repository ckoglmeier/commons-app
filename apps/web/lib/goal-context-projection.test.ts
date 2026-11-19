import test from "node:test";
import assert from "node:assert/strict";
import { boundedGoalContext } from "./goal-context-projection";
test("large task context remains valid JSON and preserves the selected brief and authority", () => {
  const text = boundedGoalContext({ goal: { title: "Transport", brief: "OAK Thursday–Saturday. Nine travelers.", revision: 4, linkedPlanFacts: Array(100).fill({ title: "x".repeat(200) }), outcome: { note: "x".repeat(10000) } }, authority: "No booking authority." }, 5000);
  const value = JSON.parse(text); assert.ok(text.length <= 5000); assert.equal(value.goal.revision, 4); assert.match(value.goal.brief, /OAK/); assert.match(value.authority, /No booking/);
  assert.deepEqual(value.coverage.omitted, ["goal.outcome", "goal.linkedPlanFacts"]);
});
test("main context bounds optional reports, not JSON bytes", () => {
  const text = boundedGoalContext({ tasks: Array(12).fill({ title: "x".repeat(500) }), reports: Array(6).fill({ text: "y".repeat(1000) }), authority: "Stored state is not permission." }, 3000);
  assert.ok(text.length <= 3000); assert.equal(JSON.parse(text).coverage.complete, false); assert.match(JSON.parse(text).authority, /not permission/);
});
