import assert from "node:assert/strict";
import test from "node:test";
import { decisionHandoffPath, parseDecisionAction, resolveDecisionHandoff } from "./decision-handoff";
import type { PollDetail } from "@commons/contracts";

const poll = { id: "poll", currentActorRole: "organizer", decision: { id: "decision", summary: "Dinner",
  approvedByName: "Pat", approvedAt: "2026-09-13T12:00:00Z", target: "plan_idea", planId: "existing" } } satisfies Pick<PollDetail, "id" | "decision" | "currentActorRole">;

test("only supported decision actions enter existing editors", () => {
  assert.equal(parseDecisionAction("delete"), null);
  assert.equal(parseDecisionAction("stay"), "stay");
  assert.equal(decisionHandoffPath("event", "poll", "dates"), "/c/event?arrival=0&view=plan&section=travel&decisionPoll=poll&decisionAction=dates");
  assert.ok(!decisionHandoffPath("event", "poll", "plan").includes("Dinner"));
});
test("handoff requires an approved organizer decision and preserves the linked Idea", () => {
  assert.equal(resolveDecisionHandoff({ ...poll, decision: null }, "plan", []), null);
  assert.equal(resolveDecisionHandoff({ ...poll, currentActorRole: "member" }, "dates", []), null);
  assert.equal(resolveDecisionHandoff(poll, "plan", []), null);
  assert.equal(resolveDecisionHandoff(poll, "plan", [{ id: "existing", status: "cancelled" }]), null);
  for (const status of ["idea", "planned", "confirmed"]) {
    assert.equal(resolveDecisionHandoff(poll, "plan", [{ id: "existing", status }])?.planId, "existing");
  }
  assert.equal(resolveDecisionHandoff({ ...poll, decision: { ...poll.decision, target: "record", planId: null } }, "plan", [])?.planId, null);
});
