import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { beginCoordinatorTurn, completeCoordinatorTurn, saveCommonsPollDraft, actOnCoordinatorWorkspace, commons, pollDrafts, memberships, travelPlans, readLegacyItineraryRevisions, itineraryItems, tripTasks, polls } from "@commons/database";
import { databaseTestsEnabled, eq, withCoordinatorScenario, withTestDatabase } from "./coordinator-route-harness";
import { newItineraryDraft, itineraryQuestion } from "../itinerary-workshop";

const skip = !databaseTestsEnabled;
const plannerEnv = { COMMONS_OPENAI_POLICY_ESCALATION_MODEL: "openai/test-planner-model" };
test("new dinner poll escapes selected itinerary, saves its questions, and leaves itinerary unchanged", { skip }, () => withCoordinatorScenario(async s => {
  const f = await start(s);
  s.next.reply = "You can now review it. I haven't drafted anything.";
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Where should we have dinner?", selectionMode: "single", options: [{ label: "Billy’s Tavern", description: null }, { label: "Becky’s House of Horrors", description: null }] }] };
  const request = f.command("Create a new poll asking the group to choose Billy’s Tavern or Becky’s House of Horrors for dinner.");
  const result = await s.post(request);
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  assert.equal(result.body.capability, "prepare_poll");
  assert.match(result.body.durableAnswer, /poll draft is ready/);
  assert.deepEqual(result.body.artifacts.map((item: {kind: string}) => item.kind), ["poll_draft"]);
  const thread = await s.thread(f.threadId);
  assert.equal(thread.drafts.length, 2);
  const created = thread.drafts.find((item: {id:string}) => item.id !== f.draft.id);
  assert.equal(created.data.questions.length, 1);
  assert.equal(created.data.questions[0].options[0].label, "Billy’s Tavern");
  assert.equal(created.threadId, f.threadId);
  const original = thread.drafts.find((item: {id:string}) => item.id === f.draft.id);
  assert.deepEqual(original.data, f.draft.data);
  assert.equal(original.version, f.draft.version);
  assert.equal(thread.polls.length, 0);
  await s.post(request);
  assert.equal((await s.thread(f.threadId)).drafts.length, 2, "retry cannot duplicate the poll");
}, { environment: plannerEnv }));
test("Prepare it now recovers a historical failed-to-draft conversation without editing its itinerary", { skip }, () => withCoordinatorScenario(async s => {
  const f = await start(s);
  for (const text of ["Create a poll for Billy’s Tavern or Becky’s House of Horrors", "Just that one", "Did you make it?"]) {
    const command = f.command(text, (await s.thread(f.threadId)).version);
    const begun = await beginCoordinatorTurn(s.trip.eventId, command, { ...f.options, provisionalTitle: "Synthetic dinner conversation" });
    await completeCoordinatorTurn(s.trip.eventId, { turnId: begun.turn.turnId, commandId: command.commandId, attempt: begun.turn.attempt,
      outcome: { status: "completed", assistantText: "I can prepare it, but have not created it.", spokenReply: "Not created yet.", sources: [], workspace: { tripConversation: true } } }, f.options);
  }
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Which dinner?", selectionMode: "single", options: [{ label: "Billy’s Tavern", description: null }, { label: "Becky’s House of Horrors", description: null }] }] };
  const result = await s.post(f.command("Prepare it now", (await s.thread(f.threadId)).version));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  assert.equal(result.body.capability, "prepare_poll");
  assert.match(JSON.stringify(s.network.providerCalls.at(-1)?.body.messages), /Billy’s Tavern/);
  const thread = await s.thread(f.threadId);
  assert.equal(thread.drafts.length, 2);
  assert.deepEqual(thread.drafts.find((d: {id:string}) => d.id === f.draft.id).data, f.data);
  assert.equal(thread.polls.length, 0);
}, { environment: plannerEnv }));
async function start(s: Parameters<Parameters<typeof withCoordinatorScenario>[0]>[0]) {
  const threadId = randomUUID();
  const started = await s.post(s.command({ target: { kind: "new", threadId }, text: "We want a relaxed weekend." }));
  assert.equal(started.body.status, "completed", JSON.stringify(started.body));
  const data = newItineraryDraft("Synthetic itinerary");
  const question = itineraryQuestion(data.questions)!;
  question.itinerary.days[0].label = "Friday";
  const mealId = randomUUID();
  question.itinerary.days[0].items = [{ id: mealId, title: "Dinner near the lodge", time: "7:00", details: "", kind: "meal", venue: "", status: "tentative" }];
  const options = { databaseUrl: process.env.TEST_DATABASE_URL!, actorPersonId: s.trip.organizerId, sharedCoordinator: true };
  const draft = await saveCommonsPollDraft(s.trip.eventId, { id: randomUUID(), threadId, commandId: randomUUID(), expectedVersion: 0, data }, options, { threadId });
  const command = (text: string, version = started.body.thread.turnVersion) => ({ commandId: randomUUID(), target: { kind: "existing", threadId, expectedTurnVersion: version }, inputMode: "text", text,
    artifact: { kind: "draft", id: draft.id, version: draft.version, selection: "thread_context" } });
  s.next.extra = { operations: [{ kind: "add_idea", title: "Yoga", details: "If it fits" }] };
  return { threadId, draft, data, options, command };
}
test("itinerary inference escalates, saves only a proposal, then applies explicitly with stable IDs; retry doesn't reinfer", { skip }, () => withCoordinatorScenario(async s => {
  const f = await start(s), calls = s.network.providerCalls.length, request = f.command("Add yoga as an optional idea");
  const result = await s.post(request);
  assert.equal(result.body.status, "completed", JSON.stringify(result.body)); assert.equal(result.body.reviewRequired, true);
  assert.ok(result.body.sources.every((source: {kind:string}) => source.kind === "trip_fact"), "excluded polls are not claimed as evidence");
  const call = s.network.providerCalls.at(-1)!;
  assert.equal(call.body.model, "test-planner-model");
  const payload = JSON.parse(call.body.messages!.at(-1)!.content);
  assert.equal(payload.tripContext.stays[0].name, "Synthetic Peak Lodge");
  assert.equal(payload.tripContext.polls, undefined); assert.equal(payload.tripContext.pendingProposalsNotApplied, undefined);
  assert.equal(payload.tripContext.budget.recordedExpenseTotalCents, undefined);
  const readDraft = () => withTestDatabase(async db => (await db.select().from(pollDrafts).where(eq(pollDrafts.id, f.draft.id)))[0]);
  assert.deepEqual((await readDraft()).data, f.draft.data, "provider completion did not apply a draft edit");
  assert.equal((await s.post(request)).body.turnId, result.body.turnId); assert.equal(s.network.providerCalls.length, calls + 1);
  await actOnCoordinatorWorkspace(s.trip.eventId, { threadId: f.threadId, turnId: result.body.turnId, commandId: randomUUID(), action: "apply" }, f.options);
  const applied = await readDraft(); assert.equal(applied.version, f.draft.version + 1);
  assert.equal(itineraryQuestion(applied.data.questions)!.itinerary.otherIdeas[0].title, "Yoga");
  assert.deepEqual(itineraryQuestion(applied.data.questions)!.itinerary.days, itineraryQuestion(f.data.questions)!.itinerary.days);
  assert.equal((await s.thread(f.threadId)).polls.length, 0, "application did not publish");
  const illegal = await s.post(f.command("Add a hike", result.body.thread.turnVersion));
  assert.equal(illegal.status, 409, "a stale draft cannot be inferred against");
}, { environment: plannerEnv }));
test("empty itinerary operations create no proposal or phantom artifact claim", { skip }, () => withCoordinatorScenario(async s => {
  const f = await start(s);
  s.next.extra = { operations: [] };
  s.next.reply = "Commons has prepared an itinerary beside this conversation.";
  const result = await s.post(f.command("Build a rough itinerary"));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  assert.equal(result.body.reviewRequired, false);
  assert.deepEqual(result.body.artifacts, []);
  assert.equal(result.body.saved.proposal, false);
  assert.doesNotMatch(result.body.durableAnswer, /has prepared an itinerary/);
  const read = await withTestDatabase(async db => (await db.select().from(pollDrafts).where(eq(pollDrafts.id, f.draft.id)))[0]);
  assert.equal(read.version, f.draft.version); assert.deepEqual(read.data, f.draft.data);
}, { environment: plannerEnv }));
test("context changes after inference invalidate approval; stale draft and non-organizer never apply", { skip }, () => withCoordinatorScenario(async s => {
  const f = await start(s), result = await s.post(f.command("Add yoga as an optional idea"));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  await withTestDatabase(db => db.update(commons).set({ startsOn: "2027-02-13", updatedAt: new Date(Date.now() + 1000) }).where(eq(commons.id, s.trip.eventId)));
  await assert.rejects(actOnCoordinatorWorkspace(s.trip.eventId, { threadId: f.threadId, turnId: result.body.turnId, commandId: randomUUID(), action: "apply" }, f.options));
  await assert.rejects(actOnCoordinatorWorkspace(s.trip.eventId, { threadId: f.threadId, turnId: result.body.turnId, commandId: randomUUID(), action: "apply" }, { ...f.options, actorPersonId: s.trip.travelerId }));
  const read = await withTestDatabase(async db => (await db.select().from(pollDrafts).where(eq(pollDrafts.id, f.draft.id)))[0]);
  assert.equal(read.version, f.draft.version); assert.deepEqual(read.data, f.draft.data);
  // Keep current is always possible, even when the proposal's context is old.
  await actOnCoordinatorWorkspace(s.trip.eventId, { threadId: f.threadId, turnId: result.body.turnId, commandId: randomUUID(), action: "dismiss" }, f.options);
}, { environment: plannerEnv }));
test("mid-inference roster change rejects completion without draft mutation; malformed model output is retryable failure", { skip }, () => withCoordinatorScenario(async s => {
  const f = await start(s), original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    if (String(args[0]).includes("api.openai.com")) await withTestDatabase(db => db.update(memberships).set({ attendanceState: "attending", updatedAt: new Date(Date.now() + 1000) }).where(eq(memberships.personId, s.trip.travelerId)));
    return original(...args);
  };
  try {
    const result = await s.post(f.command("Add yoga as an optional idea"));
    assert.equal(result.body.status, "failed", JSON.stringify(result.body)); assert.equal(result.body.error.code, "stale_version");
  } finally { globalThis.fetch = original; }
  s.next.extra = { operations: [{ kind: "update_item", itemId: randomUUID(), fields: { title: "Bogus", time: "", details: "", kind: "activity", venue: "" } }] };
  const latest = await s.thread(f.threadId);
  const invalid = await s.post(f.command("Move dinner", latest.version));
  assert.equal(invalid.body.status, "failed", JSON.stringify(invalid.body));
  assert.equal(invalid.body.error.code, "provider_failed");
  const read = await withTestDatabase(async db => (await db.select().from(pollDrafts).where(eq(pollDrafts.id, f.draft.id)))[0]);
  assert.deepEqual(read.data, f.draft.data);
}, { environment: plannerEnv }));

test("shared itinerary proposals include legacy flight basics but exclude the requesting organizer’s private ground booking", {skip},()=>withCoordinatorScenario(async s=>{
  const f=await start(s), flightId=randomUUID();
  await withTestDatabase(async db=>{
    await db.insert(travelPlans).values([
      {id:flightId,commonsId:s.trip.eventId,personId:s.trip.organizerId,kind:"arrival",date:"2027-02-12",route:"SHARED SFO FLIGHT",visibility:"private",confirmationCode:"PRIVATE FLIGHT CODE",totalCents:99000,sourceLabel:"QA"},
      {commonsId:s.trip.eventId,personId:s.trip.organizerId,kind:"car_rental",date:"2027-02-12",route:"PRIVATE RENTAL MARKER",visibility:"private",sourceLabel:"QA"},
    ]);
  });
  const result=await s.post(f.command("Build a rough itinerary around my flight"));
  assert.equal(result.body.status,"completed",JSON.stringify(result.body));
  const payload=JSON.stringify(s.network.providerCalls.at(-1)!.body);
  assert.match(payload,/SHARED SFO FLIGHT/);assert.doesNotMatch(payload,/PRIVATE RENTAL MARKER|PRIVATE FLIGHT CODE|99000/);
  await actOnCoordinatorWorkspace(s.trip.eventId,{threadId:f.threadId,turnId:result.body.turnId,commandId:randomUUID(),action:"apply"},f.options);
}, {environment:plannerEnv}));

const documentEnv = { ...plannerEnv, COMMONS_ASSISTANT_UI_ENABLED: "true" };
test("selected legacy itinerary chat edits commit the same private document and durable receipt, without Apply", {skip}, () => withCoordinatorScenario(async s => {
  const f=await start(s), q=itineraryQuestion(f.data.questions)!; const saturdayId=randomUUID(), firstId=randomUUID(), secondId=randomUUID();
  q.itinerary.days.push({id:saturdayId,label:"Saturday",description:"Optional outing",items:[{...q.itinerary.days[0].items[0],id:firstId,title:"Schramsberg option"},{...q.itinerary.days[0].items[0],id:secondId,title:"Second optional stop"}]});
  const direct=await saveCommonsPollDraft(s.trip.eventId,{id:f.draft.id,commandId:randomUUID(),expectedVersion:f.draft.version,data:{...f.data,communication:{heading:"Our trip",paragraphs:["Human paragraph before chat"],links:[]}}},f.options);
  s.next.extra={operations:[{kind:"remove_item",itemId:secondId},{kind:"update_opening",text:"UNRELATED MODEL DRIFT"}]};
  const request={...f.command("Simplify Saturday to the Schramsberg option"),artifact:{kind:"draft",id:direct.id,version:direct.version}};
  const response=await s.post(request);assert.equal(response.body.status,"completed",JSON.stringify(response.body));assert.match(response.body.durableAnswer,/Saved itinerary version 3/);assert.equal(response.body.reviewRequired,false);
  const reload=await withTestDatabase(async db=>(await db.select().from(pollDrafts).where(eq(pollDrafts.id,direct.id)))[0]);assert.equal(reload.version,3);assert.deepEqual(reload.data.communication?.paragraphs,["Human paragraph before chat"]);assert.deepEqual(itineraryQuestion(reload.data.questions)!.itinerary.days[0],q.itinerary.days[0]);assert.deepEqual(itineraryQuestion(reload.data.questions)!.itinerary.days[1].items.map(item=>item.id),[firstId]);
  const state=await s.thread(f.threadId);assert.equal(state.turns.at(-1).workspace.itineraryDocumentReceipt.documentId,direct.id);assert.equal(state.turns.at(-1).workspace.proposal,undefined);assert.ok(state.turns.every((turn:{workspace?:{itineraryDraft?:unknown}})=>!turn.workspace?.itineraryDraft));
  const calls=s.network.providerCalls.length;await s.post(request);assert.equal(s.network.providerCalls.length,calls);assert.equal((await readLegacyItineraryRevisions(s.trip.eventId,direct.id,f.options)).length,2);
  const retry=await saveCommonsPollDraft(s.trip.eventId,{id:f.draft.id,commandId:(await readLegacyItineraryRevisions(s.trip.eventId,direct.id,f.options)).find(row=>row.source==="human")!.commandId,expectedVersion:1,data:direct.data},f.options);assert.equal(retry.version,2,"exact retry returns its captured receipt after later chat");
  for(const table of [itineraryItems,travelPlans,tripTasks,polls])assert.equal((await withTestDatabase(db=>db.select().from(table).where(eq(table.commonsId,s.trip.eventId)))).length,0);
},{environment:documentEnv}));
test("late human edits fence legacy model completion and no save claim survives",{skip},()=>withCoordinatorScenario(async s=>{
  const f=await start(s), original=globalThis.fetch;let changed=false;
  globalThis.fetch=async(...args)=>{if(String(args[0]).includes("api.openai.com")&&!changed){changed=true;await saveCommonsPollDraft(s.trip.eventId,{id:f.draft.id,commandId:randomUUID(),expectedVersion:1,data:{...f.data,intro:"New human opening"}},f.options);}return original(...args);};
  try{const result=await s.post({...f.command("Add yoga as an optional idea"),artifact:{kind:"draft",id:f.draft.id,version:1}});assert.equal(result.body.status,"failed",JSON.stringify(result.body));assert.equal(result.body.error.code,"stale_version");assert.doesNotMatch(result.body.durableAnswer??"",/Saved itinerary|I.*saved/);}finally{globalThis.fetch=original;}
  const read=await withTestDatabase(async db=>(await db.select().from(pollDrafts).where(eq(pollDrafts.id,f.draft.id)))[0]);assert.equal(read.version,2);assert.equal(read.data.intro,"New human opening");assert.equal(itineraryQuestion(read.data.questions)!.itinerary.otherIdeas.length,0);
},{environment:documentEnv}));
