import test from "node:test";
import assert from "node:assert/strict";
import { goalLabel } from "./coordinator-goal-presentation";

test("Goal list and Coordinator share drafting, waiting and terminal labels without changing lifecycle", () => {
  const goal = { lifecycle: "waiting_for_approval" as const, executionBlocked: null,
    planning: { runId: crypto.randomUUID(), stage: "draft" as const, label: "Drafting", nextAction: "Continue the saved draft." } };
  assert.equal(goalLabel(goal), "Drafting");
  assert.equal(goal.lifecycle, "waiting_for_approval", "Presentation cannot complete or approve the Goal");
  assert.equal(goalLabel({ ...goal, planning: { ...goal.planning, stage: "collecting", label: "Waiting on 2 people" } }), "Waiting on 2 people");
  assert.equal(goalLabel({ ...goal, planning: { ...goal.planning, stage: "decide", label: "Answers ready to review" } }), "Answers ready to review");
  assert.equal(goalLabel({ ...goal, lifecycle: "completed" }), "Completed");
  assert.equal(goalLabel({ ...goal, planning: undefined }), "Needs review");
});
