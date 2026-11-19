import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PollDetailSchema } from "@commons/contracts";
import { PollDecisionReview } from "./poll-decision-review";
import { PollResults } from "./poll-results";

Object.assign(globalThis, { React });

const poll = PollDetailSchema.parse({
  id: "10000000-0000-4000-8000-000000000001", publicId: "123456abcdef",
  event: { slug: "weekend", name: "Mountain weekend" }, title: "Dinner plans",
  intro: null, ballotMode: "transparent", status: "closed", identityBound: true,
  questions: [{ id: "10000000-0000-4000-8000-000000000002", kind: "text", prompt: "What sounds good?" }],
  createdByName: "Pat", responseCount: 0, resultsVisible: true, aggregates: [],
  createdAt: "2026-09-13T12:00:00Z", shareToken: "synthetic-copy-review-token",
  currentActorRole: "organizer", currentActorCanManage: true, responses: [],
  decision: { id: "10000000-0000-4000-8000-000000000003", summary: "Dinner after arrival",
    approvedByName: "Pat", approvedAt: "2026-09-13T12:00:00Z", target: "record", planId: null },
});

test("approved copy leads with the decision while preserving attribution and the sharing boundary", () => {
  const html = renderToStaticMarkup(createElement(PollDecisionReview, { slug: "weekend", poll }));
  assert.match(html, /What was decided/);
  assert.match(html, /Pat.*approved this/);
  assert.match(html, /Saved here for people in this poll/);
  assert.match(html, /Next steps/);
  assert.match(html, /what I share with the whole group/);
  assert.match(html, /Private answers won’t be copied/);
  assert.equal((html.match(/disabled=""/g) ?? []).length, 3, "the audience acknowledgement still gates all three next actions");
  assert.doesNotMatch(html, /reviewed summary|poll audience|review approval|in the editor/);
});

test("plainer decision copy does not grant members organizer next actions", () => {
  const html = renderToStaticMarkup(createElement(PollDecisionReview, { slug: "weekend",
    poll: { ...poll, currentActorRole: "member", currentActorCanManage: false } }));
  assert.match(html, /What was decided/);
  assert.doesNotMatch(html, /Next steps|Update dates|Add stay|Add a plan/);
});

test("decision and results copy still distinguishes human judgment from agreement and attendance", () => {
  const html = renderToStaticMarkup(createElement(PollDecisionReview, { slug: "weekend", poll: { ...poll, decision: null } }));
  assert.match(html, /Make a decision/);
  assert.match(html, /missing answers, ties, conditions, and needs/);
  assert.match(html, /not everyone’s agreement or RSVP/);
  assert.match(html, /Keep it in this poll/);
  assert.match(html, /Add an idea to Plan for everyone/);
  assert.match(html, /disabled=""[^>]*>Review decision/);
  const results = renderToStaticMarkup(createElement(PollResults, { poll }));
  assert.match(results, /Answers aren’t a group decision or an RSVP/);
});
