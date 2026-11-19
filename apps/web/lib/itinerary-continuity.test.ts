import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ItineraryDraftSchema, invalidateImportedItineraryContent } from "@commons/contracts";
import { syntheticDraft } from "../../../packages/contracts/src/fixtures/research-itinerary";
import { itineraryInstructions, itineraryEvidenceWindow, type ItineraryInstruction } from "./itinerary-continuity";
import { itineraryModelInput, itineraryModelText, ItineraryContextBudgetError, ITINERARY_MODEL_INPUT_BYTES } from "./itinerary-model-input";

test("common imported costs, contacts and booking references are excluded from model payload prose", () => {
  const text = "booking ref: ZXCVBN; cost CAD 500; total: ¥25000; contact fax 555-1234; PNR ABCDEF; guest@example.test";
  const draft = syntheticDraft();
  draft.imports = [{ id: randomUUID(), digest: "a".repeat(64), text, active: true, addedBy: draft.ownerId }];
  draft.content.brief = text;
  const sent = JSON.stringify(itineraryModelInput(text, draft, { instructions: [{ key: "1", text, turnId: null, actorId: null, at: null }] }));
  for (const secret of ["ZXCVBN", "CAD 500", "¥25000", "555-1234", "ABCDEF", "guest@example.test"]) assert.ok(!sent.includes(secret), secret);
  assert.equal(itineraryModelText("Friday 2026-11-06 at 13:12, keep Schramsberg."), "Friday 2026-11-06 at 13:12, keep Schramsberg.");
});

const source = (id: string) => ({ runId: randomUUID(), sourceId: id, title: id, url: `https://example.test/${id}`, excerpt: "synthetic public evidence ".repeat(200).slice(0, 5000), retrievedAt: "2026-10-03T00:00:00.000Z" });
test("110 durable instructions survive while the draft display remains bounded", () => {
  const draft = syntheticDraft(), history: ItineraryInstruction[] = Array.from({ length: 110 }, (_, index) => ({ key: `request:${index}`, text: index ? `Refinement ${index}: leave downtime.` : "Keep Schramsberg; Thursday–Saturday and OAK flights are protected.", turnId: randomUUID(), actorId: draft.ownerId, at: "2026-10-03T00:00:00.000Z" }));
  const instructions = itineraryInstructions(null, history.slice(0, -1), history.at(-1)!);
  draft.corrections = instructions.slice(-30).map(row => row.text);
  ItineraryDraftSchema.parse(draft);
  const model = itineraryModelInput("Less driving", draft, { instructions });
  assert.equal(model.corrections.length, 110); assert.match(model.corrections[0], /Keep Schramsberg/);
  assert.equal(model.correctionSources[0].turnId, history[0].turnId);
});
test("research archive does not accumulate into the draft; old pinned evidence survives a 100-source window", () => {
  const draft = syntheticDraft(), archive = Array.from({ length: 100 }, (_, index) => source(`source-${index}`));
  draft.content.items[0].sources = [{ runId: archive[0].runId, sourceId: archive[0].sourceId }]; draft.content.items[0].evidence = "researched_claim";
  draft.evidence = itineraryEvidenceWindow(draft.content, archive);
  assert.equal(draft.evidence.length, 31); assert.equal(draft.evidence[0].sourceId, "source-0"); assert.equal(draft.evidence.at(-1)!.sourceId, "source-99");
  assert.deepEqual(itineraryEvidenceWindow(draft.content, archive, draft.evidence), draft.evidence, "repeated projection keeps the newest window, rather than rotating backwards");
  ItineraryDraftSchema.parse(draft);
  assert.throws(() => itineraryEvidenceWindow(draft.content, archive.slice(1)), /unavailable/);
});
test("model input is byte-bounded, excerpts report clipping, and essential context is never silently discarded", () => {
  const draft = syntheticDraft(); draft.evidence = Array.from({ length: 30 }, (_, index) => source(`${index}`));
  const input = itineraryModelInput("Keep Thursday–Saturday", draft);
  assert.ok(new TextEncoder().encode(JSON.stringify(input)).byteLength <= ITINERARY_MODEL_INPUT_BYTES);
  assert.equal(input.coverage.excerptsTruncated, true); assert.ok(input.evidence.some(row => row.excerptTruncated));
  assert.deepEqual(input.facts, draft.facts);
  assert.throws(() => itineraryModelInput("x", draft, { historyComplete: false }), ItineraryContextBudgetError);
  draft.imports = Array.from({ length: 8 }, () => ({ id: randomUUID(), digest: "a".repeat(64), text: "語".repeat(12000), active: true, addedBy: draft.ownerId }));
  assert.throws(() => itineraryModelInput("x", draft), ItineraryContextBudgetError);
});
test("the maximum candidate dependency closure retains 150 pins plus 30 discovery sources", () => {
  const draft = syntheticDraft(), archive = Array.from({ length: 180 }, (_, index) => source(`${index}`));
  draft.content.items = Array.from({ length: 30 }, (_, index) => ({ ...draft.content.items[0], id: `candidate-${index}`,
    sources: archive.slice(index * 5, index * 5 + 5).map(({ runId, sourceId }) => ({ runId, sourceId })), evidence: "researched_claim" as const }));
  draft.content.tasks = [];
  draft.evidence = itineraryEvidenceWindow(draft.content, archive);
  assert.equal(draft.evidence.length, 180); ItineraryDraftSchema.parse(draft);
});
test("removing an import invalidates unsaved derived content but not approved records", () => {
  const draft = syntheticDraft(); draft.content.title = "REMOVED_MARKER"; draft.content.brief = "REMOVED_MARKER"; draft.content.items[1].note = "REMOVED_MARKER";
  draft.receipts = [{ candidateId: draft.content.items[0].id, kind: "plan", savedId: randomUUID(), commandId: randomUUID() }];
  const before = structuredClone(draft.content.items[0]); draft.content.items[0].note = "REMOVED_MARKER"; draft.content.items[0].unresolved = ["REMOVED_MARKER"];
  draft.content = invalidateImportedItineraryContent(draft);
  assert.deepEqual(draft.content.items, [{ ...before, note: "", participantNote: null, decision: null, unresolved: [] }]); assert.ok(!JSON.stringify(draft.content).includes("REMOVED_MARKER")); assert.equal(draft.receipts.length, 1);
});


test("withheld private selection cannot masquerade as unselected or disclose the chosen option or note", () => {
 const draft = syntheticDraft();
 const option = (id: string) => ({ id, label: id, fit: "requires_confirmation" as const, keep: false, inPoll: true, note: "PRIVATE_CHOICE_NOTE", sources: [], reasons: [], unknowns: [], price: null, location: null, planItemId: null });
 draft.content.items[0].decision = { question: "Which outing?", options: ["First", "Second"], shortlist: [option("first"), option("second")], chosenOptionId: "first" };
 const chosen = itineraryModelInput("Refine research", draft);
 draft.content.items[0].decision.chosenOptionId = null;
 draft.content.items[0].decision.shortlist![0].note = "DIFFERENT_PRIVATE_NOTE";
 const unselected = itineraryModelInput("Refine research", draft);
 assert.deepEqual(chosen, unselected, "same projection regardless of withheld choice or note");
 assert.equal(chosen.privateDecisionState, "withheld");
 const projected = JSON.parse(JSON.stringify(chosen));
 assert.equal(Object.hasOwn(projected.content.items[0].decision, "chosenOptionId"), false);
 assert.doesNotMatch(JSON.stringify(chosen), /PRIVATE_CHOICE_NOTE|DIFFERENT_PRIVATE_NOTE/);
 assert.equal(chosen.researchExecution, "not_requested");
 assert.equal(itineraryModelInput("Refine research", draft, { researchExecution: "completed" }).researchExecution, "completed");
 assert.equal(itineraryModelInput("Refine research", draft, { researchExecution: "unavailable" }).researchExecution, "unavailable");
});


test("fresh supplier policy excerpts survive historical clipping within the same byte bound", () => {
  const draft = syntheticDraft();
  const history = Array.from({ length: 30 }, (_, index) => source(`old-${index}`));
  const fresh = { ...source("fresh"), excerpt: "official policy ".repeat(250) + "FRESH_GROUP_LIMIT_AND_PRICE" };
  draft.evidence = [...history, fresh];
  draft.researchAssessment = {
    provider: "perplexity", policyVersion: "perplexity-sol-research-v6", requestedModel: "openai/gpt-6.1-sol", observedModel: "openai/gpt-6.1-sol",
    query: "Public supplier policy", searchQueries: ["Public supplier policy"], answer: "Captured public policy", sources: [{ ...fresh, providerResultIds: ["1"], coverage: "snippet", excerptTruncated: false }], citations: [{ sourceId: fresh.sourceId }],
    retrievedAt: fresh.retrievedAt, elapsedMs: 100, usage: { inputTokens: 1, outputTokens: 1, reportedCostUsd: .01 },
  };
  const original = structuredClone(draft);
  const projected = itineraryModelInput("Refresh research", draft, { maxBytes: 26000 });
  assert.ok(new TextEncoder().encode(JSON.stringify(projected)).byteLength <= 26000);
  const current = projected.evidence.find(row => row.sourceId === "fresh")!;
  assert.equal(current.excerpt, fresh.excerpt); assert.equal(current.excerptTruncated, false);
  assert.ok(projected.evidence.filter(row => row.sourceId.startsWith("old-")).every(row => row.excerptTruncated));
  assert.equal(projected.evidence.length, 31, "all historical references remain addressable");
  assert.deepEqual(draft, original, "projection never mutates stored evidence");
});
