import { z } from "zod";
import { publicResearchUrl, RESEARCH_LIMITS, type ResearchProvider } from "./coordinator-research";

const searchResult = z.object({ results: z.array(z.object({ url: z.string(), title: z.string(), content: z.string() })) });
const readResult = z.object({ results: z.array(z.object({ url: z.string(), raw_content: z.string() })) });

/** Fixed transport destinations: never fetch an arbitrary source from the app server. */
export function tavilyLookupConfigured(environment: { TAVILY_API_KEY?: unknown; COMMONS_TAVILY_ACCESS_MODE?: unknown }) {
  return Boolean(String(environment.TAVILY_API_KEY ?? "").trim()) || environment.COMMONS_TAVILY_ACCESS_MODE === "keyless";
}
export function tavilyResearchProvider(apiKey: string | undefined, fetcher: typeof fetch = fetch, accessMode: "api_key" | "keyless" = "api_key"): ResearchProvider {
  if (!apiKey?.trim() && accessMode !== "keyless") throw new Error("Tavily lookup is not configured.");
  async function post(path: "search" | "extract", body: unknown, signal: AbortSignal) {
    const response = await fetcher(`https://api.tavily.com/${path}`, {
      method: "POST", redirect: "error", signal, headers: { ...(apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : { "X-Tavily-Access-Mode": "keyless" }), "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("Research provider unavailable.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Research response missing.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1_000_000) throw new Error("Research response too large.");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  return {
    async search(query, { limit, signal }) {
      const result = searchResult.parse(await post("search", { query, max_results: Math.min(limit, RESEARCH_LIMITS.sources), search_depth: "basic", topic: "general", auto_parameters: false, include_answer: false, include_raw_content: false }, signal));
      return result.results.map(item => ({ url: item.url, title: item.title, excerpt: item.content }));
    },
    async read(urls, { signal }) {
      const safe = urls.map(publicResearchUrl).filter((url): url is string => Boolean(url)).slice(0, RESEARCH_LIMITS.pages);
      if (!safe.length) return [];
      const result = readResult.parse(await post("extract", { urls: safe, extract_depth: "basic", include_images: false, include_favicon: false, format: "text", timeout: 10 }, signal));
      return result.results.map(item => ({ url: item.url, excerpt: item.raw_content }));
    },
  };
}
