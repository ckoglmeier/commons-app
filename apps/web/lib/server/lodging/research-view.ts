import type { CoordinatorResearch, ResearchRun, TurnSourceRef } from "@commons/contracts";

/* How a saved lodging shortlist appears in the existing research panel and source list. Synthetic fixture evidence is always labeled as such. */

export function researchWorkspace(run: ResearchRun): CoordinatorResearch {
  const limitations = [...(run.synthetic ? ["Synthetic fixture evidence: these are not live prices or availability."] : []),
    ...(run.status === "stale" ? ["Saved trip facts or constraints changed after this was researched; ask again before choosing."] : []), ...run.uncertainty].slice(0, 8).map(item => item.slice(0, 500));
  return { query: "Lodging options for the saved dates and shared constraints", status: run.status === "current" ? "complete" : "partial", limitations,
    sources: run.evidence.slice(0, 5).map(item => ({ id: item.id.slice(0, 40), title: item.title, url: item.url, excerpt: item.excerpt, retrievedAt: run.createdAt, coverage: "snippet" as const,
      sourceKind: "travel_provider" as const, providerLabel: run.synthetic ? "Synthetic fixture (not real)" : run.adapter })) };
}

export const researchSources = (run: ResearchRun): TurnSourceRef[] => run.evidence.slice(0, 5).map(item => ({ kind: "research_source" as const, researchRunId: run.runId, sourceId: item.id.slice(0, 40), url: item.url, retrievedAt: run.createdAt }));
