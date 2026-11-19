import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { ItineraryDraftSchema, itineraryParticipantDraft } from "@commons/contracts";
import { commons, itineraryItems, travelPlans, tripTasks, polls, operatorAuditEvents, researchBetaAccounting, reserveResearchBetaSpend } from "@commons/database";
import { syntheticItinerary } from "../../../../packages/contracts/src/fixtures/research-itinerary";
import { databaseTestsEnabled, withCoordinatorScenario, withTestDatabase, eq, jsonRequest, params } from "./coordinator-route-harness";

const environment = { COMMONS_ASSISTANT_UI_ENABLED: "true", COMMONS_COORDINATOR_INFERENCE_POLICY: "openai",
  COMMONS_DEEP_RESEARCH_PROVIDER: "perplexity", PERPLEXITY_API_KEY: "synthetic-perplexity-key" };
const privateItinerary = () => { const value = syntheticItinerary(); value.items = value.items.map(item => ({ ...item, day: "2027-02-12" })); return value; };
const supplier = "https://supplier.example/experiences";
const answer = `Groups above six require an inquiry. The $65 rate excludes gratuity. Private tours are Sunday–Thursday, not Friday. No dated inventory is confirmed. ${supplier}`;
const response = () => Response.json({ status: "completed", model: "openai/gpt-6.1-sol", usage: { input_tokens: 100, output_tokens: 50, cost: { total_cost: .002, currency: "USD" } },
  output: [{ type: "search_results", results: [{ id: 1, title: "Supplier policy", url: supplier, snippet: "Groups above six require inquiry. $65 before gratuity. Private tours Sunday–Thursday only." }] },
    { type: "message", content: [{ type: "output_text", text: answer, annotations: [] }] }] });
const canonical = (tripId: string) => withTestDatabase(async db => ({
  trip: await db.select().from(commons).where(eq(commons.id, tripId)),
  plan: await db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, tripId)),
  travel: await db.select().from(travelPlans).where(eq(travelPlans.commonsId, tripId)),
  tasks: await db.select().from(tripTasks).where(eq(tripTasks.commonsId, tripId)),
  polls: await db.select().from(polls).where(eq(polls.commonsId, tripId)),
}));

test("opt-in deeper research persists a separate sourced assessment, feeds Sol and preserves private draft identity without canonical writes", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  s.next.deepResearch = response; s.next.extra = privateItinerary();
  const before = await canonical(s.trip.eventId), threadId = randomUUID();
  const query = "Compare winery group rules for nine near Sonoma private@example.test PNR ABCDEF $999";
  const command = s.command({ target: { kind: "new", threadId }, text: "Prepare a private itinerary from this public research", explicitAction: { kind: "itinerary", baseVersion: 0, publicQuery: query, importText: "PRIVATE_IMPORT_MARKER private@example.test $999 PNR ABCDEF" } });
  const result = await s.post(command); assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  assert.equal(s.network.perplexityCalls.length, 3); assert.equal(s.network.tavilyCalls.length, 0);
  const publicBody = JSON.stringify(s.network.perplexityCalls[0].body);
  for (const privateText of ["PRIVATE_IMPORT_MARKER", "private@example.test", "$999", "ABCDEF"]) assert.ok(!publicBody.includes(privateText));
  const loaded = await s.thread(threadId), draft = ItineraryDraftSchema.parse(loaded.turns.at(-1).workspace.itineraryDraft);
  assert.ok(draft.researchAssessment?.answer.includes(answer)); assert.equal(draft.researchAssessment?.usage.reportedCostUsd, .006);
  assert.equal(draft.evidence[0].excerpt, "Groups above six require inquiry. $65 before gratuity. Private tours Sunday–Thursday only.");
  assert.equal(loaded.turns.at(-1).workspace.research.sources[0].providerLabel, "Perplexity");
  assert.equal(loaded.turns.at(-1).workspace.research.sources[0].coverage, "snippet");
  const planning = s.network.providerCalls.at(-1)!;
  const model = JSON.parse(planning.body.messages!.find((message: { role: string }) => message.role === "user")!.content);
  assert.equal(model.researchExecution, "completed"); assert.equal(model.privateDecisionState, "withheld");
  assert.match(model.researchAssessment.answer, /Sunday–Thursday/); assert.match(model.researchAssessment.answer, /\$65/);
  assert.equal(model.evidence[0].sourceId, draft.researchAssessment?.sources[0].sourceId);
  assert.equal(model.evidence[0].excerptTruncated, false);
  assert.deepEqual(await canonical(s.trip.eventId), before);
  const participant = JSON.stringify(itineraryParticipantDraft(draft.content, () => randomUUID()));
  assert.ok(!participant.includes("researchAssessment") && !participant.includes(answer));
  await s.post(command); assert.equal(s.network.perplexityCalls.length, 3, "replay cannot purchase another research run");
  s.next.extra = { edits: [{ id: "opening", text: "A warmer opening for the same weekend." }] };
  const edit = await s.post(s.command({ target: { kind: "existing", threadId, expectedTurnVersion: result.body.thread.turnVersion }, text: "Make the itinerary opening warmer. Do not create tasks." }));
  assert.equal(edit.body.status, "completed", JSON.stringify(edit.body));
  const after = ItineraryDraftSchema.parse((await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft);
  assert.equal(after.id, draft.id); assert.deepEqual(after.researchAssessment, draft.researchAssessment);
  const reused = JSON.parse(s.network.providerCalls.at(-1)!.body.messages!.find((message: { role: string }) => message.role === "user")!.content);
  assert.equal(reused.researchExecution, "not_requested", "retained assessment never claims a new search");
  assert.equal(s.network.perplexityCalls.length, 3); assert.deepEqual(await canonical(s.trip.eventId), before);
}, { environment }));

test("selected-provider failure leaves the saved itinerary unchanged without fallback or planning dispatch", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  s.next.extra = privateItinerary(); const threadId = randomUUID();
  const first = await s.post(s.command({ target: { kind: "new", threadId }, text: "Prepare a private itinerary", explicitAction: { kind: "itinerary", baseVersion: 0 } }));
  const before = (await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft, modelCalls = s.network.providerCalls.length;
  s.next.deepResearch = () => new Response("private upstream failure", { status: 429 });
  const failed = await s.post(s.command({ target: { kind: "existing", threadId, expectedTurnVersion: first.body.thread.turnVersion }, text: "Research winery policies", explicitAction: { kind: "itinerary", documentId: before.id, baseVersion: before.version, publicQuery: "Sonoma winery groups of nine" } }));
  assert.equal(failed.body.status, "failed"); assert.equal(s.network.perplexityCalls.length, 1);
  assert.equal(s.network.tavilyCalls.length, 0); assert.equal(s.network.providerCalls.length, modelCalls);
  const stored = (await s.thread(threadId)).turns.filter((turn: { workspace?: { itineraryDraft?: unknown } }) => turn.workspace?.itineraryDraft).at(-1).workspace.itineraryDraft;
  assert.deepEqual(stored, before);
}, { environment }));

test("ordinary lookup remains on Tavily even with deeper Perplexity selected", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  s.next.reply = "Here are the public sources; group fit needs checking.";
  const result = await s.post(s.command({ text: "/search Sonoma winery group policies" }));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  assert.equal(s.network.perplexityCalls.length, 0); assert.ok(s.network.tavilyCalls.length > 0);
}, { environment }));

test("default/rollback deeper provider remains Tavily even when a Perplexity key is present", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  s.next.extra = privateItinerary();
  const result = await s.post(s.command({ text: "Prepare a private itinerary", explicitAction: { kind: "itinerary", baseVersion: 0, publicQuery: "Sonoma winery group policies" } }));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  assert.equal(s.network.perplexityCalls.length, 0); assert.ok(s.network.tavilyCalls.length > 0);
}, { environment: { ...environment, COMMONS_DEEP_RESEARCH_PROVIDER: "tavily" } }));


test("an explicit itinerary-plus-research request reaches Perplexity from the existing composer without a hidden API parameter", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  s.next.deepResearch = response; s.next.extra = privateItinerary();
  delete process.env.TAVILY_API_KEY;
  const result = await s.post(s.command({ text: "Prepare an itinerary. Research Sonoma winery group rules for nine." }));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body)); assert.equal(s.network.perplexityCalls.length, 3);
  assert.match(String(s.network.perplexityCalls[0].body.input), /Sonoma winery group rules/);
  const draft = (await s.thread(result.body.thread.id)).turns.at(-1).workspace.itineraryDraft;
  assert.ok(draft.researchAssessment.answer.includes(answer));
}, { environment }));

test("negated and quoted research clauses cannot dispatch deeper research", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
  s.next.deepResearch = response; s.next.extra = privateItinerary();
  for (const text of ['Prepare an itinerary. Do not research the web.', 'Prepare an itinerary from this quote: "Research Sonoma wineries."']) {
    const result = await s.post(s.command({ text })); assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  }
  assert.equal(s.network.perplexityCalls.length, 0); assert.equal(s.network.tavilyCalls.length, 0);
}, { environment }));


test("refinement cannot mark a human question resolved and keeps earlier human resolution without model authority", {skip:!databaseTestsEnabled}, () => withCoordinatorScenario(async s => {
 const content=privateItinerary();content.questions=[{id:"open",prompt:"Would you drive?"}];s.next.extra=content;
 const first=await s.post(s.command({text:"Prepare a private itinerary"}));assert.equal(first.body.status,"completed");
 const threadId=first.body.thread.id;
 s.next.extra={...content,questions:[{id:"open",prompt:"Would you drive?",resolved:true}]};
 const next=await s.post(s.command({target:{kind:"existing",threadId,expectedTurnVersion:first.body.thread.turnVersion},text:"Revise the itinerary without changing the questions."}));
 assert.equal(next.body.status,"completed");const draft=(await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft;
 assert.equal(draft.content.questions[0].resolved,undefined);
}, {environment}));

test("saved plain options drive separate public candidate searches through the actual itinerary route", { skip: !databaseTestsEnabled }, () => withCoordinatorScenario(async s => {
 const content = privateItinerary();
 content.items[0].decision = { question: "Which winery?", options: ["Schramsberg", "Flowers", "DaVero"] };
 s.next.extra = content;
 const first = await s.post(s.command({ text: "Prepare a private itinerary" }));
 assert.equal(first.body.status, "completed", JSON.stringify(first.body));
 const before = await canonical(s.trip.eventId), threadId = first.body.thread.id;
 s.next.extra = { ...content, items: [{ ...content.items[0], day: "2030-01-01", title: "MODEL_DRIFT" }] };
 s.next.deepResearch = response;
 const command = s.command({ target: { kind: "existing", threadId, expectedTurnVersion: first.body.thread.turnVersion },
  text: "Prepare an itinerary. Research winery group rules for nine on Friday at Schramsberg, Flowers, and DaVero." });
 const next = await s.post(command); assert.equal(next.body.status, "completed", JSON.stringify(next.body));
 const plan = s.network.perplexityCalls.map(call => String(call.body.input));
 assert.equal(plan.length, 3);
 for (const [i, name] of ["Schramsberg", "Flowers", "DaVero"].entries()) {
  assert.ok(plan[i].startsWith(name + " ")); assert.match(plan[i], /nine on Friday/);
  for (const other of ["Schramsberg", "Flowers", "DaVero"].filter(value => value !== name)) assert.ok(!plan[i].includes(other));
 }
 assert.equal(s.network.perplexityCalls.reduce((sum, call) => sum + Number(call.body.max_tool_calls), 0), 12);
 assert.ok(s.network.perplexityCalls.every(call => call.body.max_tool_calls === 4));
 const model = JSON.parse(s.network.providerCalls.at(-1)!.body.messages!.find((message: { role: string }) => message.role === "user")!.content);
 assert.equal(model.researchExecution, "completed"); assert.equal(model.privateDecisionState, "withheld");
 const saved = (await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft;
 assert.deepEqual(saved.content.items.map((item: {id:string}) => item.id), content.items.map(item => item.id));
 assert.equal(saved.content.items[0].day, content.items[0].day); assert.equal(saved.content.items[0].title, content.items[0].title);
 assert.deepEqual(await canonical(s.trip.eventId), before);
 const calls = s.network.providerCalls.length;
 await s.post(command); assert.equal(s.network.perplexityCalls.length, 3); assert.equal(s.network.providerCalls.length, calls);
}, { environment }));


test("all-user beta admits another verified organizer, accounts live-path calls, preserves work on exhaustion and leaves manual edits available", {skip:!databaseTestsEnabled},()=>withCoordinatorScenario(async s=>{
 try {
  s.next.deepResearch=response;s.next.usage={prompt_tokens:1500,completion_tokens:500};s.next.extra=privateItinerary();const threadId=randomUUID();
  const first=await s.post(s.command({target:{kind:"new",threadId},text:"Prepare an itinerary. Research Sonoma winery group rules for nine.",explicitAction:{kind:"itinerary",baseVersion:0,publicQuery:"Sonoma winery group policies"}}));
  assert.equal(first.body.status,"completed",JSON.stringify(first.body));assert.equal(s.network.perplexityCalls.length,3);
  const current=(await s.thread(threadId)).turns.at(-1).workspace.itineraryDraft;
  const {queueAuthenticatedResearch,startAuthenticatedCoordinatorTask}=await import("./polls");
  await assert.rejects(queueAuthenticatedResearch(s.trip.eventId,{commandId:randomUUID(),threadId,query:"Sonoma winery policies"}),(e:unknown)=>(e as {code:string}).code==="unsupported_capability");
  await assert.rejects(startAuthenticatedCoordinatorTask(s.trip.eventId,{commandId:randomUUID(),threadId,title:"Separate background work",brief:"Research later",query:"Sonoma winery policies"}),(e:unknown)=>(e as {code:string}).code==="unsupported_capability");
  const rows=await withTestDatabase(db=>db.select().from(operatorAuditEvents).where(eq(operatorAuditEvents.actorPersonId,s.trip.organizerId)).orderBy(operatorAuditEvents.occurredAt,operatorAuditEvents.id));
  assert.equal(rows.filter(row=>row.action==="research_beta.reserved").length,4,"three searches and synthesis share the allowance");
  assert.equal(researchBetaAccounting(rows).unresolvedReservations,0);
  const count=s.network.providerCalls.length+s.network.perplexityCalls.length;
  await reserveResearchBetaSpend(s.trip.organizerId,1,process.env.TEST_DATABASE_URL);
  const denied=await s.post(s.command({target:{kind:"existing",threadId,expectedTurnVersion:first.body.thread.turnVersion},text:"Research Sonoma winery policies",explicitAction:{kind:"itinerary",documentId:current.id,baseVersion:current.version,publicQuery:"Sonoma winery group policies"}}));
  assert.equal(denied.body.error.code,"research_limited",JSON.stringify(denied.body));
  assert.equal(s.network.providerCalls.length+s.network.perplexityCalls.length,count,"paused allowance prevents all paid dispatch");
  const saved=(await s.thread(threadId)).turns.filter((t:{workspace?:{itineraryDraft?:unknown}})=>t.workspace?.itineraryDraft).at(-1).workspace.itineraryDraft;
  assert.deepEqual(saved,current);
  const origin=(await s.thread(threadId)).turns.find((t:{workspace?:{itineraryDraft?:{id:string}}})=>t.workspace?.itineraryDraft?.id===current.id);
  const manual=await s.routes.turn.PATCH(jsonRequest(s.trip.eventId,"","PATCH",{action:"itinerary",operation:"revise",commandId:randomUUID(),threadId,turnId:origin.id,expectedVersion:current.version,content:{...current.content,opening:"Human edit while research is paused."}}),params(s.trip.eventId));
  assert.equal(manual.status,200,JSON.stringify(await manual.clone().json()));
  const traveler=await s.post(s.command({text:"Research Sonoma winery policies"}),s.trip.travelerId);
  assert.equal(traveler.body.error.code,"organizer_required",JSON.stringify(traveler.body));
 } finally {await withTestDatabase(db=>db.delete(operatorAuditEvents).where(eq(operatorAuditEvents.actorPersonId,s.trip.organizerId)));}
},{environment:{...environment,COMMONS_RESEARCH_BETA_ENABLED:"true",COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED:"true",COMMONS_TEST_SEARCH_EMAIL:"another-beta@example.invalid",COMMONS_RESEARCH_BETA_PREPAID_KEY_SHA256:createHash("sha256").update("synthetic-perplexity-key").digest("hex")}}));
