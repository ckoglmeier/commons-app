import test from "node:test";import assert from "node:assert/strict";import {openAiBrainAdapter} from "./trip-brain-model";
const request={model:"authored-candidate",promptVersion:"brain-select-v1" as const,snapshot:{tripId:"96000000-0000-4000-8000-0000000000a1",timezone:"America/Denver",phase:"planning" as const,facts:[],coverage:["Only shared facts"],capturedAt:"2026-10-01T20:00:00Z"},candidates:[],maxOutputTokens:800,signal:new AbortController().signal};
test("optional Brain transport sends one bounded schema request with no tools and preserves actual usage",async()=>{
 let calls=0;const adapter=openAiBrainAdapter("synthetic-key",async (_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.max_completion_tokens,800);assert.equal(body.tools,undefined);assert.equal(body.model,request.model);assert.deepEqual(body.response_format.json_schema.schema.required,["findingKeys"]);assert.equal(init?.signal,request.signal);return Response.json({choices:[{finish_reason:"stop",message:{content:'{"findingKeys":[]}'}}],usage:{prompt_tokens:123,completion_tokens:8}});});
 assert.deepEqual(await adapter(request),{findingKeys:[],inputTokens:123,outputTokens:8});assert.equal(calls,1);
});
test("optional Brain transport refuses oversized/incomplete/tool output without another call",async()=>{
 for(const payload of [{choices:[{finish_reason:"length",message:{content:'{"findingKeys":[]}'}}]},{choices:[{finish_reason:"stop",message:{content:'{"findingKeys":[]}',tool_calls:[{}]}}]}]){let calls=0;await assert.rejects(openAiBrainAdapter("synthetic-key",async()=>{calls++;return Response.json(payload);})(request));assert.equal(calls,1);}
 await assert.rejects(openAiBrainAdapter("synthetic-key",async()=>new Response("x".repeat(64001)))(request),/exceeds limit/);
});
