import assert from "node:assert/strict";
import test from "node:test";
import { feedbackPagePath, SubmitFeedbackRequestSchema, type SubmitFeedbackRequest } from "@commons/contracts";
import { createFeedbackRouteHandler } from "./feedback-route";

const input = {
  commonsSlug: "qa-event", source: "feedback_button", questionVersion: 2,
  answers: { category: "problem", message: "The date field did not save." },
  pagePath: "/c/qa-event?view=logistics&token=private-token#private-fragment",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
};
const request = (body: unknown) => new Request("https://commons.test/api/v1/feedback", { method: "POST", body: JSON.stringify(body) });

test("quick feedback saves a typed message and safe page context, not old survey answers", async () => {
  const saved: SubmitFeedbackRequest[] = [];
  const handler = createFeedbackRouteHandler({ save: async value => { saved.push(value); return { id: value.idempotencyKey }; } });
  for (const category of ["problem", "suggestion"]) {
    const response = await handler(request({ ...input, answers: { category, message: "  A useful note.  " } }));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: input.idempotencyKey });
    assert.equal(saved.at(-1)?.questionVersion, 2);
    assert.equal(saved.at(-1)?.pagePath, "/c/qa-event?view=logistics");
    assert.deepEqual(saved.at(-1)?.answers, { category, message: "A useful note." });
  }
});

test("validation rejects blank/oversized messages, unknown types, and invalid versions", async () => {
  const handler = createFeedbackRouteHandler({ save: async () => { assert.fail("Invalid feedback must not save"); } });
  for (const body of [
    { ...input, answers: { category: "problem", message: "  " } },
    { ...input, answers: { category: "problem", message: "a".repeat(2001) } },
    { ...input, answers: { category: "booking", message: "Do it" } },
    { ...input, questionVersion: 3 },
    { ...input, idempotencyKey: "not-a-uuid" },
  ]) assert.equal((await handler(request(body))).status, 400);
  assert.equal((await handler(new Request("https://commons.test/api/v1/feedback", { method: "POST", body: "not json" }))).status, 400);
});

test("feedback keeps its public anti-bot boundary and bounds streamed request bodies", async () => {
  const handler = createFeedbackRouteHandler({ save: async () => { assert.fail("Must not save"); } });
  assert.equal((await handler(request({ ...input, website: "bot.example" }))).status, 202);
  assert.equal((await handler(request({ ...input, answers: { category: "problem", message: "a".repeat(20_001) } }))).status, 413);
  assert.equal((await handler(new Request("https://commons.test/api/v1/feedback", { method: "POST", headers: { "content-length": "20001" }, body: "{}" }))).status, 413);
});

test("unavailable feedback storage returns a recoverable error without leaking details", async () => {
  const handler = createFeedbackRouteHandler({ save: async () => { throw new Error("database credential and private note"); } });
  const response = await handler(request(input));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Feedback not sent. Your draft is still here. Try again." });
});

test("legacy loaded clients remain compatible without retaining the old form UI", () => {
  assert.equal(SubmitFeedbackRequestSchema.parse({ ...input, questionVersion: 1, answers: {
    firstTrip: "Weekend", biggestHelp: "Planning", trustOrClarity: "Clear", nextCapability: "Notes",
  } }).questionVersion, 1);
});

test("support page context strips tokens, fragments, auth paths, and unrelated query fields", () => {
  assert.equal(feedbackPagePath("/c/qa-event?view=money&entry=secret#token"), "/c/qa-event?view=money");
  assert.equal(feedbackPagePath("/join/secret?entry=proof"), "/join");
  assert.equal(feedbackPagePath("/poll/secret"), "/poll");
  assert.equal(feedbackPagePath("/c/poll/secret?view=home"), "/c/poll");
  assert.equal(feedbackPagePath("/auth/confirm?token_hash=secret"), "/auth");
  assert.equal(feedbackPagePath("/profile?email=private@example.com"), "/profile");
  assert.equal(feedbackPagePath("//elsewhere.example/secret"), "/");
});
