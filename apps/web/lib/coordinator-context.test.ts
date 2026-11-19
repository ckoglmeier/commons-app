import test from "node:test";
import assert from "node:assert/strict";
import { PollDetailSchema } from "@commons/contracts";
import { coordinatorPollContext, coordinatorRecommendationContext } from "./coordinator-context";

test("earlier polls contribute actual questions and results without credentials or recipient identities", () => {
  const poll = PollDetailSchema.parse({ id: "11000000-0000-4000-8000-000000000001", publicId: "abcdef123456", event: { slug: "trip", name: "Trip" }, title: "Which dates?", intro: null, ballotMode: "transparent", status: "closed", questions: [], createdByName: "Organizer", responseCount: 1, resultsVisible: true, aggregates: [], createdAt: "2026-09-01T12:00:00.000Z", shareToken: "PRIVATE_TOKEN".repeat(4), currentActorRole: "organizer", currentActorCanManage: true, audienceReview: { fingerprint: "private fingerprint", personIds: [], guestEmails: ["recipient@example.test"] }, responses: [{ id: "11000000-0000-4000-8000-000000000002", respondentName: "Private respondent name", answers: [], updatedAt: "2026-09-01T12:00:00.000Z" }] });
  const context = coordinatorPollContext(poll);
  assert.equal(context.title, "Which dates?");
  assert.equal(context.responseCount, 1);
  assert.deepEqual(context.responses[0].answers, []);
  assert.equal(context.decision, null);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE_TOKEN|recipient@example|Private respondent name|private fingerprint/);
  const answer = { questionId: "11000000-0000-4000-8000-000000000003", optionIds: [], text: "Vegetarian meals", context: { kind: "need" as const, text: "Separate bed required" } };
  const withNeeds = { ...poll, responses: [{ ...poll.responses[0], answers: [answer] }] };
  assert.deepEqual(coordinatorPollContext(withNeeds).responses[0].answers, [answer], "permitted text and constraints remain attached to the ballot");
  assert.deepEqual(coordinatorPollContext({ ...withNeeds, ballotMode: "secret" }).responses, [], "secret responses are suppressed even if an upstream caller supplies answers");
  const many = { ...withNeeds, responseCount: 41, responses: Array.from({ length: 41 }, () => withNeeds.responses[0]) };
  assert.equal(coordinatorPollContext(many).responses.length, 40);
  assert.equal(coordinatorPollContext(many).responsesTruncated, true);
  assert.equal(coordinatorPollContext(many).responseCount, 41, "truncation does not misstate total participation");
});

test("prepared recommendations are bounded private context, not operator instructions or authority", () => {
  const context = coordinatorRecommendationContext({ id: "11000000-0000-4000-8000-000000000001", version: 1, sourcePollId: "11000000-0000-4000-8000-000000000002", evidenceFingerprint: "a".repeat(64), preparedBy: "Commons operator", recommendation: "Prefer the earlier window.", freshness: "Prepared today.", uncertainties: ["One reply is missing."], openQuestions: ["Confirm the restaurant."], nextAction: "Review a decision.", evidenceCurrent: false, createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" }, "Dinner timing");
  assert.deepEqual(context, { sourcePoll: "Dinner timing", recommendation: "Prefer the earlier window.", freshness: "Prepared today.", uncertainties: ["One reply is missing."], openQuestions: ["Confirm the restaurant."], nextAction: "Review a decision.", evidenceCurrent: false });
  assert.doesNotMatch(JSON.stringify(context), /11000000|operator/i);
});
