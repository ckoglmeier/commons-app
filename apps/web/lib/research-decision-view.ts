import type { DecisionCandidate, DecisionSource, ResearchDecisionBrief, ResearchDecisionComparison } from "@commons/contracts";

export type ResearchDecisionEdit = {
  comparisonId: string;
  taskId: string;
  threadId: string;
  briefRevision: number;
  expectedRevision: number;
  contextRevision: string;
  selectedIds: string[];
  notes: ResearchDecisionComparison["notes"];
};
export type ResearchDecisionQuestion = Pick<ResearchDecisionEdit, "comparisonId" | "taskId" | "threadId" | "briefRevision" | "expectedRevision" | "contextRevision"> & { question: string };
export type ResearchDecisionScope = Pick<ResearchDecisionBrief, "taskId" | "threadId" | "revision" | "contextRevision" | "kind" | "partySize" | "startsOn" | "endsOn" | "requestedWeekdays" | "legs">;
const sourceKey = (r: { runId: string; sourceId: string }) => `${r.runId}:${r.sourceId}`;

/** Defense in depth for outbound handoffs. The server still owns source capture and authorization. */
export function researchSourceHandoff(raw: string): string | null {
  try {
    const url = new URL(raw), host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || raw.length > 2048
      || host.includes(":") || /^\d+(?:\.\d+){3}$/.test(host) || !host.includes(".")
      || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)
      || [...url.searchParams.keys()].some(key => /token|password|secret|credential|api.?key|signature/i.test(key))) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

/** Never infer currency from a dollar sign, convert currencies, or round an unknown into zero. */
export function researchReferenceAmount(cents: number | null, currency: string | null): string | null {
  if (cents === null || !Number.isSafeInteger(cents) || cents < 0 || !currency
    || !["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF"].includes(currency)) return null;
  const minor = BigInt(cents), fraction = minor % 100n;
  return `${currency} ${new Intl.NumberFormat("en-US").format(minor / 100n)}${fraction ? `.${String(fraction).padStart(2, "0")}` : ""}`;
}

export function researchCandidatePrice(candidate: DecisionCandidate) {
  // A present subtotal with unknown completeness is not a meaningful group total.
  const amount = candidate.price.completeness === "unknown" ? null
    : researchReferenceAmount(candidate.price.subtotalCents, candidate.price.currency);
  return {
    amount: amount ?? "Price not found",
    basis: amount ? candidate.price.completeness === "all_in_reference" ? "Reference total" : "Partial reference" : null,
    perPerson: amount ? researchReferenceAmount(candidate.price.perPersonCents, candidate.price.currency) : null,
  };
}

/** Only already-authorized sources referenced by THIS artifact may reach the renderer. */
export function researchCandidateSources(comparison: ResearchDecisionComparison, candidate: DecisionCandidate, sources: DecisionSource[]) {
  const allowed = new Set(comparison.sourceRefs.map(sourceKey));
  const requested = new Set(candidate.sources.map(sourceKey));
  const seen = new Set<string>();
  return sources.filter(source => {
    const key = sourceKey(source);
    if (!allowed.has(key) || !requested.has(key) || seen.has(key)) return false;
    seen.add(key); return true;
  }).map(source => ({ ...source, handoff: comparison.evidenceMode === "fixture" ? null : researchSourceHandoff(source.url) }));
}

export function researchDecisionPins(comparison: ResearchDecisionComparison) {
  return { comparisonId: comparison.id, taskId: comparison.taskId, threadId: comparison.threadId, briefRevision: comparison.briefRevision,
    expectedRevision: comparison.revision, contextRevision: comparison.contextRevision };
}
export function researchDecisionScopeIsCurrent(scope: ResearchDecisionScope, comparison: ResearchDecisionComparison) {
  return scope.taskId === comparison.taskId && scope.threadId === comparison.threadId && scope.revision === comparison.briefRevision
    && scope.contextRevision === comparison.contextRevision && scope.kind === comparison.kind;
}
export function researchDecisionEditIsCurrent(edit: ResearchDecisionEdit, comparison: ResearchDecisionComparison) {
  const pins = researchDecisionPins(comparison);
  return edit.comparisonId === pins.comparisonId && edit.taskId === pins.taskId && edit.threadId === pins.threadId
    && edit.briefRevision === pins.briefRevision && edit.expectedRevision === pins.expectedRevision && edit.contextRevision === pins.contextRevision;
}
export function researchDecisionEdit(comparison: ResearchDecisionComparison): ResearchDecisionEdit {
  return { ...researchDecisionPins(comparison), selectedIds: [...comparison.selectedIds], notes: comparison.notes.map(note => ({ ...note })) };
}
export function researchDecisionEditChanged(edit: ResearchDecisionEdit, comparison: ResearchDecisionComparison) {
  return !researchDecisionEditIsCurrent(edit, comparison)
    || JSON.stringify(edit.selectedIds) !== JSON.stringify(comparison.selectedIds)
    || JSON.stringify(edit.notes) !== JSON.stringify(comparison.notes);
}

export function setResearchDecisionSelection(edit: ResearchDecisionEdit, candidate: DecisionCandidate, selected: boolean): ResearchDecisionEdit {
  // A ruled-out candidate can be removed from an earlier selection, not newly shortlisted.
  if (selected && candidate.fit === "unsuitable") return edit;
  return { ...edit, selectedIds: selected ? [...new Set([...edit.selectedIds, candidate.id])] : edit.selectedIds.filter(id => id !== candidate.id) };
}
export function setResearchDecisionNote(edit: ResearchDecisionEdit, candidateId: string, text: string): ResearchDecisionEdit {
  return { ...edit, notes: [...edit.notes.filter(note => note.candidateId !== candidateId), ...(text ? [{ candidateId, text: text.slice(0, 1000) }] : [])] };
}
