import assert from "node:assert/strict";
import test from "node:test";
import { PollWorkingDataSchema } from "@commons/contracts";
import { converseWithCoordinator } from "./coordinator-review-inference";

const data = PollWorkingDataSchema.parse({ title: "Choose a hotel", intro: null, questions: [], ballotMode: "transparent", audience: { personIds: [], guestEmails: ["private@example.test"] }, communication: { heading: "Trip update", paragraphs: ["We’ll book directly."], links: [{ label: "Hotel", url: "https://example.test/hotel" }] } });
test("workspace uses the selected small model and returns proposals without applying them", async () => {
  const before = JSON.stringify(data);
  const result = await converseWithCoordinator(data, "Suggest a question", { apiKey: "test-only", model: "openai/gpt-4.1-mini", workspace: true }, undefined, async (_, options) => {
    const body = JSON.parse(options!.body as string);
    assert.equal(body.model, "openai/gpt-4.1-mini");
    assert.equal(body.reasoning, undefined);
    assert.doesNotMatch(JSON.stringify(body.response_format.json_schema.schema), /"oneOf"/);
    assert.ok(body.response_format.json_schema.schema.properties.operations.items.anyOf.length >= 4);
    assert.doesNotMatch(JSON.stringify(body.response_format.json_schema.schema), /"format":"(?:uri|uuid)"/);
    assert.ok(body.messages.some((message: { role: string; content: string }) => message.role === "system" && /PRIVATE PROPOSALS/.test(message.content)));
    assert.match(body.messages.map((message: { content: string }) => message.content).join("\n"), /fresh Ask the group draft/);
    assert.match(body.messages.map((message: { content: string }) => message.content).join("\n"), /Ask one useful follow-up at a time/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "Here is a proposed question.", title: null, intro: null, message: null, edits: [], operations: [{ kind: "add_question", prompt: "Which base?", selectionMode: "single", options: [{ label: "Town", description: null }, { label: "Countryside", description: null }] }] }) } }] });
  });
  assert.ok("operations" in result);
  assert.equal(JSON.stringify(data), before);
});
test("workspace trip advisory uses the provider-compatible schema and preserves review boundary", async () => {
  const result = await converseWithCoordinator(null, "Add the lodging address", { apiKey: "test-only", model: "openai/gpt-4.1-mini", workspace: true }, undefined, async (_, options) => {
    const body = JSON.parse(options!.body as string);
    const schema = body.response_format.json_schema.schema;
    assert.deepEqual(Object.keys(schema.properties), ["reply", "tripSuggestion"]);
    assert.doesNotMatch(JSON.stringify(schema), /"(?:format|pattern)":/);
    assert.equal(schema.properties.tripSuggestion.anyOf[0].properties.stayAddress.type, undefined);
    assert.ok(schema.properties.tripSuggestion.anyOf[0].required.includes("stayAddress"));
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "I can prepare that for review.", tripSuggestion: null }) } }] });
  });
  assert.equal(result.reply, "I can prepare that for review.");
  assert.equal(result.tripSuggestion, null);
  assert.ok("operations" in result);
  assert.deepEqual(result.operations, []);
});
test("review inference has no authority or recipient data and uses provider-compatible schema", async () => {
  const result = await converseWithCoordinator(data, "Make it shorter", { apiKey: "test-only", model: "test-model" }, undefined, async (url, options) => {
    const body = JSON.parse(options!.body as string);
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.deepEqual(body.provider, { require_parameters: true, data_collection: "deny", zdr: true });
    assert.equal(body.tools, undefined);
    assert.equal(body.reasoning, undefined);
    assert.doesNotMatch(JSON.stringify(body.messages), /private@example/);
    assert.doesNotMatch(JSON.stringify(body.response_format.json_schema.schema), /"format":"(?:uri|uuid)"/);
    assert.match(body.messages[0].content, /cannot send, publish, approve/);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "Updated the message.", title: null, intro: null, message: { heading: "Trip update", paragraphs: ["Book directly after we decide."] }, edits: [] }) } }] });
  });
  assert.deepEqual(result.message?.links, data.communication?.links);
});
test("standard provider policy is explicit and does not inherit private routing", async () => {
  await converseWithCoordinator(null, "What can you help with?", { apiKey: "test", model: "meta/muse-spark-1.3", providerPolicy: "standard" }, undefined, async (_, options) => {
    const body = JSON.parse(options!.body as string);
    assert.deepEqual(body.provider, { require_parameters: true });
    assert.deepEqual(body.reasoning, { effort: "low" });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "I can help you prepare a draft.", title: null, intro: null, message: null, edits: [] }) } }] });
  });
});
test("Astra uses low reasoning only in the coordinator with bounded output and private routing", async () => {
  await converseWithCoordinator(null, "What can you help with?", { apiKey: "test-only", model: "openai/gpt-6-astra" }, undefined, async (_, options) => {
    const body = JSON.parse(options!.body as string);
    assert.equal(body.model, "openai/gpt-6-astra");
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.max_tokens, 6000);
    assert.equal(body.temperature, undefined);
    assert.deepEqual(body.provider, { require_parameters: true, data_collection: "deny", zdr: true });
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "I can help review your draft.", title: null, intro: null, message: null, edits: [] }) } }] });
  });
});
test("missing configuration, provider errors, refusal and malformed output cannot edit a saved draft", async () => {
  const before = JSON.stringify(data);
  await assert.rejects(converseWithCoordinator(data, "Hi", {}));
  for (const response of [Response.json({}, { status: 503 }), Response.json({ choices: [{ finish_reason: "length" }] }), Response.json({ choices: [{ finish_reason: "stop", message: { refusal: "No" } }] }), Response.json({ choices: [{ finish_reason: "stop", message: { content: "wrong" } }] })]) {
    await assert.rejects(converseWithCoordinator(data, "Hi", { apiKey: "test", model: "test" }, undefined, async () => response));
  }
  assert.equal(JSON.stringify(data), before);
});

test("the conversation continues without an editable artifact and refuses edits to published context", async () => {
  const reply: { reply: string; title: string | null; intro: null; message: null; edits: [] } = { reply: "Next, wait for the group’s hotel responses.", title: null, intro: null, message: null, edits: [] };
  const fetcher: typeof fetch = async (_, options) => {
    const context = JSON.parse(JSON.parse(options!.body as string).messages.at(-1).content);
    assert.equal(context.draft, null);
    assert.equal(context.conversation[0].text, "Earlier question");
    assert.equal(context.priorPolls[0].title, "Date poll");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] });
  };
  const context = { conversation: [{ role: "user", text: "Earlier question" }], priorPolls: [{ title: "Date poll" }] };
  assert.equal((await converseWithCoordinator(null, "What’s next?", { apiKey: "test", model: "test" }, undefined, fetcher, context)).reply, reply.reply);
  reply.title = "Unexpected mutation";
  await assert.rejects(converseWithCoordinator(null, "What’s next?", { apiKey: "test", model: "test" }, undefined, fetcher, context));
});

test("inference diagnostics never log credentials or private provider bodies", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  const configuration = { apiKey: "private-secret", model: "test" };
  await assert.rejects(converseWithCoordinator(null, "private-prompt", configuration, undefined, async () => {
    throw new TypeError("private-secret private-prompt");
  }));
  await assert.rejects(converseWithCoordinator(null, "private-prompt", configuration, undefined, async () => Response.json({ error: { code: 401, message: "private-secret private-prompt" } })));
  const logged = JSON.stringify(warning.mock.calls.map(call => call.arguments));
  assert.match(logged, /type_error/);
  assert.match(logged, /401/);
  assert.doesNotMatch(logged, /private-secret|private-prompt/);
});

test("pasted credential whitespace is trimmed before constructing the authorization header", async () => {
  await converseWithCoordinator(null, "Hi", { apiKey: " \r\ntest-key\n ", model: "test" }, undefined, async (_, options) => {
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer test-key");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "Hello.", title: null, intro: null, message: null, edits: [] }) } }] });
  });
  await assert.rejects(converseWithCoordinator(null, "Hi", { apiKey: " \r\n ", model: "test" }));
});

// Production transcript, "Fly-fishing confirmation": a model told it could prepare plan updates described a review card that did not exist, on a trip where the capability was off.
async function promptFor(tripChangesEnabled: boolean | undefined) {
  let system = "";
  const context = { tripContext: { plans: [] }, conversation: [], priorPolls: [], ...(tripChangesEnabled === undefined ? {} : { tripChangesEnabled }) };
  await converseWithCoordinator(null, "I want to change the activity status to confirmed", { apiKey: "test", model: "test", workspace: true }, undefined, async (_, options) => {
    system = (JSON.parse(options!.body as string).messages as Array<{ role: string; content: string }>).filter(message => message.role === "system").map(message => message.content).join("\n");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "You can change it in Plan.", tripSuggestion: null }) } }] });
  }, context);
  return system;
}

test("Fly-fishing transcript: with trip changes off (or unknown) the model is never told it can prepare a plan or trip update", async () => {
  for (const enabled of [false, undefined]) {
    const system = await promptFor(enabled);
    assert.doesNotMatch(system, /MAY prepare|CAN prepare|offer to prepare an update/i, String(enabled));
    assert.match(system, /You cannot change saved trip records or plan items from chat, and you cannot prepare a suggested update, proposal or review card/);
    assert.match(system, /mark a plan item confirmed in Plan/);
    assert.match(system, /never offer to prepare or apply it/);
    assert.match(system, /tripSuggestion MUST always be null/);
    assert.match(system, /tripSuggestion is always null/, "the shared trip rules agree");
    assert.doesNotMatch(system, /planStartsOn and planStartsTime|You may set tripSuggestion\.stayId/, "the plan-field instructions are not sent");
  }
});

test("Fly-fishing transcript: with trip changes on the model may prepare updates, but never says it prepared, included or attached one", async () => {
  const system = await promptFor(true);
  assert.match(system, /you MAY prepare a suggested trip update for explicit human review/);
  assert.match(system, /Commons CAN prepare a plan status, start-time or note change/);
  assert.match(system, /Never say that you prepared, included, attached, added or are showing a suggestion, suggested update, proposal or review card/);
  assert.match(system, /only Commons itself, in text it writes, says a review exists/);
  assert.match(system, /offer to prepare an update for review/);
});

test("only server-marked first construction gets the bounded construction deadline, below turn lease", async () => {
  const { TURN_LEASE_MS } = await import("@commons/database");
  assert.ok(90_000 < TURN_LEASE_MS);
  const deadlines: number[] = [], timeout = AbortSignal.timeout;
  AbortSignal.timeout = ms => { deadlines.push(ms); return timeout(ms); };
  try {
    for (const construction of [true, false]) {
      await converseWithCoordinator(data, "Create three questions", { apiKey: "test", model: "test", workspace: true, construction }, undefined, async (_, options) => {
        assert.ok(options?.signal);
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(construction ? { reply: "Proposed", title: null, intro: null, message: null, questions: [], sourceLinks: [] } : { reply: "Proposed", title: null, intro: null, message: null, edits: [], operations: [] }) } }] });
      });
    }
    assert.deepEqual(deadlines, [90_000, 40_000]);
  } finally { AbortSignal.timeout = timeout; }
});


test("first construction treats supplied placeholder choices as sufficient without letting old itinerary context authorize edits", async () => {
  await converseWithCoordinator(data,"Create a new lodging poll with Hotel A and Hotel B.",{apiKey:"test",model:"test",workspace:true,construction:true},undefined,async (_,options)=>{
    const body=JSON.parse(options!.body as string),guidance=body.messages.filter((message:{role:string})=>message.role==="system").at(-1).content;
    assert.match(guidance,/ONE new PRIVATE poll/); assert.match(guidance,/Hotel A and Hotel B/);
    assert.match(guidance,/read-only source context/); assert.match(guidance,/no empty poll will be saved/);
    const schema=body.response_format.json_schema.schema;
    assert.equal(schema.properties.edits,undefined); assert.equal(schema.properties.operations,undefined);
    assert.deepEqual(schema.properties.questions.items.properties.kind.enum,["choice","text"]);
    assert.equal(body.response_format.json_schema.name,"commons_poll_construction");
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({reply:"Proposed hotel choice",title:null,intro:null,message:null,questions:[{kind:"choice",prompt:"Which hotel?",required:true,selectionMode:"single",options:[{label:"Hotel A",description:null,exclusive:false,url:null},{label:"Hotel B",description:null,exclusive:false,url:null}]}],sourceLinks:[]})}}]});
  });
});


test("construction rejects provider attempts to edit or remove absent question identities", async () => {
  await assert.rejects(converseWithCoordinator(data,"Create a new lodging poll with Hotel A and Hotel B.",{apiKey:"test",model:"test",workspace:true,construction:true},undefined,async ()=>Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({reply:"Proposed",title:null,intro:null,message:null,edits:[],operations:[{kind:"remove_question",questionId:"00000000-0000-4000-8000-000000000001"}]})}}]})));
});

test('dynamic UI uses the existing structured call and invalid UI does not lose the reply', async()=>{
  const view={component:'Work',props:{children:[{component:'StayComparison',props:{ids:['saved-stay'],focus:'notes'}}]}};
  let calls=0;
  for(const candidate of [view,{component:'BookAndPay',props:{url:'https://evil.test'}}]){
    const result=await converseWithCoordinator(null,'Compare our saved stays, access first',{apiKey:'test-only',model:'gpt-6-luna',transport:'openai',workspace:true},undefined,async(url,options)=>{
      calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');const body=JSON.parse(options!.body as string);
      assert.ok(body.response_format.json_schema.schema.required.includes('presentation'));assert.equal(body.tools,undefined);
      assert.match(body.messages.filter((m:{role:string})=>m.role==='system').map((m:{content:string})=>m.content).join('\n'),/Working material only/);
      assert.ok(body.messages.some((m:{content:string})=>m.content.includes('presentationCatalog')));
      return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'The recorded hotel room total is unknown.',tripSuggestion:null,presentation:candidate})}}]});
    },{conversation:[],priorPolls:[],presentation:{catalog:{stays:[{id:'saved-stay'}]},previous:null}});
    assert.equal(result.reply,'The recorded hotel room total is unknown.');
    assert.equal(result.presentationInvalid,candidate!==view);assert.deepEqual(result.presentationView,candidate===view?view:null);
  }
  assert.equal(calls,2,'exactly one call per turn, no UI repair inference');
});

test('personal, ordinary flag-off and editable-draft calls do not request presentation',async()=>{
  for(const personal of [false,true])await converseWithCoordinator(null,'Hello',{apiKey:'test-only',model:'test',workspace:!personal,personal},undefined,async(_,options)=>{
    const body=JSON.parse(options!.body as string);assert.equal(body.response_format.json_schema.schema.properties.presentation,undefined);assert.doesNotMatch(JSON.stringify(body.messages),/presentationCatalog/);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(personal?{reply:'Hello.'}:{reply:'Hello.',tripSuggestion:null})}}]});
  },{conversation:[],priorPolls:[]});
});
