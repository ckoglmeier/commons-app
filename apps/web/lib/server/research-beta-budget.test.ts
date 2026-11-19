import {createHash} from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {registerComponentImportStubs} from "../test-support/hook-harness";
registerComponentImportStubs();
const moduleLoading=import("./research-beta-budget");
import {ResearchBetaLimitError} from "@commons/database";
const endpoint="https://api.perplexity.ai/v1/agent";
const body={model:"openai/gpt-6.1-sol",max_output_tokens:2000,max_tool_calls:4,max_steps:4};
const prepaidKeySha256=createHash("sha256").update("synthetic-perplexity-key").digest("hex");
const init={method:"POST",headers:{Authorization:"Bearer synthetic-perplexity-key"},body:JSON.stringify(body)};
async function harness(response:Response|Error){const {researchBetaFetch}=await moduleLoading;let calls=0;const holds:number[]=[],charges:number[]=[];
 const fetcher:typeof fetch=async()=>{calls++;if(response instanceof Error)throw response;return response;};
 const wrapped=researchBetaFetch("actor",fetcher,{enabled:true,prepaidKeySha256,reserve:async(_a,n)=>{holds.push(n);return "00000000-0000-4000-8000-000000000001";},settle:async(_r,_a,n)=>{charges.push(n);}});
 return {wrapped,holds,charges,calls:()=>calls};}
test("known beta usage settles twice the supplier charge without consuming the original response",async()=>{
 const h=await harness(Response.json({status:"completed",model:"openai/gpt-6.1-sol",usage:{cost:{currency:"USD",total_cost:.023}},output:[]}));const result=await h.wrapped(endpoint,init);
 assert.equal((await result.json()).usage.cost.total_cost,.023);assert.deepEqual(h.holds,[850000]);assert.deepEqual(h.charges,[46000]);
});
test("unknown, failed, aborted and invalid-charge responses retain the complete persistent hold",async()=>{
 for(const response of [Response.json({usage:{}}),Response.json({status:"failed",usage:{cost:{currency:"USD",total_cost:0}}}),Response.json({status:"incomplete",usage:{cost:{currency:"USD",total_cost:.01}}}),Response.json({usage:{cost:{currency:"USD",total_cost:0}}},{status:500}),new Error("unknown transport outcome"),Response.json({usage:{cost:{currency:"USD",total_cost:-1}}})]){
  const h=await harness(response);try{await h.wrapped(endpoint,init);}catch{/* Deliberately exercise uncertain transport outcomes. */}assert.equal(h.calls(),1);assert.equal(h.holds.length,1);assert.deepEqual(h.charges,[]);
 }
});
test("exhausted beta budget stops dispatch, regardless of local fetch or account",async()=>{
 const {researchBetaFetch}=await moduleLoading;let calls=0;const wrapped=researchBetaFetch("actor",async()=>{calls++;return Response.json({});},{enabled:true,prepaidKeySha256,reserve:async()=>{throw new ResearchBetaLimitError();}});
 await assert.rejects(wrapped(endpoint,init),error=>(error as {code:string}).code==="research_limited");assert.equal(calls,0);
});
test("an operator isn't held to the exhausted allowance, and one call's own bounds still apply",async()=>{
 const {researchBetaFetch}=await moduleLoading;let calls=0,reserved=0;const wrapped=researchBetaFetch("actor",async()=>{calls++;return Response.json({});},{enabled:true,prepaidKeySha256,limitExempt:async()=>true,reserve:async()=>{reserved++;throw new ResearchBetaLimitError();}});
 assert.equal((await wrapped(endpoint,init)).status,200);assert.equal(calls,1);assert.equal(reserved,0);
 await assert.rejects(wrapped("https://example.test/v1/agent",init));assert.equal(calls,1);
});

test("unexpected destinations, streaming, model switches and expanded request bounds cannot bypass the allowance",async()=>{
 for(const [url,b] of [["https://example.invalid",body],[endpoint,{...body,stream:true}],[endpoint,{...body,max_tool_calls:5}],[endpoint,{...body,model:"another-model"}],[endpoint,{...body,max_output_tokens:7000}] ] as const){
  const h=await harness(Response.json({}));await assert.rejects(h.wrapped(url,{method:"POST",body:JSON.stringify(b)}));assert.equal(h.calls(),0);assert.deepEqual(h.holds,[]);
 }
});
test("research drafting and bounded Tavily lookup count against the same allowance; ordinary flag-off calls do not",async()=>{
 const h=await harness(Response.json({choices:[{finish_reason:"stop"}],usage:{prompt_tokens:1000,completion_tokens:100}}));await h.wrapped("https://api.openai.com/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"gpt-6.1-sol",max_completion_tokens:6000})});assert.deepEqual(h.charges,[7000]);
 const t=await harness(Response.json({results:[]}));await t.wrapped("https://api.tavily.com/extract",{method:"POST",body:JSON.stringify({extract_depth:"basic",urls:["https://example.com"]})});assert.deepEqual(t.charges,[16000]);
 const {researchBetaFetch}=await moduleLoading;const fake:typeof fetch=async()=>Response.json({});assert.equal(researchBetaFetch("actor",fake,{enabled:false}),fake);
});

test("beta Perplexity activation requires the pinned isolated-project key",async()=>{
 const {researchBetaFetch}=await moduleLoading;let calls=0;const f:typeof fetch=async()=>{calls++;return Response.json({});};
 const wrapped=researchBetaFetch("actor",f,{enabled:true,prepaidKeySha256});
 await assert.rejects(wrapped(endpoint,{...init,headers:{Authorization:"Bearer different-shared-key"}}),e=>(e as {code:string}).code==="provider_not_configured");assert.equal(calls,0);
});


test("Terra drafting is allowed under the existing conservative cap; Perplexity stays pinned to Sol", async () => {
 const h=await harness(Response.json({choices:[{finish_reason:"stop"}],usage:{prompt_tokens:1000,completion_tokens:100}}));
 await h.wrapped("https://api.openai.com/v1/chat/completions",{method:"POST",body:JSON.stringify({model:"gpt-6.1-terra",max_completion_tokens:6000})});
 assert.equal(h.calls(),1); assert.deepEqual(h.charges,[7000]);
 const search=await harness(Response.json({}));
 await assert.rejects(search.wrapped(endpoint,{...init,body:JSON.stringify({...body,model:"openai/gpt-6.1-terra"})}));
 assert.equal(search.calls(),0);
});
