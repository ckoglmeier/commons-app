import assert from "node:assert/strict";
import test from "node:test";
import { matchesResearchAnswerReceipt, readResearchAnswerPending, researchAnswerKey, transportAnswerDraftSchema } from "./research-answer-pending";
import type { ResearchWorkspaceHistory } from "./server/research-workspace-service";
import { sameTransportAnswers, transportAnswerSummary, unknownTransportAnswers } from "./research-transport-answers";
test("transport answers preserve zero vs unknown and reject malformed counts", () => {
  const value = { drivers: { arrival: 1, wineries: 0, return: 1 }, luggagePieces: null };
  assert.equal(sameTransportAnswers(value, unknownTransportAnswers), false);
  assert.match(transportAnswerSummary(value), /winery day: 0/); assert.match(transportAnswerSummary(value), /Bags for the group: Not sure yet/);
  for (const luggagePieces of [-1, 1.5, 201, "3", NaN]) assert.equal(transportAnswerDraftSchema.safeParse({ ...value, luggagePieces }).success, false);
});
test("answer recovery is scoped to trip, actor, goal, command and exact answers", () => {
  const uuid = (n: number) => `97000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const record = { version: 1 as const, body: { goalId: uuid(1), commandId: uuid(2), expectedRevision: 1,
    expectedReviewCommandId: uuid(3), expectedSourceFingerprint: "a".repeat(64), answers: unknownTransportAnswers } };
  assert.deepEqual(readResearchAnswerPending(JSON.stringify(record)), record);
  for (const raw of ["{}", "null", "bad", "x".repeat(4001)]) assert.throws(() => readResearchAnswerPending(raw));
  const receipt = { goalId: uuid(1), reviewCommandId: uuid(2), transportAnswers: unknownTransportAnswers } as ResearchWorkspaceHistory;
  assert.equal(matchesResearchAnswerReceipt(record, receipt), true);
  for (const patch of [{ goalId: uuid(4) }, { reviewCommandId: uuid(4) }, { transportAnswers: { ...unknownTransportAnswers, luggagePieces: 0 } }])
    assert.equal(matchesResearchAnswerReceipt(record, { ...receipt, ...patch }), false);
  assert.equal(matchesResearchAnswerReceipt(record, null), false);
  const key = researchAnswerKey("trip", "actor", "goal");
  assert.notEqual(key, researchAnswerKey("other", "actor", "goal"));
  assert.notEqual(key, researchAnswerKey("trip", "other", "goal"));
  assert.notEqual(key, researchAnswerKey("trip", "actor", "other"));
});
