import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorGoal } from "@commons/contracts";
import { goalEvidenceProjection } from "./goal-evidence-projection";

const outcome: CoordinatorGoal["outcome"] = { kind: "poll", headline: "One saved response", detail: "Evidence only, not trip approval.", sources: [], unknowns: [], receipt: null, retrievedAt: "2026-10-03T12:00:00Z" };

test("matching current goal results remain evidence", () => {
  assert.deepEqual(goalEvidenceProjection({ outcome, outcomeRevision: 1, revision: 1, resultStale: false }), { resultOutdated: false, outcomeRevision: 1, outcome, historicalOutcome: null });
});
test("changed source or amended goal labels preserved outcomes as historical, never current", () => {
  for (const goal of [{ outcome, outcomeRevision: 1, revision: 1, resultStale: true }, { outcome, outcomeRevision: 1, revision: 2, resultStale: false }]) {
    const projection = goalEvidenceProjection(goal);
    assert.equal(projection.resultOutdated, true); assert.equal(projection.outcome, null); assert.deepEqual(projection.historicalOutcome, outcome);
  }
});
test("missing results never invent evidence or history", () => {
  assert.deepEqual(goalEvidenceProjection({ outcome: null, outcomeRevision: null, revision: 1, resultStale: false }), { resultOutdated: false, outcomeRevision: null, outcome: null, historicalOutcome: null });
});
