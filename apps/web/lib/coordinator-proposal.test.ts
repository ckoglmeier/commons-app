import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PollWorkingDataSchema } from "@commons/contracts";
import { prepareCoordinatorProposal } from "./coordinator-proposal";

const before = () => PollWorkingDataSchema.parse({ title: "Stay", intro: "", ballotMode: "transparent", communication: { heading: "Choose", paragraphs: ["Not booked"], links: [] }, questions: [{ id: randomUUID(), kind: "choice", prompt: "Where?", selectionMode: "single", options: [{ id: randomUUID(), label: "Inn" }, { id: randomUUID(), label: "Lodge" }] }], audience: { personIds: [], guestEmails: [] } });
const response = (operations: unknown[]) => ({ reply: "Here is a proposal.", title: null, intro: null, message: null, edits: [], operations });
test("supplied prices survive list punctuation without permitting changed amounts or decimal cents", () => {
  const data = before(), id = data.questions[0].id;
  const propose = (description: string, source: string) => prepareCoordinatorProposal(data, response([{ kind: "add_option", questionId: id, option: { label: "Hotel", description } }]), source, new Date().toISOString());
  assert.doesNotThrow(() => propose("$620 per room; $1,120 for a different room; £84.50 per night", "Quotes: $620, two queens; $1,120. £84.50, per night."));
  assert.throws(() => propose("$621 per room", "Quote: $620, two queens"));
  assert.throws(() => propose("£84.51 per night", "Quote: £84.50, per night"));
});
test("prepares structural changes without mutation and retains the ORIGINAL undo checkpoint", () => {
  const data = before();
  const result = prepareCoordinatorProposal(data, response([{ kind: "add_option", questionId: data.questions[0].id, option: { label: "Another inn — unverified", description: null } }]), "Add an option", new Date().toISOString());
  assert.equal(data.questions[0].kind === "choice" && data.questions[0].options.length, 2);
  assert.equal(result.data.questions[0].kind === "choice" && result.data.questions[0].options.length, 3);
  assert.deepEqual(result.data.review?.previous?.questions, data.questions);
  assert.deepEqual(result.data.audience, data.audience);
  assert.deepEqual(result.changes, ["poll questions"]);
});
test("rejects unknown targets, incomplete choices, invented prices and extra authority", () => {
  const data = before();
  const run = (operations: unknown[]) => prepareCoordinatorProposal(data, response(operations), "Edit", new Date().toISOString());
  assert.throws(() => run([{ kind: "remove_question", questionId: randomUUID() }]));
  assert.throws(() => run([{ kind: "remove_question", questionId: data.questions[0].id }]));
  assert.throws(() => run([{ kind: "add_option", questionId: data.questions[0].id, option: { label: "$700 hotel", description: null } }]));
  assert.throws(() => run([{ kind: "publish" }]));
  const question = data.questions[0];
  if (question.kind === "choice") assert.throws(() => run([{ kind: "remove_option", optionId: question.options[0].id }]));
});

test("supplied hotel can be proposed in both questions and message without altering existing choices", () => {
  const data = before();
  const first = data.questions[0];
  if (first.kind !== "choice") throw new Error("fixture");
  first.options.push({ id: randomUUID(), label: "Neither", description: null, exclusive: true });
  data.questions.push({ ...structuredClone(first), id: randomUUID(), selectionMode: "multiple", options: first.options.map(value => ({ ...value, id: randomUUID() })) });
  const url = "https://www.innatsonoma.com/";
  const option = { label: "Inn at Sonoma — King beds only", description: "$978 per room for two nights, or $489 each sharing one king." };
  const raw = { ...response(data.questions.map(question => ({ kind: "add_sourced_option", questionId: question.id, option, url }))),
    message: { ...data.communication!, paragraphs: [...data.communication!.paragraphs, option.description] } };
  raw.operations.push({ kind: "add_message_link", link: { label: "Inn at Sonoma", url } });
  const saved = JSON.stringify(data);
  const result = prepareCoordinatorProposal(data, raw, `Add Inn at Sonoma: $978 per room, $489 sharing a king. ${url}`, new Date().toISOString());
  assert.equal(JSON.stringify(data), saved);
  for (let index = 0; index < 2; index++) {
    const question = result.data.questions[index];
    if (question.kind !== "choice") throw new Error("choice");
    assert.equal(question.options[2].label, option.label);
    assert.equal(question.options[2].url, url);
    assert.equal(question.options[3].label, "Neither");
    assert.deepEqual(question.options.filter(value => value.label !== option.label), (data.questions[index] as typeof first).options);
  }
  assert.deepEqual(result.data.communication?.links, [{ label: "Inn at Sonoma", url }]);
  assert.deepEqual(result.data.review?.previous?.questions, data.questions);
  assert.deepEqual(result.data.audience, data.audience);
  assert.throws(() => prepareCoordinatorProposal(data, raw, "Add a third hotel", new Date().toISOString()));
  assert.throws(() => prepareCoordinatorProposal(data, raw, `Add a third hotel ${url}`, new Date().toISOString()));
});

test("model cannot invent a link or replace reviewed links", () => {
  const data = before();
  const url = "https://example.test/";
  const raw = response([{ kind: "add_message_link", link: { label: "Hotel", url } }]);
  assert.throws(() => prepareCoordinatorProposal(data, raw, "Add the hotel", new Date().toISOString()));
  assert.throws(() => prepareCoordinatorProposal(data, { ...raw, message: { ...data.communication, links: [{ label: "Replacement", url }] } }, `Add ${url}`, new Date().toISOString()));
});

test("workflow questions support exclusive answers, supplied hotel links and optional written responses without authority", () => {
  const data = before(), url = "https://example.test/inn";
  const operation = { kind: "add_workflow_question", prompt: "Which hotels work?", selectionMode: "multiple", options: [{ label: "Inn — $978 per room", description: "King beds only", exclusive: false, url }, { label: "Neither", description: null, exclusive: true, url: null }] };
  const raw = response([operation, { kind: "add_text_question", prompt: "What else?", required: false }]);
  const next = prepareCoordinatorProposal(data, raw, `Use Inn, $978 per room, king beds only. ${url}`, new Date().toISOString()).data;
  assert.equal(next.questions[1].kind, "choice");
  assert.equal(next.questions[1].kind === "choice" && next.questions[1].options[0].url, url);
  assert.equal(next.questions[1].kind === "choice" && next.questions[1].options[1].exclusive, true);
  assert.equal(next.questions[2].kind, "text"); assert.equal(next.questions[2].required, false);
  assert.throws(() => prepareCoordinatorProposal(data, raw, "Add a hotel", new Date().toISOString()));
  assert.throws(() => prepareCoordinatorProposal(data, raw, `Add ${url}`, new Date().toISOString()));
  assert.throws(() => prepareCoordinatorProposal(data, response([{ ...operation, publish: true }]), `Use $978 ${url}`, new Date().toISOString()));
});

test("optional choice construction preserves actual response semantics, not just prompt wording",()=>{
 const before=PollWorkingDataSchema.parse({title:"Trip input",intro:null,questions:[],ballotMode:"transparent"});
 const prepared=prepareCoordinatorProposal(before,{reply:"Proposed questions",title:null,intro:null,message:null,edits:[],operations:[{kind:"add_question",prompt:"Dinner?",selectionMode:"single",options:[{label:"A",description:null},{label:"B",description:null}]},{kind:"add_optional_question",prompt:"Interests?",selectionMode:"multiple",options:[{label:"Yoga",description:null},{label:"Hike",description:null}]},{kind:"add_text_question",prompt:"Anything else?",required:false}]},"Add a dinner question, optional interests, and optional comments",new Date().toISOString());
 assert.deepEqual(prepared.data.questions.map(q=>q.required),[true,false,false]);assert.equal(before.questions.length,0);
});

test("bounded title scope rejects unrelated fields; shorter intro stays shorter and becomes next-turn state", () => {
  const data = before(); data.intro = "Please choose where we should stay together for our upcoming trip.";
  assert.throws(() => prepareCoordinatorProposal(data, { ...response([]), title: "New", intro: "Changed" }, "Change the title only", "2026-10-14T00:00:00Z"), /title-only/);
  assert.throws(() => prepareCoordinatorProposal(data, { ...response([]), intro: data.intro + " Thanks!" }, "Make the intro shorter", "2026-10-14T00:00:00Z"), /shorter/);
  const proposal = prepareCoordinatorProposal(data, { ...response([]), intro: "Choose our stay." }, "Make the intro shorter", "2026-10-14T00:00:00Z");
  assert.equal(data.intro.startsWith("Please"), true);
  const next = prepareCoordinatorProposal(proposal.data, response([]), "What does the introduction say?", "2026-10-14T00:00:00Z");
  assert.equal(next.data.intro, "Choose our stay.");
  assert.deepEqual(next.changes, []);
});
