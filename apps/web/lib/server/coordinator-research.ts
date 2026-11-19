import { isIP } from "node:net";
import { CoordinatorResearchSchema, type CoordinatorResearch, type ResearchSource } from "@commons/contracts";

/** Provider adapters may search/read only. They cannot access trip data or mutate state. */
export interface ResearchProvider {
  search(query: string, options: { limit: number; signal: AbortSignal }): Promise<Array<{ url: string; title: string; excerpt: string }>>;
  read(urls: string[], options: { signal: AbortSignal }): Promise<Array<{ url: string; excerpt: string }>>;
}
export const RESEARCH_LIMITS = Object.freeze({ sources: 5, pages: 3, milliseconds: 20_000, excerptCharacters: 5000 });

export function publicResearchUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || raw.length > 2048
      || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".")
      || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)
      || [...url.searchParams.keys()].some(key => /token|password|secret|credential|api.?key|signature/i.test(key))) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}

// Enforce the deadline even when an adapter ignores AbortSignal. Adapters must
// additionally abort their transport; the interface never authorizes retries.
function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function researchForCoordinator(query: string, provider: ResearchProvider, parent?: AbortSignal, budgetMs: number = RESEARCH_LIMITS.milliseconds, preferredSources: Array<{ url: string; title: string }> = []): Promise<CoordinatorResearch> {
  const normalized = query.trim();
  if (!normalized || normalized.length > 500) throw new Error("Use a search query of 1–500 characters.");
  parent?.throwIfAborted();
  const signal = AbortSignal.any([AbortSignal.timeout(Math.min(budgetMs, RESEARCH_LIMITS.milliseconds)), ...(parent ? [parent] : [])]);
  const sources: ResearchSource[] = [];
  const limitations = ["These sources are not a booking quote or confirmation of availability. Verify dates, occupancy, taxes and cancellation terms with the provider."];
  const preferred = preferredSources.flatMap(source => {
    const url = publicResearchUrl(source.url);
    return url ? [{ ...source, url }] : [];
  }).slice(0, RESEARCH_LIMITS.pages);
  try {
    if (preferred.length) {
      try {
        const pages = await bounded(provider.read(preferred.map(source => source.url), { signal }), signal);
        for (const page of pages) {
          const url = publicResearchUrl(page.url), saved = preferred.find(source => source.url === url);
          if (saved && page.excerpt.trim() && !sources.some(source => source.url === url)) sources.push({ id: `source-${sources.length + 1}`, url: saved.url, title: saved.title.slice(0, 240), excerpt: page.excerpt.slice(0, RESEARCH_LIMITS.excerptCharacters), retrievedAt: new Date().toISOString(), coverage: "page", sourceKind: "web", providerLabel: "Tavily" });
        }
      } catch { parent?.throwIfAborted(); }
    }
    const results = sources.length ? [] : await bounded(provider.search(normalized, { limit: RESEARCH_LIMITS.sources, signal }), signal);
    const seen = new Set<string>();
    for (const result of results) {
      const url = publicResearchUrl(result.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sources.push({ id: `source-${sources.length + 1}`, url, title: result.title.slice(0, 240), excerpt: result.excerpt.slice(0, RESEARCH_LIMITS.excerptCharacters), retrievedAt: new Date().toISOString(), coverage: "snippet", sourceKind: "web", providerLabel: "Tavily" });
      if (sources.length === RESEARCH_LIMITS.sources) break;
    }
    if (sources.some(source => source.coverage === "snippet") && preferred.length < RESEARCH_LIMITS.pages) {
      const urls = sources.filter(source => source.coverage === "snippet").slice(0, RESEARCH_LIMITS.pages - preferred.length).map(source => source.url);
      const pages = await bounded(provider.read(urls, { signal }), signal);
      for (const page of pages) {
        const url = publicResearchUrl(page.url);
        const source = sources.find(item => item.url === url && urls.includes(item.url));
        if (source && page.excerpt.trim()) { source.excerpt = page.excerpt.slice(0, RESEARCH_LIMITS.excerptCharacters); source.coverage = "page"; source.retrievedAt = new Date().toISOString(); }
      }
    }
  } catch {
    parent?.throwIfAborted();
    limitations.push("Research stopped before every page could be read. Missing information remains unverified.");
  }
  parent?.throwIfAborted();
  if (!sources.length) limitations.push("No usable public sources were returned.");
  else if (sources.some(source => source.coverage === "snippet")) limitations.push("Some evidence is search snippets only; the underlying pages were not read.");
  return CoordinatorResearchSchema.parse({ query: normalized, sources, limitations,
    status: !sources.length ? "unavailable" : sources.every(source => source.coverage === "page") ? "complete" : "partial" });
}
