import assert from "node:assert/strict";
import test from "node:test";
import { CreatePollRequestSchema } from "@commons/contracts";
import { housingConceptQuestion, movePollQuestion, newPollOption, newPollQuestion, pollDraftError } from "./poll-builder";
import { matchingPollResponses } from "./poll-combination";
import { pollResponseError, SavedPollResponseSchema } from "./poll-response";

test("one ask supports time, location, and food without collapsing them into one question", () => {
  const questions = ["When?", "Where?", "What food?"].map(prompt => ({ ...newPollQuestion("choice", prompt),
    options: [newPollOption("First possibility"), newPollOption("Second possibility")] }));
  const input = { commandId: crypto.randomUUID(), title: "Dinner together", intro: "Find a workable evening", ballotMode: "transparent", questions };
  assert.equal(pollDraftError(input), null);
  assert.equal(CreatePollRequestSchema.parse(input).questions.length, 3);
  const reordered = movePollQuestion(questions, 2, -1);
  assert.equal(reordered[1].id, questions[2].id);
  assert.equal(questions[1].prompt, "Where?");
});

test("blank and duplicate questions and unsafe links cannot reach a saved poll", () => {
  const base = { commandId: crypto.randomUUID(), title: "Weekend", ballotMode: "transparent" };
  assert.ok(pollDraftError({ ...base, questions: [newPollQuestion()] }));
  const question = housingConceptQuestion();
  assert.ok(pollDraftError({ ...base, questions: [question, question] }));
  if (question.kind !== "choice") throw new Error("Expected choice");
  question.options[0].url = "javascript:alert(1)";
  assert.ok(pollDraftError({ ...base, questions: [question] }));
});

test("housing concepts are illustrative without invented prices or availability", () => {
  const question = housingConceptQuestion();
  assert.equal(question.kind, "choice");
  if (question.kind !== "choice") return;
  assert.equal(question.selectionMode, "multiple");
  assert.equal(question.options.filter(option => option.exclusive).length, 1);
  for (const option of question.options.filter(option => !option.exclusive)) {
    assert.match(option.description!, /Illustrative concept, not a property or quote/);
    assert.equal(option.url, null);
    assert.doesNotMatch(option.label, /\$/);
  }
});

test("housing quotes require real sources and comparable basis without invented illustrative prices", () => {
  const housing = { stage: "illustrative" as const, nights: 3, people: 4, rooms: "Two bedrooms", totalCents: null,
    currency: "USD", fees: "unknown" as const, cancellation: null, checkedOn: null };
  const question = { ...newPollQuestion("choice", "Which stay?"), options: [
    { ...newPollOption("House"), housing }, { ...newPollOption("Hotel"), housing: { ...housing } },
  ] };
  const input = { commandId: crypto.randomUUID(), title: "Compare stays", ballotMode: "transparent", questions: [question] };
  assert.equal(CreatePollRequestSchema.safeParse(input).success, true);
  const changed = (patch: Record<string, unknown>) => ({ ...input, questions: [{ ...question,
    options: [question.options[0], { ...question.options[1], housing: { ...housing, ...patch } }] }] });
  for (const patch of [{ totalCents: 120000 }, { nights: 4 }, { people: 5 }, { currency: "EUR" }, { checkedOn: "2027-02-30" }]) {
    assert.equal(CreatePollRequestSchema.safeParse(changed(patch)).success, false);
  }
  const quotes = { ...input, questions: [{ ...question, options: question.options.map(option => ({ ...option,
    housing: { ...housing, stage: "quoted", totalCents: 120000, checkedOn: "2027-02-28" }, url: "https://example.test/supplied-quote" })) }] };
  assert.equal(CreatePollRequestSchema.safeParse(quotes).success, true);
  assert.equal(CreatePollRequestSchema.safeParse({ ...quotes, questions: [{ ...quotes.questions[0], options: quotes.questions[0].options.map(option => ({ ...option, url: null })) }] }).success, false);
});

test("separate majorities are not a coordinated group answer", () => {
  const questions = [newPollQuestion("choice", "When?"), newPollQuestion("choice", "Where?")];
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const a = { questionId: questions[0].id, optionIds: [first], text: null };
  const b = { questionId: questions[1].id, optionIds: [second], text: null };
  const responses = [{ answers: [a] }, { answers: [b] }, { answers: null }];
  const selections = { [a.questionId]: first, [b.questionId]: second };
  assert.equal(matchingPollResponses(responses, selections).length, 0);
  assert.equal(matchingPollResponses([...responses, { answers: [a, b] }], selections).length, 1);
  assert.equal(matchingPollResponses(responses, {}).length, 0);
});

test("required questions cannot be skipped by entering private context", () => {
  const question = newPollQuestion("choice", "When?");
  assert.equal(pollResponseError([question], [{ questionId: question.id, optionIds: [], text: null,
    context: { kind: "need", text: "After work" } }]), "Answer “When?”.");
});

test("response recovery validates stored ballots and retains text and context", () => {
  assert.equal(SavedPollResponseSchema.safeParse({ answers: "broken" }).success, false);
  const value = { receiptToken: "a".repeat(48), respondentName: "Robin", answers: [{ questionId: crypto.randomUUID(),
    optionIds: [], text: "Saturday", context: { kind: "need", text: "Step-free entrance" } }] };
  assert.deepEqual(SavedPollResponseSchema.parse(value), value);
});
