import assert from "node:assert/strict";
import test from "node:test";
import { goalDecisionPrompt } from "./goal-decision-prompt";

const poll = { responseCount: 3 };
const row = (works: boolean) => ({ worksForAllWhoAnswered: works });

test("an inconclusive closed round asks for a decision or a revised round", () => {
  const prompt = goalDecisionPrompt({ stage: "decide", poll, summary: { rows: [row(false), row(false)], respondedCount: 3, awaiting: [] } });
  assert.equal(prompt?.kind, "no_fit");
  assert.match(prompt!.message, /revised round/);
  assert.match(prompt!.message, /don’t carry over/);
});

test("silence is named and never counted as agreement", () => {
  const prompt = goalDecisionPrompt({ stage: "decide", poll, summary: { rows: [row(true)], respondedCount: 3, awaiting: ["Sam"] } });
  assert.equal(prompt?.kind, "silence");
  assert.match(prompt!.message, /Sam/);
  assert.match(prompt!.message, /silence isn’t counted as agreement/);
});

test("a clean fit, no answers, a recorded decision or a replaced round say nothing", () => {
  assert.equal(goalDecisionPrompt({ stage: "decide", poll, summary: { rows: [row(true)], respondedCount: 3, awaiting: [] } }), null);
  assert.equal(goalDecisionPrompt({ stage: "decide", poll: { responseCount: 0 }, summary: { rows: [row(false)], respondedCount: 0 } }), null);
  assert.equal(goalDecisionPrompt({ stage: "decided", poll, outcome: {}, summary: { rows: [row(false)], respondedCount: 3 } }), null);
  assert.equal(goalDecisionPrompt({ stage: "decide", poll: { responseCount: 3, superseded: true }, summary: { rows: [row(false)], respondedCount: 3 } }), null);
  assert.equal(goalDecisionPrompt({ stage: "collecting", poll, summary: { rows: [row(false)], respondedCount: 3 } }), null);
});

test("lodging-style rows without the dates flag compare acceptance with the answer count", () => {
  assert.equal(goalDecisionPrompt({ stage: "decide", poll, summary: { rows: [{ acceptedBy: ["A", "B"] }], respondedCount: 3 } })?.kind, "no_fit");
  assert.equal(goalDecisionPrompt({ stage: "decide", poll, summary: { rows: [{ acceptedBy: ["A", "B", "C"] }], respondedCount: 3 } }), null);
});
