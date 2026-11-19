import { PublicResearchAssessmentSchema, type PublicResearchAssessment } from "@commons/contracts";
import { z } from "zod";
import { perplexityResearch, PERPLEXITY_RESEARCH_POLICY } from "./perplexity-research";
import { CoordinatorProviderError } from "./coordinator-errors";

/** Application-executed scopes: at most three sequential requests, twelve bounded search/read
 * actions, one shared 90s deadline and 6,000 total output tokens. No retries or fallback. */
export async function perplexityResearchPlan(query: string, options: Parameters<typeof perplexityResearch>[1]): Promise<PublicResearchAssessment> {
  if (!options.searchQueries?.length) return perplexityResearch(query, options);
  if (!query.trim() || query !== query.trim() || query.length > 500 || !z.string().uuid().safeParse(options.runId).success) throw new CoordinatorProviderError("provider_failed");
  const queries = z.array(z.string().trim().min(1).max(500)).min(1).max(3).parse(options.searchQueries);
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.floor(Math.min(options.timeoutMs ?? 90_000, 90_000)))), ...(options.signal ? [options.signal] : [])]);
  const started = performance.now();
  try {
    const results: PublicResearchAssessment[] = [];
    for (const scope of queries) {
      signal.throwIfAborted();
      results.push(await perplexityResearch(scope, { ...options, searchQueries: undefined, signal, fetchPages: true,
        maxToolCalls: 4, maxOutputTokens: Math.min(PERPLEXITY_RESEARCH_POLICY.maxOutputTokens, Math.floor(6000 / queries.length)) }));
    }
    const groups: string[][] = [];
    const sources: PublicResearchAssessment["sources"] = [], citations = new Set<string>(), answers: string[] = [];
    for (const [index, result] of results.entries()) {
      const ids = new Map<string, string>();
      for (const source of result.sources) {
        let target = sources.find(row => row.url === source.url && row.excerpt === source.excerpt);
        if (!target) {
          if (sources.length >= PERPLEXITY_RESEARCH_POLICY.maxSources) throw new Error("source_limit");
          target = { ...source, runId: options.runId, sourceId: `deep-${sources.length + 1}`, providerResultIds: [] };
          sources.push(target);
        }
        target.providerResultIds.push(...source.providerResultIds.map(id => `${index + 1}:${id}`));
        ids.set(source.sourceId, target.sourceId);
      }
      // Lead each candidate with a captured source actually cited in its
      // answer, rather than a fetched discovery homepage or directory.
      groups.push([...new Set([...result.citations.map(citation => ids.get(citation.sourceId)!), ...ids.values()])]);
      for (const citation of result.citations) { const id = ids.get(citation.sourceId); if (id) citations.add(id); }
      // Provider result IDs are local to a request. Resolve them before combining answers.
      const answer = result.answer.replace(/\[(web|page):(\d+)\]/g, (_, type: string, id: string) => {
        const source = result.sources.find(row => row.providerResultIds.includes(type === "page" ? `page:${id}` : id));
        if (!source) throw new Error("uncaptured_citation");
        return `[source](${source.url})`;
      });
      answers.push(`### Search ${index + 1}: ${queries[index]}\n${answer}`);
    }
    // The five-source reader must include each candidate, rather than five pages for the first.
    const balanced: typeof sources = [];
    for (let offset = 0; offset < Math.max(...groups.map(group => group.length)); offset++) for (const group of groups) {
      const source = sources.find(row => row.sourceId === group[offset]);
      if (source && !balanced.includes(source)) balanced.push(source);
    }
    const sum = (field: keyof PublicResearchAssessment["usage"]) => results.every(row => row.usage[field] !== null)
      ? results.reduce((total, row) => total + row.usage[field]!, 0) : null;
    signal.throwIfAborted();
    return PublicResearchAssessmentSchema.parse({ provider: "perplexity", policyVersion: PERPLEXITY_RESEARCH_POLICY.version,
      requestedModel: PERPLEXITY_RESEARCH_POLICY.model, observedModel: results.every(row => row.observedModel === results[0].observedModel) ? results[0].observedModel : null,
      query, searchQueries: queries, answer: answers.join("\n\n"), sources: balanced, citations: [...citations].map(sourceId => ({ sourceId })),
      retrievedAt: new Date().toISOString(), elapsedMs: performance.now() - started,
      usage: { inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), reportedCostUsd: sum("reportedCostUsd") } });
  } catch (error) {
    if (error instanceof CoordinatorProviderError && error.code === "research_limited") throw error;
    options.signal?.throwIfAborted();
    throw new CoordinatorProviderError("provider_failed");
  } finally { controller.abort(); }
}
