import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compareResearchDecision } from "@commons/domain";
import { decisionFixture, decisionSources, sonomaWineryBrief, sonomaTransportBrief, wineryFixtureExtraction, transportFixtureExtraction } from "../../../packages/domain/src/research-decision-fixture";
import { ResearchDecisionComparisonView } from "./research-decision-comparison";
const winery = () => { const scope = sonomaWineryBrief(); return { scope, sources: decisionSources(), comparison: compareResearchDecision({ brief: scope, sources: decisionSources(), extraction: wineryFixtureExtraction(), comparisonId: decisionFixture.artifact, mode: "fixture" }) }; };

test("a readable comparison retains all nominees and groups ruled-out options", () => {
  const props = winery(), html = renderToStaticMarkup(createElement(ResearchDecisionComparisonView, props));
  for (const nominee of props.scope.nominated) assert.ok(html.includes(nominee.name));
  assert.match(html, /Doesn’t fit \(1\)/);
  assert.match(html, /Organizers only/); assert.match(html, /Test data/); assert.match(html, /Nothing is booked/);
  assert.doesNotMatch(html, /href=|Book now|Confirm booking|Save shortlist/);
});
test("all transport legs and reference totals remain distinct from booking", () => {
  const scope = sonomaTransportBrief(), comparison = compareResearchDecision({ brief: scope, sources: decisionSources(), extraction: transportFixtureExtraction(scope), comparisonId: decisionFixture.artifact, mode: "fixture" });
  const html = renderToStaticMarkup(createElement(ResearchDecisionComparisonView, { comparison, scope, sources: decisionSources() }));
  assert.equal(html.split("Route coverage: 3 of 3 legs").length - 1, 4);
  assert.match(html, /Capacity and availability still need checking/);
  assert.match(html, /USD 1,450/); assert.match(html, /sober driver/);
});
test("a connected write action still needs an explicit edit before Save", () => {
  const html = renderToStaticMarkup(createElement(ResearchDecisionComparisonView, { ...winery(), canEdit: true, onSave: async () => ({ status: "saved" as const }) }));
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 9);
  assert.match(html, /disabled=""[^>]*>Save shortlist/);
  assert.match(html, /Shortlisting changes this comparison only, not the itinerary/);
  assert.doesNotMatch(html, /<button[^>]*>Share|<button[^>]*>Book/);
});
test("historical context disables edits and cannot ask a current question", () => {
  const html = renderToStaticMarkup(createElement(ResearchDecisionComparisonView, { ...winery(), stale: true, canEdit: true, onSave: async () => ({ status: "saved" as const }), onQuestion: () => {} }));
  assert.match(html, /Trip details changed/); assert.doesNotMatch(html, /Answer in conversation/);
  assert.equal((html.match(/type="checkbox"[^>]*disabled=""/g) ?? []).length, 9);
});
test("a mismatched scope is not presented as the comparison's checked group", () => {
  const props = winery();
  const html = renderToStaticMarkup(createElement(ResearchDecisionComparisonView, { ...props, scope: { ...props.scope, revision: 2, partySize: 37 }, canEdit: true, onSave: async () => ({ status: "saved" as const }), onQuestion: () => {} }));
  assert.match(html, /Trip details changed/); assert.doesNotMatch(html, /37 travelers|Answer in conversation/);
  assert.equal((html.match(/type="checkbox"[^>]*disabled=""/g) ?? []).length, 9);
});
test("question affordance routes to existing conversation, not another composer", () => {
  const html = renderToStaticMarkup(createElement(ResearchDecisionComparisonView, { ...winery(), onQuestion: () => {} }));
  assert.match(html, /Answer in conversation/); assert.doesNotMatch(html, /Send message|Message your coordinator/);
  assert.doesNotMatch(html, /<textarea/);
});
test("source disclosure escapes hostile capture and excludes unreferenced content", () => {
  const props = winery(), source = { ...props.sources[0], title: "<script>alert('vendor')</script>", excerpt: "<img src=x onerror=alert(1)>" };
  const html = renderToStaticMarkup(createElement(ResearchDecisionComparisonView, { ...props, sources: [source, { ...source, sourceId: "private-source", excerpt: "DO NOT SHOW" }] }));
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|<img|DO NOT SHOW/);
  assert.match(html, /Captured page/); assert.match(html, /dateTime="2026-10-03T12:00:00.000Z"/);
});
