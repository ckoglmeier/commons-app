import test from "node:test";
import assert from "node:assert/strict";
import { compareResearchDecision } from "@commons/domain";
import { decisionFixture, decisionSources, sonomaWineryBrief, wineryFixtureExtraction } from "../../../packages/domain/src/research-decision-fixture";
import {
  researchCandidatePrice, researchCandidateSources, researchDecisionEdit, researchDecisionEditChanged,
  researchDecisionEditIsCurrent, researchReferenceAmount, researchSourceHandoff,
  setResearchDecisionNote, setResearchDecisionSelection,
} from "./research-decision-view";
const comparison = () => compareResearchDecision({ brief: sonomaWineryBrief(), sources: decisionSources(), extraction: wineryFixtureExtraction(), comparisonId: decisionFixture.artifact, mode: "fixture" });

test("reference amounts retain currency and cents, including zero", () => {
  assert.equal(researchReferenceAmount(13000, "USD"), "USD 130");
  assert.equal(researchReferenceAmount(123456, "CAD"), "CAD 1,234.56");
  assert.equal(researchReferenceAmount(0, "USD"), "USD 0");
  assert.equal(researchReferenceAmount(Number.MAX_SAFE_INTEGER, "USD"), "USD 90,071,992,547,409.91");
});
test("unknown, unsafe and unsupported amounts do not become prices", () => {
  for (const [cents, currency] of [[null, "USD"], [100, null], [-1, "USD"], [1.5, "USD"], [100, "JPY"], [NaN, "USD"], [Number.MAX_SAFE_INTEGER + 1, "USD"]] as const) assert.equal(researchReferenceAmount(cents, currency), null);
});
test("partial rates are not labeled all-in and unknown completeness suppresses totals", () => {
  const candidate = comparison().candidates.find(item => item.id === "flowers")!;
  assert.deepEqual(researchCandidatePrice(candidate), { amount: "USD 1,170", basis: "Partial reference", perPerson: "USD 130" });
  assert.deepEqual(researchCandidatePrice({ ...candidate, price: { ...candidate.price, completeness: "unknown" } }), { amount: "Price not found", basis: null, perPerson: null });
});
test("outbound source handoffs reject unsafe hosts and credential-like queries", () => {
  for (const url of ["http://example.com", "javascript:alert(1)", "https://user:pass@example.com", "https://127.0.0.1", "https://2130706433", "https://[::1]", "https://a.local", "https://a.internal", "https://example.com:9999", "https://example.com?api_key=secret", "https://example.com?session_token=x", "not a url"]) assert.equal(researchSourceHandoff(url), null, url);
  assert.equal(researchSourceHandoff("https://example.com/tasting?party=9#section"), "https://example.com/tasting?party=9");
});
test("sources are namespaced to the artifact, not a global source id", () => {
  const value = comparison(), candidate = value.candidates.find(item => item.id === "flowers")!;
  const extra = { ...decisionSources()[0], runId: "98000000-0000-4000-8000-000000000009", excerpt: "UNRELATED PRIVATE CONTENT" };
  const shown = researchCandidateSources(value, candidate, [extra, ...decisionSources(), ...decisionSources()]);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].excerpt.includes("UNRELATED"), false);
  assert.equal(shown[0].handoff, null, "fixtures never send users to a vendor");
  assert.deepEqual(researchCandidateSources({ ...value, sourceRefs: [] }, candidate, decisionSources()), []);
});
test("public references offer source handoffs, never a checkout claim", () => {
  const value = comparison(), candidate = value.candidates.find(item => item.id === "flowers")!;
  const sources = researchCandidateSources({ ...value, evidenceMode: "public_reference" }, candidate, decisionSources());
  assert.equal(sources[0].handoff, "https://example.com/synthetic-travel-reference");
  assert.equal(researchCandidateSources({ ...value, evidenceMode: "public_reference" }, candidate, [{ ...decisionSources()[0], url: "https://example.com?token=x" }])[0].handoff, null);
});
test("edits pin stable artifact, comparison revision and context", () => {
  const value = comparison(), edit = researchDecisionEdit(value);
  assert.equal(researchDecisionEditChanged(edit, value), false);
  for (const updated of [{ ...value, revision: 2 }, { ...value, contextRevision: "new" }, { ...value, id: "98000000-0000-4000-8000-000000000007" }]) assert.equal(researchDecisionEditIsCurrent(edit, updated), false);
  edit.selectedIds.push("flowers"); assert.deepEqual(value.selectedIds, []);
});
test("shortlist changes are idempotent and ruled-out options cannot be newly selected", () => {
  const value = comparison(), edit = researchDecisionEdit(value), flowers = value.candidates.find(item => item.id === "flowers")!, ruledOut = value.candidates.find(item => item.id === "schramsberg")!;
  const selected = setResearchDecisionSelection(setResearchDecisionSelection(edit, flowers, true), flowers, true);
  assert.deepEqual(selected.selectedIds, ["flowers"]);
  assert.equal(researchDecisionEditChanged(selected, value), true);
  assert.deepEqual(setResearchDecisionSelection(selected, flowers, false).selectedIds, []);
  assert.equal(setResearchDecisionSelection(edit, ruledOut, true), edit);
  assert.deepEqual(setResearchDecisionSelection({ ...edit, selectedIds: [ruledOut.id] }, ruledOut, false).selectedIds, []);
});
test("old edits refuse amended jobs even if artifact id, revision and context repeat", () => {
  const value = comparison(), edit = researchDecisionEdit(value);
  for (const newer of [{ ...value, taskId: decisionFixture.thread }, { ...value, briefRevision: value.briefRevision + 1 },
    { ...value, threadId: decisionFixture.task }]) assert.equal(researchDecisionEditIsCurrent(edit, newer), false);
});
test("notes update only one candidate, are bounded, and can be removed", () => {
  const value = comparison(), edit = researchDecisionEdit(value);
  const a = setResearchDecisionNote(edit, "flowers", "Less driving please");
  const b = setResearchDecisionNote(a, "hanzell", "Keep our member connection");
  assert.equal(b.notes.length, 2); assert.deepEqual(edit.notes, []);
  const c = setResearchDecisionNote(b, "flowers", "x".repeat(1200));
  assert.equal(c.notes.find(note => note.candidateId === "flowers")?.text.length, 1000);
  assert.equal(setResearchDecisionNote(c, "flowers", "").notes.length, 1);
});
