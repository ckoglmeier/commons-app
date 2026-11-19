import assert from "node:assert/strict";
import test from "node:test";
import { perplexityResearchPlan } from "./perplexity-research-plan";
const runId = "96000000-0000-4000-8000-000000000001";
const queries = ["First official group policy", "Second official visitor hours", "Third official admission"];
const data = (index: number) => ({ status: "completed", model: "openai/gpt-6.1-sol", usage: { input_tokens: 10, output_tokens: 5, cost: { total_cost: .001, currency: "USD" } }, output: [
 { type: "search_results", results: [{ id: 1, url: `https://supplier${index}.example/visit`, title: "Official visit", snippet: `Policy ${index}` }] },
 { type: "message", content: [{ type: "output_text", text: `Policy ${index} [web:1]`, annotations: [] }] },
] });
test("executes each public candidate scope with bounded page reads, shared output bounds and collision-safe evidence", async () => {
 const calls: { input: string; max_tool_calls: number; max_output_tokens: number; max_steps:number; parallel_tool_calls:boolean; tools: {type:string;max_urls?:number;max_results?:number}[] }[] = [];
 const result = await perplexityResearchPlan("Three public options", { apiKey: "synthetic", runId, searchQueries: queries, fetcher: async (_url, init) => {
  const body = JSON.parse(String(init?.body)); calls.push(body); return Response.json(data(queries.indexOf(body.input)));
 } });
 assert.deepEqual(calls.map(call => call.input), queries);
 assert.equal(calls.reduce((sum, call) => sum + call.max_tool_calls, 0), 12);
 assert.equal(calls.reduce((sum, call) => sum + call.max_output_tokens, 0), 6000);
 assert.ok(calls.every(call => call.max_steps === 4 && call.parallel_tool_calls === false));
 assert.ok(calls.every(call => call.tools[0].max_results === 1 && call.tools[1].type === "fetch_url" && call.tools[1].max_urls === 1));
 assert.equal(result.sources.length, 3); assert.equal(new Set(result.sources.map(source => source.sourceId)).size, 3);
 assert.equal(result.citations.length, 3); assert.equal(result.usage.reportedCostUsd, .003);
 for (let i=0;i<3;i++) { assert.match(result.answer, new RegExp(`supplier${i}\\.example`)); assert.deepEqual(result.sources[i].providerResultIds, [`${i+1}:1`]); }
 assert.doesNotMatch(result.answer, /\[web:/); assert.equal(result.policyVersion, "perplexity-sol-research-v8");
});
test("one failed candidate aborts other work without fallback or drafting a false complete assessment", async () => {
 let calls = 0;
 await assert.rejects(perplexityResearchPlan("Three options", { apiKey: "synthetic", runId, searchQueries: queries, fetcher: async (_url, init) => {
  calls++; const body=JSON.parse(String(init?.body));
  if(body.input===queries[0]) return new Response("PRIVATE_FAILURE", {status:429});
  return new Promise<Response>((_resolve,reject)=>{ init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true}); });
 } }), error => error instanceof Error && error.message.includes("provider_failed") && !error.message.includes("PRIVATE_FAILURE"));
 assert.equal(calls, 1);
});
test("missing candidate usage remains unknown; duplicate sources deduplicate without mixing provider IDs", async () => {
 const result=await perplexityResearchPlan("Two options", {apiKey:"synthetic",runId,searchQueries:queries.slice(0,2),fetcher:async()=>{
  const value=data(0); delete (value as {usage?:unknown}).usage; return Response.json(value);
 }});
 assert.equal(result.sources.length,1); assert.deepEqual(result.sources[0].providerResultIds,["1:1","2:1"]);
 assert.equal(result.usage.reportedCostUsd,null); assert.equal(result.usage.inputTokens,null);
});
test("oversized plans fail before any request", async () => {
 let calls=0;
 await assert.rejects(perplexityResearchPlan("Too many",{apiKey:"synthetic",runId,searchQueries:[...queries,"Fourth"],fetcher:async()=>{calls++;return Response.json(data(0));}}));
 assert.equal(calls,0);
});


test("five-source preview includes every candidate and page citations remain local to each response",async()=>{
 const result=await perplexityResearchPlan("Three options",{apiKey:"synthetic",runId,searchQueries:queries,fetcher:async(_url,init)=>{
  const i=queries.indexOf(JSON.parse(String(init?.body)).input),value=data(i);
  value.output.push({type:"fetch_url_results",contents:[{id:1,url:`https://supplier${i}.example/hours`,title:"Hours",snippet:`Hours ${i}`},{id:2,url:`https://supplier${i}.example/groups`,title:"Groups",snippet:`Groups ${i}`}]} as never);
  value.output[1].content![0].text=`Hours [page:1] groups [page:2] policy [web:1]`;
  return Response.json(value);
 }});
 assert.equal(result.sources.length,9);
 for(let i=0;i<3;i++) {
  assert.ok(result.sources.slice(0,5).some(source=>source.url===`https://supplier${i}.example/hours`));
  assert.ok(result.answer.includes(`https://supplier${i}.example/hours`));
 }
 assert.equal(result.citations.length,9);assert.doesNotMatch(result.answer,/\[(?:page|web):/);
});


test("candidate preview leads with cited policy instead of an uncited fetched discovery page",async()=>{
 const result=await perplexityResearchPlan("Three options",{apiKey:"synthetic",runId,searchQueries:queries,fetcher:async(_url,init)=>{
  const i=queries.indexOf(JSON.parse(String(init?.body)).input),value=data(i);
  value.output.push({type:"fetch_url_results",contents:[{url:`https://supplier${i}.example/`,title:"Discovery homepage",snippet:"Welcome"}]} as never);
  return Response.json(value);
 }});
 assert.equal(result.sources.length,6);
 assert.deepEqual(result.sources.slice(0,3).map(source=>source.url),[0,1,2].map(i=>`https://supplier${i}.example/visit`));
 assert.equal(result.citations.length,3);
});
