import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startRecipeRun, saveCommonsPollDraft, actOnCoordinatorWorkspace, beginCoordinatorTurn, completeCoordinatorTurn, pollDrafts, createCommonsPoll } from "@commons/database";
import { databaseTestsEnabled, withCoordinatorScenario, withTestDatabase, eq, jsonRequest } from "./coordinator-route-harness";
import { newItineraryDraft } from "../itinerary-workshop";
const skip=!databaseTestsEnabled;
const environment={COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_OPENAI_POLICY_ESCALATION_MODEL:"openai/test-planner-model"};
const exact="Create a NEW private restaurant poll titled “QA — Restaurant preferences — 2026-10-06 — release”. Ask which dinner option people prefer: Billy’s Tavern or Becky’s House of Horrors. Keep it in this conversation. Do not publish, send invitations, create tasks or change the itinerary or Plan.";
const recovery="Prepare that new restaurant poll now, using the two options I just provided. Keep it private.";
const introPrompt="Make this poll’s introduction shorter. Keep the two restaurant options unchanged. Do not create another poll or share it.";

test("a guided lodging Goal refines its own saved draft through the existing proposal and Apply flow", {skip}, () => withCoordinatorScenario(async s => {
 const options={databaseUrl:process.env.TEST_DATABASE_URL!,actorPersonId:s.trip.organizerId,sharedCoordinator:true,createPlanningGoal:true};
 const draftId=randomUUID(),runId=randomUUID();
 const properties=["House A","House B"].map((name,index)=>({id:randomUUID(),name,url:`https://example.com/${index}`,description:null,rooms:"Two twin rooms",beds:"separate_beds_available",pricing:{basis:"per_person",period:"stay",currency:"USD",minCents:null,maxCents:null,fees:"unknown"}}));
 const linked=await startRecipeRun(s.trip.eventId,{commandId:randomUUID(),runId,draftId,recipe:"lodging",properties},options) as {goalId:string};
 const { listCoordinatorGoals }=await import("@commons/database");
 const goal=(await listCoordinatorGoals(s.trip.eventId,options)).goals.find(value=>value.goalId===linked.goalId)!;
 const state=await s.thread(goal.threadId),draft=state.drafts.find((value:{id:string})=>value.id===draftId);
 assert.ok(draft,"the existing guided draft belongs to the Goal conversation");
 s.next.extra={intro:"Which house works for you?",message:null,operations:[]};s.next.reply="I shortened the introduction.";
 const request=s.command({target:{kind:"existing",threadId:goal.threadId,expectedTurnVersion:state.version},artifact:{kind:"draft",id:draftId,version:draft.version},text:"Shorten this poll’s introduction. Keep both houses, sleeping needs, dates and manual edits unchanged. Do not share it."});
 const response=await s.post(request);assert.equal(response.body.status,"completed",JSON.stringify(response.body));assert.equal(response.body.reviewRequired,true);
 const read=()=>withTestDatabase(async db=>(await db.select().from(pollDrafts).where(eq(pollDrafts.id,draftId)))[0]);
 assert.deepEqual((await read()).data,draft.data,"proposal alone changes nothing");
 const apply={threadId:goal.threadId,turnId:response.body.turnId,commandId:randomUUID(),action:"apply"};
 await actOnCoordinatorWorkspace(s.trip.eventId,apply,options);
 const saved=await read();assert.equal(saved.data.intro,"Which house works for you?");assert.deepEqual(saved.data.questions,draft.data.questions);assert.deepEqual(saved.data.recipeContext,draft.data.recipeContext);
 assert.equal(saved.runId,runId);assert.equal(saved.publishedPollId,null);assert.equal((await s.thread(goal.threadId)).drafts.length,1);
 const reviewRoute=await import("../../app/api/v1/commons/[slug]/reviews/[draftId]/route");
 const undo=(version:number)=>reviewRoute.POST(jsonRequest(s.trip.eventId,"","POST",{action:"undo",version}),{params:Promise.resolve({slug:s.trip.eventId,draftId})});
 assert.equal((await undo(saved.version-1)).status,409,"a stale Undo cannot replace a newer version");
 assert.equal((await undo(saved.version)).status,200);
 const undone=await read();assert.equal(undone.data.intro,draft.data.intro);assert.deepEqual(undone.data.questions,draft.data.questions);assert.deepEqual(undone.data.recipeContext,draft.data.recipeContext);
 s.next.extra={intro:null,message:null,operations:[{kind:"add_optional_question",prompt:"Extra question",selectionMode:"single",options:[{label:"Yes",description:null},{label:"No",description:null}]}]};
 const current=await s.thread(goal.threadId);
 const structural=await s.post(s.command({target:{kind:"existing",threadId:goal.threadId,expectedTurnVersion:current.version},artifact:{kind:"draft",id:draftId,version:undone.version},text:"Add another optional question to this poll."}));
 assert.equal(structural.body.status,"completed",JSON.stringify(structural.body));assert.equal(structural.body.reviewRequired,false,JSON.stringify(structural.body));
 assert.match(structural.body.durableAnswer,/saved editor.*saved poll is unchanged/);
 assert.deepEqual((await read()).data,undone.data,"unsupported typed edits provide recovery without changing the saved poll");
}, {environment}));
type Scenario=Parameters<Parameters<typeof withCoordinatorScenario>[0]>[0];
async function setup(s:Scenario){
 const threadId=randomUUID();const begun=await s.post(s.command({target:{kind:"new",threadId},text:"Let's discuss the itinerary."}));
 const options={databaseUrl:process.env.TEST_DATABASE_URL!,actorPersonId:s.trip.organizerId,sharedCoordinator:true};
 const itinerary=newItineraryDraft("QA — Selected itinerary");
 const original=await saveCommonsPollDraft(s.trip.eventId,{id:randomUUID(),threadId,commandId:randomUUID(),expectedVersion:0,data:itinerary},options,{threadId});
 const command=async(text:string,draft=original)=>({commandId:randomUUID(),target:{kind:"existing" as const,threadId,expectedTurnVersion:(await s.thread(threadId)).version},text,inputMode:"text" as const,artifact:{kind:"draft" as const,id:draft.id,version:draft.version}});
 return {threadId,options,original,command,begun};
}
function dinner(s:Scenario){
 s.next.reply="I created and published everything.";
 s.next.extra={title:"QA — Restaurant preferences — 2026-10-06 — release",intro:"Which of these dinner choices would you prefer for our trip?",message:{heading:"Dinner preferences",paragraphs:["Delivery message stays unchanged."]},operations:[{kind:"add_question",prompt:"Which dinner?",selectionMode:"single",options:[{label:"Billy’s Tavern",description:null},{label:"Becky’s House of Horrors",description:null}]}]};
}
test("exact live request with itinerary selected commits one populated private poll; natural recovery reuses it",{skip},()=>withCoordinatorScenario(async s=>{
 const f=await setup(s);dinner(s);
 const request=await f.command(exact);const created=await s.post(request);
 assert.equal(created.body.status,"completed",JSON.stringify(created.body));assert.equal(created.body.artifacts.length,1);
 const state=await s.thread(f.threadId),poll=state.drafts.find((d:{id:string})=>d.id!==f.original.id);
 assert.ok(poll);assert.equal(poll.data.questions.length,1);assert.equal(poll.data.questions[0].options.length,2);
 assert.deepEqual(state.drafts.find((d:{id:string})=>d.id===f.original.id).data,f.original.data);assert.equal(state.polls.length,0);
 const calls=s.network.providerCalls.length;
 const replay=await s.post(request);assert.equal(replay.body.turnId,created.body.turnId);
 const reuse=await s.post(await f.command(recovery));assert.equal(reuse.body.status,"completed",JSON.stringify(reuse.body));
 assert.deepEqual(reuse.body.artifacts.map((a:{id:string})=>a.id),[poll.id]);assert.equal(reuse.body.reviewRequired,false);
 assert.match(reuse.body.durableAnswer,/No second poll/);assert.equal(s.network.providerCalls.length,calls);
 assert.equal((await s.thread(f.threadId)).drafts.length,2);
},{environment}));
test("exact recovery after historical failure reconstructs human choices without mutating selected itinerary",{skip},()=>withCoordinatorScenario(async s=>{
 const f=await setup(s),request=await f.command(exact);
 const begun=await beginCoordinatorTurn(s.trip.eventId,request,{...f.options,provisionalTitle:"Recovery"});
 await completeCoordinatorTurn(s.trip.eventId,{turnId:begun.turn.turnId,commandId:request.commandId,attempt:begun.turn.attempt,outcome:{status:"completed",assistantText:"I haven’t drafted, prepared or started anything with this reply.",spokenReply:"No draft yet.",sources:[],workspace:{tripConversation:true}}},f.options);
 dinner(s);const recovered=await s.post(await f.command(recovery));assert.equal(recovered.body.status,"completed",JSON.stringify(recovered.body));
 assert.match(JSON.stringify(s.network.providerCalls.at(-1)?.body.messages),/Billy’s Tavern/);
 const state=await s.thread(f.threadId);assert.equal(state.drafts.length,2);assert.deepEqual(state.drafts.find((d:{id:string})=>d.id===f.original.id).data,f.original.data);assert.equal(state.polls.length,0);
},{environment}));
test("introduction-only edit rejects drift, stays pending, supports reject/apply and preserves options/delivery",{skip},()=>withCoordinatorScenario(async s=>{
 const f=await setup(s);dinner(s);await s.post(await f.command(exact));
 let state=await s.thread(f.threadId);const poll=state.drafts.find((d:{id:string})=>d.id!==f.original.id);
 const read=()=>withTestDatabase(async db=>(await db.select().from(pollDrafts).where(eq(pollDrafts.id,poll.id)))[0]);
 s.next.extra={intro:null,message:{heading:"Wrong field",paragraphs:["Wrong"]},operations:[]};s.next.reply="I shortened the introduction.";
 const wrong=await s.post(await f.command(introPrompt,poll));assert.equal(wrong.body.status,"failed",JSON.stringify(wrong.body));assert.deepEqual((await read()).data,poll.data);
 s.next.extra={intro:"Choose your dinner preference.",message:null,operations:[]};
 const proposed=await s.post(await f.command(introPrompt,poll));assert.equal(proposed.body.status,"completed",JSON.stringify(proposed.body));
 assert.match(proposed.body.durableAnswer,/proposed.*Poll introduction/i);assert.match(proposed.body.durableAnswer,/saved poll is unchanged/);assert.doesNotMatch(proposed.body.durableAnswer,/I shortened/);
 assert.equal(proposed.body.reviewRequired,true);assert.deepEqual((await read()).data,poll.data);
 await actOnCoordinatorWorkspace(s.trip.eventId,{threadId:f.threadId,turnId:proposed.body.turnId,commandId:randomUUID(),action:"dismiss"},f.options);
 assert.deepEqual((await read()).data,poll.data);
 const again=await s.post(await f.command(introPrompt,poll));assert.equal(again.body.status,"completed",JSON.stringify(again.body));
 await actOnCoordinatorWorkspace(s.trip.eventId,{threadId:f.threadId,turnId:again.body.turnId,commandId:randomUUID(),action:"apply"},f.options);
 const saved=await read();assert.equal(saved.version,poll.version+1);assert.equal(saved.data.intro,"Choose your dinner preference.");
 assert.deepEqual(saved.data.questions,poll.data.questions);assert.deepEqual(saved.data.communication,poll.data.communication);
 state=await s.thread(f.threadId);assert.equal(state.polls.length,0);assert.deepEqual(state.drafts.find((d:{id:string})=>d.id===f.original.id).data,f.original.data);
},{environment}));
test("review request points directly to saved private poll Work without inference or mutation",{skip},()=>withCoordinatorScenario(async s=>{
 const f=await setup(s);dinner(s);await s.post(await f.command(exact));const state=await s.thread(f.threadId),poll=state.drafts.find((d:{id:string})=>d.id!==f.original.id),calls=s.network.providerCalls.length;
 const review=await s.post(await f.command("Where can I review this poll?",poll));assert.equal(review.body.status,"completed",JSON.stringify(review.body));
 assert.match(review.body.durableAnswer,/Review the saved poll.*in Work/);assert.deepEqual(review.body.artifacts.map((a:{id:string})=>a.id),[poll.id]);assert.equal(s.network.providerCalls.length,calls);assert.equal((await s.thread(f.threadId)).drafts.length,2);
 s.next.reply="There are no saved flight times in this test trip."; s.next.extra={};
 const mixed=await s.post(await f.command("Where can I review this poll, and what are our saved flight times?",poll));
 assert.equal(mixed.body.status,"completed",JSON.stringify(mixed.body));
 assert.match(mixed.body.durableAnswer,/no saved flight times.*Review the saved poll.*in Work/is);
 assert.deepEqual(mixed.body.artifacts.map((a:{id:string})=>a.id),[poll.id]);
 assert.equal(s.network.providerCalls.length,calls+1,"facts use grounded retrieval; destination is application-owned");
 assert.deepEqual((await s.thread(f.threadId)).drafts.find((d:{id:string})=>d.id===poll.id).data,poll.data);
},{environment}));


test("published poll deep link resolves its owning conversation without a thread query", { skip }, () => withCoordinatorScenario(async s => {
  const f = await setup(s); dinner(s);
  const created = await s.post(await f.command(exact));
  const saved = (await s.thread(f.threadId)).drafts.find((draft: {id:string}) => draft.id === created.body.artifacts[0].id);
  const poll = await createCommonsPoll(s.trip.eventId, { ...saved.data, commandId: randomUUID(), draftId: saved.id, draftVersion: saved.version, publicationApproval: { approved: true, access: "invitees" } }, f.options);
  const { loadCommonsSnapshot } = await import("./commons");
  const { tripCoordinator } = await import("./trip-coordinator");
  const snapshot = await loadCommonsSnapshot(s.trip.eventId); assert.ok(snapshot);
  const workspace = await tripCoordinator(snapshot, { poll: poll.id });
  assert.equal(workspace.initialThread.activeThreadId, f.threadId);
  assert.equal(workspace.initialPollId, poll.id);
  assert.equal(workspace.initialDraftId, undefined);
  assert.ok(workspace.initialThread.drafts.some(draft => draft.publishedPollId === poll.id));
}, { environment: { ...environment, COMMONS_INVITATION_TOKEN_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } }));

test("poll Work references fail closed for missing, stale, itinerary and cross-thread artifacts", { skip }, () => withCoordinatorScenario(async s => {
  const f = await setup(s); dinner(s);
  const created = await s.post(await f.command(exact));
  const saved = (await s.thread(f.threadId)).drafts.find((draft: {id:string}) => draft.id === created.body.artifacts[0].id);
  const otherThread = randomUUID();
  await s.post(s.command({ target: { kind: "new", threadId: otherThread }, text: "Discuss other dinner plans." }));
  const other = await saveCommonsPollDraft(s.trip.eventId, { id: randomUUID(), threadId: otherThread, commandId: randomUUID(), expectedVersion: 0, data: saved.data }, f.options, { threadId: otherThread });
  for (const [draftId, version, code] of [[randomUUID(), 1, "artifact_misassociated"], [saved.id, saved.version + 1, "stale_version"], [f.original.id, f.original.version, "artifact_misassociated"], [other.id, other.version, "artifact_misassociated"]] as const) {
    const command = await f.command("Review the poll.");
    const begun = await beginCoordinatorTurn(s.trip.eventId, command, { ...f.options, provisionalTitle: "Review poll" });
    const failed = await completeCoordinatorTurn(s.trip.eventId, { turnId: begun.turn.turnId, commandId: command.commandId, attempt: begun.turn.attempt, outcome: { status: "completed", assistantText: "Review in Work.", spokenReply: "Review in Work.", sources: [], workspace: { tripConversation: true, pollReview: { draftId, version } } } }, f.options);
    assert.equal(failed.status, "failed"); assert.equal(failed.errorCode, code);
  }
  assert.deepEqual((await s.thread(f.threadId)).drafts.find((draft: {id:string}) => draft.id === saved.id).data, saved.data);
}, { environment }));


for (const [prompt, title, labels] of [
  ["Create a new private restaurant poll: Billy’s Tavern or Becky’s House of Horrors. Do not create tasks.", "Restaurant preferences", ["Billy’s Tavern", "Becky’s House of Horrors"]],
  ["Create a new lodging poll with Hotel A and Hotel B.", "Lodging preferences", ["Hotel A", "Hotel B"]],
  ["Please create a new private dates poll. Ask whether November 5 or November 12 works. Do not create itinerary items.", "Date preferences", ["November 5", "November 12"]],
  ["Build a new trip attendance poll with Attending and Not attending. Keep it private; do not send invitations or add travelers.", "Attendance preferences", ["Attending", "Not attending"]]
] as const) test(`independent review: ${title} creates one private poll with itinerary selected`, { skip }, () => withCoordinatorScenario(async s => {
  const f=await setup(s);
  s.next.reply="I created and shared the poll.";
  s.next.extra={title,operations:[{kind:"add_question",prompt:title,selectionMode:"single",options:labels.map(label=>({label,description:null}))}]};
  const command=await f.command(prompt), result=await s.post(command);
  assert.equal(result.body.status,"completed",JSON.stringify(result.body)); assert.equal(result.body.artifacts.length,1);
  const state=await s.thread(f.threadId), saved=state.drafts.find((draft:{id:string})=>draft.id===result.body.artifacts[0].id);
  assert.ok(saved); assert.notEqual(saved.id,f.original.id); assert.equal(saved.data.questions.length,1);
  assert.deepEqual(saved.data.questions[0].options.map((option:{label:string})=>option.label),[...labels]);
  assert.equal(saved.publishedPollId,null); assert.equal(state.polls.length,0); assert.equal(state.drafts.length,2);
  assert.deepEqual(state.drafts.find((draft:{id:string})=>draft.id===f.original.id).data,f.original.data);
  assert.deepEqual((await s.post(command)).body.artifacts.map((artifact:{id:string})=>artifact.id),[saved.id]);
  assert.equal((await s.thread(f.threadId)).drafts.length,2,"retry does not duplicate construction");
  assert.match(result.body.durableAnswer,/ready to review in Work.*Nothing has been shared or sent/);
  const context=JSON.parse(s.network.providerCalls.at(-1)!.body.messages!.at(-1)!.content);
  assert.ok(context.conversation.every((entry:{role:string})=>entry.role==="user"));
  assert.ok(context.conversation.length<=6); assert.deepEqual(context.priorPolls,[]);
  assert.equal(context.tripContext.selectedReadOnlyDraft,undefined,"unreferenced selected artifacts cannot leak old question instructions");
  assert.deepEqual(context.conversation,[]);assert.deepEqual(context.tripContext.conversations,[]);assert.deepEqual(context.tripContext.pendingProposalsNotApplied,[]);
}, { environment }));

test("independent review: cancelled, quoted and deferred named polls do not create artifacts with itinerary selected", { skip }, () => withCoordinatorScenario(async s => {
  const f=await setup(s); s.next.extra={}; s.next.reply="Nothing has been created.";
  for(const prompt of ["Create a new lodging poll. Do not create the poll.","Create a new lodging poll. Cancel that lodging poll.","Robin said: Create a new lodging poll.","“Create a new dates poll” was Robin’s suggestion.","Create a new attendance poll later."]){
    const result=await s.post(await f.command(prompt)); assert.equal(result.body.status,"completed",JSON.stringify(result.body));
    assert.deepEqual(result.body.artifacts,[],prompt);
    const state=await s.thread(f.threadId); assert.equal(state.drafts.length,1); assert.equal(state.polls.length,0);
    assert.deepEqual(state.drafts[0].data,f.original.data,prompt);
  }
}, { environment }));

test("independent review: editing a named existing poll proposes against that draft without creating another", { skip }, () => withCoordinatorScenario(async s => {
  const f=await setup(s); dinner(s); const created=await s.post(await f.command("Create a new lodging poll with Hotel A and Hotel B."));
  const saved=(await s.thread(f.threadId)).drafts.find((draft:{id:string})=>draft.id===created.body.artifacts[0].id);
  s.next.extra={title:null,intro:"Choose your lodging preference.",message:null,operations:[]}; s.next.reply="I shortened the poll.";
  const edit=await s.post(await f.command("Make the lodging poll introduction shorter.",saved));
  assert.equal(edit.body.status,"completed",JSON.stringify(edit.body)); assert.equal(edit.body.reviewRequired,true);
  assert.match(edit.body.durableAnswer,/proposed.*poll introduction/i);
  const state=await s.thread(f.threadId); assert.equal(state.drafts.length,2); assert.equal(state.polls.length,0);
  assert.deepEqual(state.drafts.find((draft:{id:string})=>draft.id===saved.id).data,saved.data,"edit is pending, not saved");
  assert.deepEqual(state.drafts.find((draft:{id:string})=>draft.id===f.original.id).data,f.original.data);
}, { environment }));


test("returning to an older private poll cannot recover the newer poll by an ambiguous pointer", { skip }, () => withCoordinatorScenario(async s => {
  const f=await setup(s); dinner(s);
  s.next.extra={title:"Lodging",operations:[{kind:"add_question",prompt:"Which hotel?",selectionMode:"single",options:[{label:"Hotel A",description:null},{label:"Hotel B",description:null}]}]};
  const first=await s.post(await f.command("Create a new lodging poll with Hotel A and Hotel B."));
  const lodging=(await s.thread(f.threadId)).drafts.find((draft:{id:string})=>draft.id===first.body.artifacts[0].id);
  s.next.extra={title:"Dates",operations:[{kind:"add_question",prompt:"Which date?",selectionMode:"single",options:[{label:"November 5",description:null},{label:"November 12",description:null}]}]};
  const second=await s.post(await f.command("Create a new dates poll with November 5 and November 12."));
  const datesId=second.body.artifacts[0].id;
  s.next.extra={};s.next.reply="The selected poll remains available for review.";
  const pointer=await s.post(await f.command("Prepare it now.",lodging)); assert.equal(pointer.body.status,"completed",JSON.stringify(pointer.body));
  assert.deepEqual(pointer.body.artifacts,[],"a pointer to the current older poll cannot open the unrelated latest receipt");
  const named=await s.post(await f.command("Prepare that new dates poll now with those choices. Keep it private.",lodging));
  assert.equal(named.body.status,"completed",JSON.stringify(named.body));assert.deepEqual(named.body.artifacts.map((artifact:{id:string})=>artifact.id),[datesId]);
  const state=await s.thread(f.threadId); assert.equal(state.drafts.length,3);assert.equal(state.polls.length,0);
  assert.deepEqual(state.drafts.find((draft:{id:string})=>draft.id===lodging.id).data,lodging.data);
  assert.deepEqual(state.drafts.find((draft:{id:string})=>draft.id===f.original.id).data,f.original.data);
}, { environment }));


test("empty provider construction asks or fails honestly without saving an empty artifact; human recovery can build once", { skip }, () => withCoordinatorScenario(async s => {
  const f=await setup(s);
  for (const reply of ["What question should the group answer?", "I prepared your lodging poll for review."]) {
    s.next.reply=reply; s.next.extra={title:"Lodging poll",operations:[]};
    const result=await s.post(await f.command("Create a new lodging poll with Hotel A and Hotel B."));
    assert.equal(result.body.status,"completed",JSON.stringify(result.body)); assert.deepEqual(result.body.artifacts,[]);
    assert.match(result.body.durableAnswer,/Nothing was saved or shared/); assert.doesNotMatch(result.body.durableAnswer,/I prepared/);
    const state=await s.thread(f.threadId); assert.equal(state.drafts.length,1); assert.deepEqual(state.drafts[0].data,f.original.data);
  }
  s.next.reply="Proposed lodging choices."; s.next.extra={title:"Lodging poll",operations:[{kind:"add_question",prompt:"Which hotel?",selectionMode:"single",options:[{label:"Hotel A",description:null},{label:"Hotel B",description:null}]}]};
  const recovered=await s.post(await f.command("Prepare that new lodging poll now with those choices. Keep it private."));
  assert.equal(recovered.body.artifacts.length,1); const state=await s.thread(f.threadId); assert.equal(state.drafts.length,2);
  const saved=state.drafts.find((draft:{id:string})=>draft.id===recovered.body.artifacts[0].id);
  assert.deepEqual(saved.data.questions[0].options.map((option:{label:string})=>option.label),["Hotel A","Hotel B"]);
  assert.match(JSON.stringify(s.network.providerCalls.at(-1)?.body.messages),/Hotel A and Hotel B/);
}, { environment }));

test("legacy empty poll recovery proposes questions against the same artifact instead of calling it ready or duplicating it", { skip }, () => withCoordinatorScenario(async s => {
  const f=await setup(s),request=await f.command("Create a new lodging poll with Hotel A and Hotel B.");
  const begun=await beginCoordinatorTurn(s.trip.eventId,request,{...f.options,provisionalTitle:"Lodging"});
  const legacy=await completeCoordinatorTurn(s.trip.eventId,{turnId:begun.turn.turnId,commandId:request.commandId,attempt:begun.turn.attempt,outcome:{status:"completed",assistantText:"Needs questions.",spokenReply:"Needs questions.",sources:[],newDraft:{id:randomUUID(),data:{title:"Lodging poll",intro:null,ballotMode:"transparent",settledFacts:"",presentationVersion:2,questions:[],communication:{heading:"Lodging poll",paragraphs:["Choose a hotel."],links:[]}}},workspace:{capability:"prepare_poll"}}},f.options);
  assert.equal(legacy.status,"completed",JSON.stringify(legacy));
  const empty=(await s.thread(f.threadId)).drafts.find((draft:{id:string})=>draft.id===legacy.draftId);
  assert.ok(empty);
  const open=await s.post(await f.command("Prepare that new lodging poll now with those choices. Keep it private."));
  assert.equal(open.body.status,"completed",JSON.stringify(open.body)); assert.equal(open.body.reviewRequired,false);
  assert.deepEqual(open.body.artifacts.map((artifact:{id:string})=>artifact.id),[empty.id]); assert.match(open.body.durableAnswer,/still needs questions/);
  assert.equal((await s.thread(f.threadId)).drafts.length,2);
  s.next.reply="I created the poll."; s.next.extra={title:null,operations:[{kind:"add_question",prompt:"Which hotel?",selectionMode:"single",options:[{label:"Hotel A",description:null},{label:"Hotel B",description:null}]}]};
  const recovered=await s.post(await f.command("Prepare that new lodging poll now with those choices. Keep it private.",empty));
  assert.equal(recovered.body.status,"completed",JSON.stringify(recovered.body)); assert.equal(recovered.body.reviewRequired,true);
  assert.match(recovered.body.durableAnswer,/proposed an edit/); assert.doesNotMatch(recovered.body.durableAnswer,/ready in Work/);
  const state=await s.thread(f.threadId); assert.equal(state.drafts.length,2); assert.deepEqual(state.drafts.find((draft:{id:string})=>draft.id===empty.id).data,empty.data);
  await actOnCoordinatorWorkspace(s.trip.eventId,{threadId:f.threadId,turnId:recovered.body.turnId,commandId:randomUUID(),action:"apply"},f.options);
  const applied=(await s.thread(f.threadId)).drafts.find((draft:{id:string})=>draft.id===empty.id);
  assert.equal(applied.version,empty.version+1); assert.deepEqual(applied.data.questions[0].options.map((option:{label:string})=>option.label),["Hotel A","Hotel B"]);
}, { environment }));


test("a provider cannot save a choice placeholder in place of an explicitly requested optional written question", { skip }, () => withCoordinatorScenario(async s => {
  const f=await setup(s);s.next.reply="Your poll is ready.";
  s.next.extra={operations:[{kind:"add_optional_question",prompt:"Suggestions?",selectionMode:"single",options:[{label:"Free text response",description:null},{label:"Write your suggestions here",description:null}]}]};
  const result=await s.post(await f.command("Create a new private poll. Include exactly one question: an optional written suggestions question."));
  assert.equal(result.body.status,"completed",JSON.stringify(result.body));assert.deepEqual(result.body.artifacts,[]);assert.match(result.body.durableAnswer,/requested question structure.*No poll was saved or shared/);
  const state=await s.thread(f.threadId);assert.equal(state.drafts.length,1);assert.deepEqual(state.drafts[0].data,f.original.data);
}, { environment }));


test("explicitly referenced selected source remains read-only input for a separate private poll", { skip }, () => withCoordinatorScenario(async s => {
  const f=await setup(s);dinner(s);
  const result=await s.post(await f.command("Create a new private poll using the selected itinerary. Do not change that itinerary."));
  assert.equal(result.body.status,"completed",JSON.stringify(result.body));
  const context=JSON.parse(s.network.providerCalls.at(-1)!.body.messages!.at(-1)!.content);
  assert.deepEqual(context.conversation,[]);assert.equal(context.tripContext.selectedReadOnlyDraft.title,f.original.data.title);
  assert.deepEqual(context.tripContext.selectedReadOnlyDraft.questions,f.original.data.questions);
  assert.deepEqual((await s.thread(f.threadId)).drafts.find((draft:{id:string})=>draft.id===f.original.id).data,f.original.data);
}, { environment }));
