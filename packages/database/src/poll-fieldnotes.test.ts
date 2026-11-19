import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { PollAnswer, PollQuestion } from "@commons/contracts";
import { normalizePollAnswers, pollAnswersForViewer } from "./poll-repository";

const question: PollQuestion = { id: randomUUID(), prompt: "Which stay?", kind: "choice", required: true, selectionMode: "multiple",
  options: [{ id: randomUUID(), label: "Shared house", description: null, exclusive: false },
    { id: randomUUID(), label: "Neither", description: null, exclusive: true }] };
const answer: PollAnswer = { questionId: question.id, optionIds: [question.options[0].id], text: null,
  context: { kind: "need", text: "A step-free bedroom" } };

test("private context survives normalization without being interpreted as agreement", () => {
  assert.deepEqual(normalizePollAnswers([question], [answer]), [answer]);
});
test("members never receive organizer-only context; secret choices never get attributed", () => {
  const member = pollAnswersForViewer([answer], "transparent", false)!;
  assert.equal(member[0].context, undefined);
  assert.deepEqual(member[0].optionIds, answer.optionIds);
  assert.equal(pollAnswersForViewer([answer], "transparent", true)![0].context?.text, answer.context!.text);
  assert.equal(pollAnswersForViewer([answer], "secret", true), null);
  assert.equal(pollAnswersForViewer([answer], "secret", false), null);
  assert.ok(answer.context, "Redaction must not mutate the stored answer");
});
test("server rejects duplicate, unknown, required-empty, and conflicting answers", () => {
  assert.throws(() => normalizePollAnswers([question], [answer, answer]), /only once/);
  assert.throws(() => normalizePollAnswers([question], [{ ...answer, questionId: randomUUID() }]), /no longer available/);
  assert.throws(() => normalizePollAnswers([question], [{ ...answer, optionIds: [] }]), /Answer/);
  assert.throws(() => normalizePollAnswers([question], [{ ...answer, optionIds: question.options.map(option => option.id) }]), /not both/);
});
