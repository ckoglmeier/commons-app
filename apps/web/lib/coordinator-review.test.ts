import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CreatePollRequestSchema, PollCommunicationSchema, PollWorkingDataSchema } from "@commons/contracts";
import { applyReviewReply } from "./coordinator-review";
import { pollCommunicationHtml, pollCommunicationText } from "./poll-communication";
import { renderPollEmail } from "./email/poll-email";

const message = { heading: "Choose our hotel", paragraphs: ["Two nights, $800 total. Not held or booked."], links: [{ label: "Hotel website", url: "https://example.com/hotel" }] };
const question = { id: randomUUID(), kind: "choice", prompt: "Which works?", selectionMode: "multiple", options: [{ id: randomUUID(), label: "Inn" }, { id: randomUUID(), label: "Neither", exclusive: true }] };
const data = () => PollWorkingDataSchema.parse({ title: "Where to stay", intro: "Choose the hotel", communication: message, questions: [question], ballotMode: "transparent", audience: { personIds: [], guestEmails: ["qa@example.test"] } });
const reply = { reply: "I shortened the introduction.", title: null, intro: "Pick our hotel.", message: null, edits: [] };

test("conversation updates a draft, preserves audience/evidence, and retains an undo checkpoint", () => {
  const before = data();
  const after = applyReviewReply(before, reply, "Shorten it", new Date().toISOString());
  assert.equal(after.intro, "Pick our hotel.");
  assert.deepEqual(after.audience, before.audience);
  assert.deepEqual(after.questions, before.questions);
  assert.equal(after.review?.previous?.intro, before.intro);
  assert.equal(after.review?.messages.length, 2);
  assert.equal(before.review, undefined);
});
test("a question-only reply leaves content and the existing undo checkpoint untouched", () => {
  const before = applyReviewReply(data(), reply, "Shorten it", new Date().toISOString());
  const after = applyReviewReply(before, { ...reply, intro: null, reply: "Nothing is booked." }, "Have we booked?", new Date().toISOString());
  assert.deepEqual(after.review?.previous, before.review?.previous);
  assert.equal(after.review?.lastChange, "Answered your question. The draft is unchanged.");
});
test("a draft can omit its delivery note and add one later without inventing sources", () => {
  const before = PollWorkingDataSchema.parse({ ...data(), communication: undefined });
  const after = applyReviewReply(before, { ...reply, message: { heading: "A quick note", paragraphs: ["Please vote by Friday."], links: [] } }, "Add a note", new Date().toISOString());
  assert.equal(after.communication?.heading, "A quick note");
  assert.deepEqual(after.communication?.links, []);
});
test("invalid AI edits, new prices, invented sources and extra authority are rejected", () => {
  assert.throws(() => applyReviewReply(data(), { ...reply, edits: [{ id: randomUUID(), field: "prompt", value: "Hi" }] }, "edit", new Date().toISOString()));
  assert.throws(() => applyReviewReply(data(), { ...reply, message: { ...message, paragraphs: ["Only $700!"] } }, "edit", new Date().toISOString()));
  assert.throws(() => applyReviewReply(data(), { ...reply, message: { ...message, links: [{ label: "New", url: "https://new.example" }] } }, "edit", new Date().toISOString()));
  assert.throws(() => applyReviewReply(data(), { ...reply, send: true }, "send", new Date().toISOString()));
});
test("shared communication is escaped, rejects executable URLs, and is reused in email", () => {
  const malicious = { ...message, paragraphs: ['<img src=x onerror="alert(1)"> & friends'] };
  assert.match(pollCommunicationHtml(malicious), /&lt;img/);
  assert.doesNotMatch(pollCommunicationHtml(malicious), /<img/);
  assert.throws(() => PollCommunicationSchema.parse({ ...message, links: [{ label: "x", url: "javascript:alert(1)" }] }));
  const email = renderPollEmail("https://www.commons.travel", "abcdef123456", { title: data().title, intro: data().intro, questions: data().questions, communication: message });
  assert.ok(email.html.includes(pollCommunicationHtml(message)));
  assert.ok(email.text.includes(pollCommunicationText(message)));
  assert.doesNotMatch(email.html, /Shorten it|private conversation/);
});
test("a communication cannot publish without a saved version and exact recipient approval", () => {
  const input = { ...data(), commandId: randomUUID() };
  assert.equal(CreatePollRequestSchema.safeParse(input).success, false);
  assert.equal(CreatePollRequestSchema.safeParse({ ...input, draftId: randomUUID(), draftVersion: 1, deliveryApproval: { approved: true, fingerprint: "a".repeat(64) } }).success, true);
});
