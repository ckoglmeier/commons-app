import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { itineraryModelInput } from "../itinerary-model-input";
import { syntheticDraft } from "../../../../packages/contracts/src/fixtures/research-itinerary";
import { randomUUID } from "node:crypto";
import { perplexityResearch, PERPLEXITY_RESEARCH_POLICY } from "./perplexity-research";
const key = "synthetic-perplexity-key";
const source = { id: 1, url: "https://supplier.example/visit", title: "Supplier", snippet: "Groups above six require inquiry. Published rate $65 plus 20% gratuity." };
const response = () => ({ status: "completed", model: "openai/gpt-6.1-sol", usage: { input_tokens: 10, output_tokens: 20, cost: { currency: "USD", total_cost: .001 } },
  output: [{ type: "search_results", results: [source] }, { type: "message", content: [{ type: "output_text", text: "Groups above six need inquiry; no appointment is confirmed. https://supplier.example/visit", annotations: [] }] }] });
const call = (data: unknown, extra: Partial<Parameters<typeof perplexityResearch>[1]> = {}) => perplexityResearch("Supplier groups of nine", { apiKey: key, runId: randomUUID(), fetcher: async () => Response.json(data), ...extra });

test("bounded Sol request has only the public question, one endpoint, no storage or action tools", async () => {
  const result = await call(response(), { fetcher: async (url, options) => {
    assert.equal(url, "https://api.perplexity.ai/v1/agent"); assert.equal(options?.redirect, "error");
    const body = JSON.parse(String(options?.body)); assert.equal(body.input, "Supplier groups of nine");
    assert.equal(body.model, PERPLEXITY_RESEARCH_POLICY.model); assert.equal(body.reasoning.effort, "low");
    assert.equal(body.max_tool_calls, 3); assert.equal(body.max_output_tokens, 4096); assert.equal(body.store, false);
    assert.deepEqual(body.tools, [{ type: "web_search", max_results: 5, max_tokens: 6000, max_tokens_per_page: 1600 }]);
    return Response.json(response());
  } });
  assert.equal(result.sources[0].coverage, "snippet"); assert.equal(result.sources[0].excerpt, source.snippet);
  assert.ok(!result.sources[0].excerpt.includes("no appointment"));
  assert.equal(result.citations[0].sourceId, result.sources[0].sourceId);
  assert.equal(result.usage.reportedCostUsd, .001); assert.equal(result.observedModel, "openai/gpt-6.1-sol");
});

test("no credentials or invalid identity prevents dispatch", async () => {
  let calls = 0; const fetcher = async () => { calls++; return Response.json(response()); };
  await assert.rejects(call(response(), { apiKey: undefined, fetcher }), /provider_not_configured/);
  await assert.rejects(call(response(), { runId: "not-a-uuid", fetcher }), /provider_failed/);
  assert.equal(calls, 0);
});

test("incomplete, mismatched model, missing answer/evidence/citations and fabricated URLs fail closed", async () => {
  const bad = [ { ...response(), status: "incomplete" }, { ...response(), model: "openai/gpt-6-luna" }, { ...response(), output: [] },
    { ...response(), output: response().output.slice(1) },
    { ...response(), output: [{ type: "search_results", results: [source] }, { type: "message", content: [{ type: "output_text", text: "Uncited assertion" }] }] },
    { ...response(), output: [{ type: "search_results", results: [source] }, { type: "message", content: [{ type: "output_text", text: "See https://invented.example/price" }] }] },
    { ...response(), output: [{ type: "search_results", results: [{ ...source, url: "https://127.0.0.1/private" }] }, { type: "message", content: [{ type: "output_text", text: "See https://127.0.0.1/private" }] }] },
  ];
  for (const data of bad) await assert.rejects(call(data), /provider_failed/);
});

test("provider errors are redacted and never retried", async () => {
  let calls = 0;
  try { await call(null, { fetcher: async () => { calls++; return new Response(key + " private request", { status: 429 }); } }); assert.fail(); }
  catch (error) { assert.equal((error as Error).message, "Coordinator provider: provider_failed"); }
  assert.equal(calls, 1);
});

test("parent cancellation and adapter-ignoring deadline stop without a second call", async () => {
  const controller = new AbortController(); let calls = 0;
  const fetcher = async () => { calls++; return new Promise<Response>(() => {}); };
  const pending = call(null, { signal: controller.signal, fetcher }); controller.abort(new Error("stopped"));
  await assert.rejects(pending, /stopped/); assert.equal(calls, 1);
  // Keep Node alive because AbortSignal.timeout deliberately uses an unref'ed timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(call(null, { timeoutMs: 5, fetcher }), /provider_failed/); }
  finally { clearTimeout(keepAlive); }
  assert.equal(calls, 2);
});

test("oversized body is cancelled and cannot become a saved assessment", async () => {
  await assert.rejects(call(null, { fetcher: async () => new Response("x".repeat(PERPLEXITY_RESEARCH_POLICY.maxResponseBytes + 1)) }), /provider_failed/);
});

test("search excerpts preserve exact text with explicit truncation; billing/model gaps stay unknown", async () => {
  const data = response(); delete (data as { model?: string }).model; delete (data as { usage?: unknown }).usage;
  data.output[0].results = [{ ...source, snippet: "x".repeat(5001) }];
  const result = await call(data); assert.equal(result.sources[0].excerpt.length, 5000); assert.equal(result.sources[0].excerptTruncated, true);
  assert.equal(result.observedModel, null); assert.deepEqual(result.usage, { inputTokens: null, outputTokens: null, reportedCostUsd: null });
});

test("all six captured qualified Sol responses retain their full answer and source provenance through the production adapter", async () => {
  const cases = JSON.parse(await readFile(new URL("./fixtures/perplexity-sol-responses.json", import.meta.url), "utf8"));
  for (const row of cases) {
    const assessment = await perplexityResearch(row.question, { apiKey: key, runId: randomUUID(), fetcher: async () => Response.json(row.response) });
    const expected = row.response.output.filter((item: { type: string }) => item.type === "message").flatMap((item: { content: Array<{ type: string; text: string }> }) => item.content.filter(part => part.type === "output_text").map(part => part.text)).join("\n").trim();
    assert.equal(assessment.answer, expected, row.caseId); assert.ok(assessment.citations.length, row.caseId);
  }
});


test("different returned excerpts from the same URL preserve source conflicts rather than overwriting them", async () => {
  const data = response(); data.output[0].results = [source, { ...source, id: 2, snippet: "Earlier policy: groups of four only." }];
  const result = await call(data); assert.equal(result.sources.length, 2); assert.equal(result.citations.length, 2);
  assert.match(result.sources[1].excerpt, /Earlier policy/);
});

test("metadata-only observations include reported usage even when citation validation fails", async () => {
  const data = response(); data.output[1].content![0].text = "Unsupported citation https://invented.example/price";
  const events: unknown[] = [];
  await assert.rejects(call(data, { observer: generation => events.push(generation) }), /provider_failed/);
  assert.equal(events.length, 1); const event = events[0] as { provider: string; failed: boolean; cost: number };
  assert.equal(event.provider, "perplexity"); assert.equal(event.failed, true); assert.equal(event.cost, .001);
  assert.ok(!JSON.stringify(event).includes(key) && !JSON.stringify(event).includes("invented.example"));
});


test("source references survive text redaction while public rates and private costs retain separate treatment", async () => {
  const draft = syntheticDraft();
  draft.researchAssessment = await call(response(), { runId: "96000000-0000-4000-8000-000000000001" });
  draft.evidence = draft.researchAssessment.sources.map(({ runId, sourceId, title, url, excerpt, retrievedAt }) => ({ runId, sourceId, title, url, excerpt, retrievedAt }));
  draft.imports = [{ id: "96000000-0000-4000-8000-000000000009", digest: "0".repeat(64), active: true, addedBy: draft.ownerId, text: "Private paid $999 contact private@example.test" }];
  const input = itineraryModelInput("Keep private paid $999 out", draft);
  assert.ok(input.researchAssessment!.answer.includes("96000000-0000-4000-8000-000000000001:deep-1"));
  assert.match(input.evidence[0].excerpt, /\$65/); assert.ok(!JSON.stringify(input).includes("$999"));
  assert.deepEqual(input.researchAssessment!.sources[0].providerResultIds, ["1"]);
});


test("public multi-query plan uses one request with the existing total tool/deadline bounds and is retained", async () => {
 let calls=0;const searchQueries=["Supplier group rules","Supplier Friday opening","Supplier public prices"];
 const result=await call(response(),{searchQueries,fetcher:async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.deepEqual(JSON.parse(body.input),{question:"Supplier groups of nine",searchQueries});assert.equal(body.max_tool_calls,3);return Response.json(response());}});
 assert.equal(calls,1);assert.deepEqual(result.searchQueries,searchQueries);
 await assert.rejects(call(response(),{searchQueries:[...searchQueries,"Fourth query"],fetcher:async()=>{calls++;return Response.json(response());}}));assert.equal(calls,1);
});


test("native page reads retain extracted evidence, exact page citations and a one-URL bound", async () => {
 const value=response(); value.output.push({type:"fetch_url_results",contents:[{id:7,url:"https://supplier.example/visitor-policy",title:"Official policy",snippet:"Groups above six require an appointment."}]} as never);
 value.output[1].content![0].text="Groups above six require an appointment. [page:7]";
 const result=await call(value,{fetchPages:true,fetcher:async(_url,init)=>{
  const body=JSON.parse(String(init?.body)); assert.deepEqual(body.tools.map((tool:{type:string})=>tool.type),["web_search","fetch_url"]);
  assert.equal(body.max_steps,4); assert.equal(body.parallel_tool_calls,false); assert.equal(body.tools[0].max_results,1); assert.equal(body.tools[1].max_urls,1); return Response.json(value);
 }});
 assert.equal(result.sources[0].url,"https://supplier.example/visitor-policy");assert.deepEqual(result.sources[0].providerResultIds,["page:7"]);
 assert.equal(result.sources[0].coverage,"snippet");assert.equal(result.citations[0].sourceId,result.sources[0].sourceId);
});
test("failed or unsafe page fetches cannot become evidence or support a citation",async()=>{
 for(const [url,snippet] of [["https://supplier.example/blocked","no_result_returned"],["https://supplier.example/blocked","HTTP client error: 403"],["http://127.0.0.1/private","Invented policy"]]) {
  const value=response();value.output.push({type:"fetch_url_results",contents:[{id:7,url,title:"Unavailable",snippet}]} as never);
  value.output[1].content![0].text=`Policy ${url}`;
  await assert.rejects(call(value,{fetchPages:true}),/provider_failed/);
 }
});
test("page IDs are not guessed when the provider did not return one",async()=>{
 const value=response();value.output.push({type:"fetch_url_results",contents:[{url:"https://supplier.example/policy",snippet:"Policy"}]} as never);
 value.output[1].content![0].text="Policy [page:1]";
 await assert.rejects(call(value,{fetchPages:true}),/provider_failed/);
});


test("native crawler failure text is never captured as visitor policy",async()=>{
 const value=response();
 value.output.push({type:"fetch_url_results",contents:[{url:"https://supplier.example/failed",snippet:'[fetch_url: no content could be retrieved — crawler error http_code_client_error. Do not infer values for this source.]'}]} as never);
 const result=await call(value,{fetchPages:true,maxToolCalls:4});
 assert.equal(result.sources.length,1);assert.ok(!result.sources.some(source=>source.url.endsWith("/failed")));
});
