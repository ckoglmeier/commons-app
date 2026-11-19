import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PollWorkspaceHeader } from "./poll-workspace-header";
import { PollQuestionAssistance } from "./poll-question-assistance";
import { PollWorkingDataSchema, CreatePollRequestSchema } from "@commons/contracts";

// The workspace UI package is compiled by Next in production; tsx uses classic JSX there.
Object.assign(globalThis, { React });

test("poll-only navigation does not expose event or management routes", () => {
  const html = renderToStaticMarkup(createElement(PollWorkspaceHeader, { eventName: "An event" }));
  assert.match(html, /Your trips/);
  assert.doesNotMatch(html, /Back to trip|Manage poll|href="\/c\//);
  const member = renderToStaticMarkup(createElement(PollWorkspaceHeader, { eventName: "An event", eventHref: "/c/event", pollsHref: "/c/event/polls" }));
  assert.match(member, /Back to trip/);
  assert.match(member, /href="\/c\/event\/polls"/);
  assert.doesNotMatch(member, /Manage poll/);
});

test("unconfigured suggestions keep manual building available without a provider action", () => {
  const html = renderToStaticMarkup(createElement(PollQuestionAssistance, { slug: "event", revision: "", title: "", defaultTitle: "", intro: "", questions: [], framingRequest: "", onFramingRequest: () => {}, ready: false, available: false, saveDraft: async () => undefined, onApply: async () => "applied" as const }));
  assert.match(html, /isn’t available here yet/);
  assert.doesNotMatch(html, /<button/);
});

test("private drafts accept an undecided audience but publication rejects it", () => {
  const data = { title: "Follow-up", intro: null, ballotMode: "transparent", questions: [], audience: { personIds: [], guestEmails: [] } };
  assert.equal(PollWorkingDataSchema.safeParse(data).success, true);
  const publish = { ...data, commandId: "11000000-0000-4000-8000-000000000001", questions: [{ id: "11000000-0000-4000-8000-000000000002", kind: "text", prompt: "What works?", required: false }] };
  assert.equal(CreatePollRequestSchema.safeParse(publish).success, false);
  assert.equal(CreatePollRequestSchema.safeParse({ ...publish, audience: { personIds: ["11000000-0000-4000-8000-000000000003"], guestEmails: [] } }).success, true);
});

test("an organizer can approve a saved message for link sharing without approving delivery", () => {
  const publish = { commandId: "11000000-0000-4000-8000-000000000001", draftId: "11000000-0000-4000-8000-000000000004", draftVersion: 1,
    title: "Follow-up", intro: null, ballotMode: "transparent", communication: { heading: "Our next step", paragraphs: ["Choose what works."], links: [] },
    questions: [{ id: "11000000-0000-4000-8000-000000000002", kind: "text", prompt: "What works?", required: false }], shareApproval: { approved: true } };
  assert.equal(CreatePollRequestSchema.safeParse(publish).success, true);
  assert.equal(CreatePollRequestSchema.safeParse({ ...publish, audience: { personIds: ["11000000-0000-4000-8000-000000000003"], guestEmails: [] } }).success, false);
  assert.equal(CreatePollRequestSchema.safeParse({ ...publish, deliveryApproval: { approved: true, fingerprint: "a".repeat(64) } }).success, false);
});
