import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { aggregatePollAnswers, PollAnswerSchema, formatPollAnswer, type PollAnswer, type PollQuestion } from "@commons/contracts";
import { normalizePollAnswers } from "./poll-repository";

const options = ["Montreal", "Denver", "Miami"].map(label => ({ id: randomUUID(), label, place: { name: label }, description: null, exclusive: false }));
const interest: PollQuestion = { id: randomUUID(), kind: "option_response", scale: "interest", prompt: "Interest?", required: true, options, convergence: { dimension: "location", measure: "interest" } };
const ranking: PollQuestion = { id: randomUUID(), kind: "ranking", prompt: "Rank?", required: true, options, convergence: { dimension: "location", measure: "preference" } };
const allocation: PollQuestion = { id: randomUUID(), kind: "allocation", totalPoints: 10, prompt: "Points?", required: true, options, convergence: { dimension: "location", measure: "preference" } };
const envelope = (question: PollQuestion, fields: Partial<PollAnswer>): PollAnswer => ({ questionId: question.id, optionIds: [], text: null, ...fields });
const interestAnswer = envelope(interest, { optionResponses: options.map((option, index) => ({ optionId: option.id, value: ["could_go", "top_choice", "abstain"][index] as "could_go" | "top_choice" | "abstain" })) });
const rankingAnswer = envelope(ranking, { rankedOptionIds: options.map(option => option.id).reverse() });
const points = (amounts: number[]) => envelope(allocation, { allocations: options.map((option, index) => ({ optionId: option.id, points: amounts[index] })) });

test("legacy answers remain unchanged; all typed payloads survive JSON parsing and shared normalization", () => {
  const legacy: PollQuestion = { id: randomUUID(), kind: "choice", selectionMode: "single", prompt: "One?", required: true, options };
  const old = { questionId: legacy.id, optionIds: [options[0].id], text: null };
  assert.deepEqual(normalizePollAnswers([legacy], [old]), [old]);
  const questions = [interest, ranking, allocation], answers = [interestAnswer, rankingAnswer, points([3, 7, 0])];
  assert.deepEqual(normalizePollAnswers(questions, JSON.parse(JSON.stringify(answers)).map((answer: unknown) => PollAnswerSchema.parse(answer))), answers);
  assert.match(formatPollAnswer(interest, interestAnswer), /Could go/);
  assert.match(formatPollAnswer(ranking, rankingAnswer), /1\. Miami/);
  assert.match(formatPollAnswer(allocation, answers[2]), /Denver: 7 points/);
});

test("four interest levels and abstention stay distinct; interest never becomes feasibility", () => {
  const values = ["not_interested", "could_go", "interested", "top_choice", "abstain"] as const;
  const responses = values.map(value => ({ answers: [envelope(interest, { optionResponses: options.map(option => ({ optionId: option.id, value })) })] }));
  const aggregate = aggregatePollAnswers(interest, responses);
  assert.deepEqual("optionResponseCounts" in aggregate ? aggregate.optionResponseCounts![options[0].id] : null, { not_interested: 1, could_go: 1, interested: 1, top_choice: 1, abstain: 1 });
  assert.deepEqual(aggregate.optionCounts, {}, "Interest is never a legacy accepted-option count");
  assert.throws(() => normalizePollAnswers([interest], [envelope(interest, { optionResponses: options.map(option => ({ optionId: option.id, value: "no" })) })]), /scale/);
  const availability = { ...interest, scale: "yes_maybe_no" as const, convergence: { dimension: "location" as const, measure: "availability" as const } };
  assert.throws(() => normalizePollAnswers([availability], [interestAnswer]), /scale/);
});

test("wrong-kind payloads, duplicate/foreign IDs and incomplete option responses fail visibly", () => {
  for (const answer of [envelope(interest, { rankedOptionIds: rankingAnswer.rankedOptionIds }), envelope(interest, { ...interestAnswer, optionIds: [options[0].id] }), envelope(interest, { ...interestAnswer, allocations: points([3, 7, 0]).allocations }), envelope(interest, { optionResponses: interestAnswer.optionResponses!.slice(0, 2) }), envelope(interest, { optionResponses: [interestAnswer.optionResponses![0], interestAnswer.optionResponses![0], interestAnswer.optionResponses![2]] }), envelope(interest, { optionResponses: interestAnswer.optionResponses!.map((row, index) => index ? row : { ...row, optionId: randomUUID() }) }), envelope(interest, { abstained: true })]) {
    assert.throws(() => normalizePollAnswers([interest], [answer]));
  }
  assert.throws(() => normalizePollAnswers([ranking], [envelope(ranking, { rankedOptionIds: options.slice(0, 2).map(option => option.id) })]), /every option/);
  assert.throws(() => normalizePollAnswers([ranking], [envelope(ranking, { rankedOptionIds: [options[0].id, options[0].id, options[2].id] })]), /exactly once/);
  assert.throws(() => normalizePollAnswers([ranking], [envelope(ranking, { rankedOptionIds: [] })]), /Answer/);
  assert.throws(() => normalizePollAnswers([ranking], [envelope(ranking, { rankedOptionIds: [randomUUID(), options[1].id, options[2].id] })]), /available/);
});

test("allocation requires integer, in-range points and exact ten; abstention differs from omission", () => {
  for (const amounts of [[3, 6, 0], [3, 8, 0], [0, 0, 0], [-1, 10, 1], [11, 0, 0], [1.5, 7.5, 1]]) assert.throws(() => normalizePollAnswers([allocation], [points(amounts)]));
  assert.deepEqual(normalizePollAnswers([allocation], [points([10, 0, 0])]), [points([10, 0, 0])]);
  for (const question of [ranking, allocation]) {
    const abstained = envelope(question, { abstained: true });
    assert.deepEqual(normalizePollAnswers([question], [abstained]), [abstained]);
    assert.deepEqual(normalizePollAnswers([{ ...question, required: false }], []), []);
    assert.deepEqual(normalizePollAnswers([{ ...question, required: false }], [envelope(question, {})]), []);
    assert.throws(() => normalizePollAnswers([question], [envelope(question, { abstained: true, rankedOptionIds: [] })]), /not both/);
  }
});
