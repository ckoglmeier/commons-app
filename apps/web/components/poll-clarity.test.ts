import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicPollSchema } from "@commons/contracts";
import { PollResponseForm } from "../app/poll/[token]/poll-response-form";
import { PollQuestionSection } from "./poll-question-section";
import { PollHousingFacts } from "./poll-housing-facts";
Object.assign(globalThis, { React });

const poll = PublicPollSchema.parse({ id: "11000000-0000-4000-8000-000000000001", publicId: "abcdef012345", event: { slug: "event", name: "Dinner", coverImageUrl: "/cover.jpg" }, title: "Dinner together", intro: "Find a time, neighborhood, and food style.", ballotMode: "transparent", status: "open", questions: [], createdByName: "Organizer", responseCount: 0, resultsVisible: true, aggregates: [], createdAt: "2026-09-08T00:00:00Z" });

test("a cover suppresses only the duplicate heading, never the poll purpose", () => {
  const html = renderToStaticMarkup(createElement(PollResponseForm, { token: "test", initialPoll: poll, showHeading: false }));
  assert.match(html, /Find a time, neighborhood, and food style/);
  assert.doesNotMatch(html, /<h1>/);
  const full = renderToStaticMarkup(createElement(PollResponseForm, { token: "test", initialPoll: poll }));
  assert.match(full, /<h1>Dinner together<\/h1>/);
});

test("question outlines retain their content and accessible editing controls", () => {
  const html = renderToStaticMarkup(createElement(PollQuestionSection, { id: "food", title: "3. What food?", meta: "2 options · Choose all that work" }, createElement("input", { defaultValue: "Thai" })));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls="question-food"/);
  assert.match(html, /id="question-food" hidden=""/);
  assert.match(html, /value="Thai"/);
});

test("compact housing keeps quote uncertainty visible and provenance inspectable", () => {
  const html = renderToStaticMarkup(createElement(PollHousingFacts, { compact: true, housing: { stage: "quoted", nights: 3, people: 4, rooms: "Two bedrooms", totalCents: 120000, currency: "USD", fees: "unknown", cancellation: "Two week cutoff", checkedOn: "2026-09-08" } }));
  assert.match(html, /Supplied quote · \$1,200.00/);
  assert.ok(html.indexOf("Final total unknown") < html.indexOf("<details"));
  assert.match(html, /checked 2026-09-08/);
  assert.match(html, /Two week cutoff/);
});
