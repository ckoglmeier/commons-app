import assert from "node:assert/strict";
import test from "node:test";
import { researchReadIsCurrent } from "./research-workspace-read";

test("a completed read remains usable while a newer read is pending, but never overwrites newer applied data or another request", () => {
  assert.equal(researchReadIsCurrent("goal:A", "goal:A", 1, 0), true);
  assert.equal(researchReadIsCurrent("goal:A", "goal:A", 2, 1), true);
  assert.equal(researchReadIsCurrent("goal:A", "goal:A", 1, 2), false);
  assert.equal(researchReadIsCurrent("goal:A", "goal:A", 2, 2), false);
  assert.equal(researchReadIsCurrent("command:A", "command:B", 3, 2), false);
});
