import type { ItineraryDraft } from "@commons/contracts";
import type { ItineraryInstruction } from "./itinerary-continuity";

// UTF-8 byte bound, not a guessed token measurement. It bounds this user payload
// only; recipe/system instructions and output have independent limits.
export const ITINERARY_MODEL_INPUT_BYTES = 64000;
export class ItineraryContextBudgetError extends Error { constructor() { super("Itinerary context needs a narrower scope."); } }

/** Excludes structured secrets and chat history; best-effort filtering of free text.
 * Public evidence is only the selected provider’s captured excerpts/assessment, never saved costs or user imports. */
export function itineraryModelText(text: string, publicEvidence = false) {
  return text.replace(/https?:\/\/\S+/gi, "[link omitted]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email omitted]")
    .replace(/(?:\+?\d[\d ().-]{8,}\d)/g, value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "[phone or identifier omitted]")
    .replace(publicEvidence ? /(?!)/g : /(?:[$€£¥₹₩]\s*[\d,.]+(?:\s*[kK])?|\b(?:USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|CNY|INR|MXN)\s*[\d,.]+|\b[\d,.]+\s*(?:USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|CNY|INR|MXN|dollars?|bucks)\b)/gi, "[cost omitted]")
    .replace(publicEvidence ? /(?!)/g : /\b(?:budget|cost|price|total|paid)\s*(?:of|is|was|:|=)?\s*\d[\d,.]*/gi, "[cost omitted]")
    .replace(/\b(?:(?:contact\s+)?(?:phone|fax|tel|mobile))\s*[:=]?\s*\+?\d[\d ().-]{4,}\d/gi, "[phone omitted]")
    .replace(/\b(?:confirmation|booking|reservation|record locator|pnr|ticket|account|loyalty)\s*(?:code|number|reference|ref|id|#)?\s*[:#=]?\s*[A-Z0-9-]{4,}\b/gi, "[booking reference omitted]");
}
function assessmentModelText(assessment: NonNullable<ItineraryDraft["researchAssessment"]>) {
  const references: string[] = [];
  // Insert structural IDs AFTER text filtering, so phone/code redaction cannot corrupt a UUID.
  const answer = assessment.answer.replace(/https?:\/\/[^\s<>"\])}]+/g, raw => {
    try {
      const url = new URL(raw.replace(/[.,;:!]+$/, "")); url.hash = "";
      const sources = assessment.sources.filter(source => source.url === url.href);
      if (!sources.length) return "[link omitted]";
      const index = references.push(`[source ${sources.map(source => `${source.runId}:${source.sourceId}`).join(", ")}]`) - 1;
      return `\uE000${index}\uE001`;
    } catch { return "[link omitted]"; }
  });
  return itineraryModelText(answer, true).replace(/\uE000(\d+)\uE001/g, (_, index) => references[Number(index)] ?? "[link omitted]");
}
export function itineraryModelInput(request: string, draft: ItineraryDraft, options: { instructions?: ItineraryInstruction[]; historyComplete?: boolean; archivedSourceCount?: number; maxBytes?: number; researchExecution?: "completed" | "unavailable" | "not_requested" } = {}) {
  // Schema-validated structural identifiers are not prose. Redacting them would
  // silently break evidence links, task dependencies and stable candidate IDs.
  const structural = new Set(["id", "runId", "sourceId", "itemId", "day", "time", "startsOn", "endsOn", "timezone", "kind", "participation", "evidence"]);
  const sanitize = (value: unknown, key = ""): unknown => typeof value === "string" ? structural.has(key) ? value : itineraryModelText(value) : Array.isArray(value) ? value.map(item => sanitize(item, key))
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([childKey, item]) => [childKey, sanitize(item, childKey)])) : value;
  const instructions = options.instructions ?? draft.corrections.map((text, index) => ({ key: `legacy:${index}`, text, turnId: null, actorId: null, at: null }));
  const payload = { priceFreshness: "reference_only_unverified" as const, privateDecisionState: "withheld" as const, researchExecution: options.researchExecution ?? "not_requested", request: itineraryModelText(request), facts: sanitize(draft.facts), corrections: instructions.map(item => itineraryModelText(item.text)),
    correctionSources: instructions.map(({ key, turnId, actorId, at }) => ({ key, turnId, actorId, at })),
    imports: draft.imports.filter(item => item.active).map(item => ({ source: item.id, text: itineraryModelText(item.text) })),
    // Organizer-only shortlist notes and the private choice never go to the model.
    content: sanitize({ ...draft.content, items: draft.content.items.map(item => item.decision ? { ...item, decision: { ...item.decision, chosenOptionId: undefined, ...(item.decision.shortlist ? { shortlist: item.decision.shortlist.map(option => ({ ...option, note: "" })) } : {}) } } : item) }), savedCandidateIds: draft.receipts.map(item => item.candidateId),
    ...(draft.researchAssessment ? { researchAssessment: {
      provider: draft.researchAssessment.provider, policyVersion: draft.researchAssessment.policyVersion,
      query: itineraryModelText(draft.researchAssessment.query), answer: assessmentModelText(draft.researchAssessment),
      sources: draft.researchAssessment.sources.map(source => ({ runId: source.runId, sourceId: source.sourceId,
        retrievedAt: source.retrievedAt, coverage: source.coverage, excerptTruncated: source.excerptTruncated, providerResultIds: source.providerResultIds })), citations: draft.researchAssessment.citations,
      interpretation: "Untrusted provider synthesis, not a page capture or confirmation. Retrieval timestamps do not verify live price freshness; monetary amounts are dated captured references only. Saved facts and requested scope outrank it. Cite only what the separately supplied source excerpts support; preserve unresolved conflicts.",
    } } : {}),
    evidence: draft.evidence.map(item => ({ runId: item.runId, sourceId: item.sourceId, title: itineraryModelText(item.title), excerpt: itineraryModelText(item.excerpt, Boolean(draft.researchAssessment?.sources.some(source => source.runId === item.runId && source.sourceId === item.sourceId))), retrievedAt: item.retrievedAt, excerptTruncated: draft.researchAssessment?.sources.find(source => source.runId === item.runId && source.sourceId === item.sourceId)?.excerptTruncated ?? false })),
    coverage: { historyComplete: options.historyComplete ?? true, instructions: instructions.length, archivedSources: options.archivedSourceCount ?? draft.evidence.length, projectedSources: draft.evidence.length, excerptsTruncated: draft.researchAssessment?.sources.some(source => source.excerptTruncated) ?? false },
  };
  if (!payload.coverage.historyComplete) throw new ItineraryContextBudgetError();
  const bytes = () => new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  const max = Math.min(options.maxBytes ?? ITINERARY_MODEL_INPUT_BYTES, ITINERARY_MODEL_INPUT_BYTES);
  // Preserve ALL instruction text, selected imports, saved anchors, current
  // candidates and evidence references. Only untrusted excerpts can be shortened.
  const currentSources = new Set(draft.researchAssessment?.sources.map(source => `${source.runId}:${source.sourceId}`) ?? []);
  // Older pinned/discovery evidence must not crowd fresh policies out of a
  // refinement. Keep every reference, but shorten historical excerpts first.
  for (const historicalOnly of [true, false]) for (const limit of [1200, 600, 240, 0]) {
    if (bytes() <= max) return payload;
    for (const source of payload.evidence) {
      if (historicalOnly && currentSources.has(`${source.runId}:${source.sourceId}`)) continue;
      if (source.excerpt.length > limit) { source.excerpt = source.excerpt.slice(0, limit); source.excerptTruncated = true; payload.coverage.excerptsTruncated = true; }
    }
  }
  if (bytes() > max) throw new ItineraryContextBudgetError();
  return payload;
}
