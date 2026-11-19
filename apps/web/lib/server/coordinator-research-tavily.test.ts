import assert from "node:assert/strict";
import test from "node:test";
import { tavilyResearchProvider } from "./coordinator-research-tavily";
import { researchForCoordinator } from "./coordinator-research";

test("Tavily receives only a public query and bounded public URLs, without private trip context", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const provider = tavilyResearchProvider(" test-only ", async (url, options) => {
    assert.equal(options?.redirect, "error");
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-only");
    requests.push({ url: String(url), body: JSON.parse(options!.body as string) });
    return String(url).endsWith("search") ? Response.json({ results: [{ url: "https://example.com/inn", title: "Inn", content: "A candidate" }, { url: "http://127.0.0.1/private", title: "Unsafe", content: "Ignore" }] }) : Response.json({ results: [{ url: "https://example.com/inn", raw_content: "Public hotel information" }], failed_results: [] });
  });
  const result = await researchForCoordinator("small hotels in Sonoma", provider);
  assert.deepEqual(requests, [
    { url: "https://api.tavily.com/search", body: { query: "small hotels in Sonoma", max_results: 5, search_depth: "basic", topic: "general", auto_parameters: false, include_answer: false, include_raw_content: false } },
    { url: "https://api.tavily.com/extract", body: { urls: ["https://example.com/inn"], extract_depth: "basic", include_images: false, include_favicon: false, format: "text", timeout: 10 } },
  ]);
  assert.equal(result.status, "complete");
  assert.equal(result.sources[0].coverage, "page");
});
test("provider failure, malformed and oversized responses remain unavailable with no retries", async () => {
  for (const response of [new Response("no", { status: 503 }), Response.json({ error: "bad" }), new Response("x".repeat(1_000_001))]) {
    let calls = 0;
    const result = await researchForCoordinator("hotel", tavilyResearchProvider("test", async () => { calls++; return response; }));
    assert.equal(calls, 1); assert.equal(result.status, "unavailable"); assert.equal(result.sources.length, 0);
  }
});

test("explicit keyless Search/Extract omit authorization and retain fixed destinations/limits",async()=>{const paths:string[]=[];const provider=tavilyResearchProvider(undefined,async(url,init)=>{paths.push(String(url));const headers=init?.headers as Record<string,string>;assert.equal(headers.Authorization,undefined);assert.equal(headers["X-Tavily-Access-Mode"],"keyless");return String(url).endsWith("/search")?Response.json({results:[{url:"https://example.com/transfer",title:"Transfer company",content:"Published rate from $200 per vehicle; ask about luggage."}]}):Response.json({results:[{url:"https://example.com/transfer",raw_content:"Published rate from $200 per vehicle; ask about luggage."}]});},"keyless");const result=await researchForCoordinator("airport transfer Sonoma published rates",provider);assert.equal(result.status,"complete");assert.equal(paths.length,2);assert.match(result.sources[0].excerpt,/\$200 per vehicle/);assert.throws(()=>tavilyResearchProvider(undefined),/not configured/);});
