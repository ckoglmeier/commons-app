import test from "node:test";
import assert from "node:assert/strict";
import { commons, itineraryItems } from "@commons/database";
import { databaseTestsEnabled, eq, withTestDatabase, withCoordinatorScenario, type ScenarioContext } from "./coordinator-route-harness";
import {ACTUAL_LODGING_SEED,ACTUAL_LODGING_NAMES} from "../test-support/qa172-recovery-data";
const skip = !databaseTestsEnabled;
const EMPTY_SUGGESTION = {operations:[],budgetCents:null,startsOn:null,endsOn:null,locationName:null,stayId:null,stayName:null,stayAddress:null,stayStartsOn:null,stayEndsOn:null,stayTotalCents:null,stayBookingUrl:null,stayStatus:null,planId:null,planTitle:null,planStatus:null,planStartsOn:null,planStartsTime:null,planNote:null,planContactLabel:null};
async function start(s: ScenarioContext) {
  const first = await s.post(s.command({ text: "We are comparing Hotel A with two queen beds at $320 per room per night, Hotel B with a king at $480 per room per night, and Hotel C with a suite at $620 per room per night. Six travelers, three rooms, two nights. These are estimates; taxes and fees unknown." }));
  assert.equal(first.body.status, "completed"); return first.body.thread;
}
function choices(s: ScenarioContext, labels=["Hotel A","Hotel B","Hotel C"]) { s.next.extra = { operations: [{kind:"add_question",prompt:"Which option do you prefer?",selectionMode:"single",options:labels.map(label=>({label,description:null}))}] }; }
for(const enabled of ["false","true"]) test(`review recovery: actual transcript costs, poll and generic Thursday dinner scope (flags ${enabled})`,{skip},()=>withCoordinatorScenario(async s=>{
  const plan=await withTestDatabase(async db=>{
    await db.update(commons).set({startsOn:"2026-11-05",endsOn:"2026-11-07",timezone:"America/Los_Angeles"}).where(eq(commons.id,s.trip.eventId));
    return (await db.insert(itineraryItems).values({commonsId:s.trip.eventId,title:"QA — Welcome dinner",timezone:"America/Los_Angeles",startsAt:new Date("2026-11-06T03:30:00Z"),status:"planned",audience:"everyone",provenanceLabel:"Synthetic organizer"}).returning())[0];
  });
  let t=(await s.post(s.command({text:ACTUAL_LODGING_SEED}))).body.thread;
  const next=async(text:string)=>{const response=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text}));assert.equal(response.body.status,"completed",JSON.stringify(response.body));t=response.body.thread;return response.body;};
  s.next.extra={tripSuggestion:{...EMPTY_SUGGESTION,operations:["plan"],planId:`plan:${plan.id}`,planStatus:"confirmed"}};
  const pending=await next("Mark QA — Welcome dinner confirmed");assert.equal(pending.capability,"propose_trip_change");
  const proposed=(await s.thread(t.id)).turns.find((turn:{workspace?:{tripProposal?:unknown}})=>turn.workspace?.tripProposal)?.workspace.tripProposal;assert.ok(proposed);
  for(const text of ["Show me the cost breakdown per person","Format that cost breakdown in a table"]) {
    const calls=s.network.providerCalls.length;const response=await next(text);
    assert.equal(s.network.providerCalls.length,calls,"actual rates never fall back to model arithmetic");
    for(const amount of ["320","480","620"]) assert.match(response.durableAnswer,new RegExp(`\\$${amount} per person`));
    for(const amount of ["1,920","2,880","3,720"]) assert.match(response.durableAnswer,new RegExp(`\\$${amount} group total`));
  }
  choices(s,ACTUAL_LODGING_NAMES);const poll=await next("Create a lodging poll using the three options above");
  assert.equal(poll.artifacts.filter((a:{kind:string})=>a.kind==="poll_draft").length,1);
  const saved=await s.thread(t.id);const lodging=saved.drafts[0].data;
  assert.deepEqual(lodging.questions[0].options.map((o:{label:string})=>o.label),ACTUAL_LODGING_NAMES);
  for(const [index,amount] of ["320","480","620"].entries()) assert.match(lodging.questions[0].options[index].description,new RegExp(`\\$${amount} per person`));
  assert.match(lodging.questions[0].options[0].description,/two queen beds/);assert.match(lodging.questions[0].options[2].description,/king beds only/);
  s.next.extra={};await next("For Thursday welcome dinner, the two options are Billy’s Tavern and Becky’s House of Horrors.");
  choices(s,["Billy’s Tavern","Becky’s House of Horrors"]);s.next.extra.intro="Which restaurant should we choose for dinner on Friday?";
  const wrong=await next("Help me ask everyone which of these two dinner options they prefer.");
  assert.equal(wrong.artifacts.length,0);assert.match(wrong.durableAnswer,/contradicted a saved Plan date.*No poll was saved/);
  assert.equal((await s.thread(t.id)).drafts.length,1,"contradictory generic dinner wording cannot persist a poll");
  choices(s,["Billy’s Tavern","Becky’s House of Horrors"]);s.next.extra.intro="Which restaurant should we choose for dinner on Thursday? QA — Welcome dinner is Thursday, and our hike is Friday.";
  const correct=await next("Create a private dinner poll with the two options above for Thursday");
  assert.equal(correct.artifacts.filter((a:{kind:string})=>a.kind==="poll_draft").length,1);
  const after=await s.thread(t.id);assert.equal(after.drafts.length,2);assert.deepEqual(after.drafts[0].data,lodging);
  s.next.extra={};await next("Actually for lodging we need four rooms, three nights and eight travelers.");
  await next("QA Garden Resort has 9 rooms available and sleeps 12 people.");
  await next("Dinner is for 10 people.");
  const calls=s.network.providerCalls.length;const revisedCosts=await next("Show the lodging cost breakdown in a table");
  assert.equal(s.network.providerCalls.length,calls,"earlier source survives the full multi-artifact sequence");
  for(const amount of ["480","720","930"]) assert.match(revisedCosts.durableAnswer,new RegExp(`\\$${amount} per person`));
  choices(s,ACTUAL_LODGING_NAMES);const revised=await next("Create another lodging poll using the three options above");assert.equal(revised.artifacts.filter((a:{kind:string})=>a.kind==="poll_draft").length,1);
  const latest=await s.thread(t.id);assert.deepEqual(latest.drafts[0].data,lodging);assert.equal(latest.drafts.length,3);
  assert.deepEqual(latest.turns.find((turn:{workspace?:{tripProposal?:unknown}})=>turn.workspace?.tripProposal)?.workspace.tripProposal,proposed,"actual transcript never captures or replaces the unrelated pending plan review");
  for(const [index,amount] of ["480","720","930"].entries()) assert.match(latest.drafts[2].data.questions[0].options[index].description,new RegExp(`\\$${amount} per person`));
  const [unchanged]=await withTestDatabase(db=>db.select().from(itineraryItems).where(eq(itineraryItems.id,plan.id)));assert.deepEqual(unchanged,plan);
}, {environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_RECIPES_ENABLED:enabled,COMMONS_NATIVE_LODGING_ENABLED:enabled}}));
test("recovery: lodging construction receives bounded earlier context and persists one poll", {skip}, () => withCoordinatorScenario(async s => {
  const t = await start(s); choices(s);
  const cmd = s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text:"Create a lodging poll using the three options above"});
  const result = await s.post(cmd);
  assert.equal(result.body.status,"completed"); assert.equal(result.body.capability,"prepare_poll");
  assert.equal(result.body.artifacts.filter((a:{kind:string})=>a.kind==="poll_draft").length,1);
  const call = JSON.stringify(s.network.providerCalls.at(-1));
  assert.match(call,/two queen beds/); assert.match(call,/320/); assert.match(call,/Six travelers/);
  const saved=await s.thread(t.id);
  const options=saved.drafts[0].data.questions[0].options;
  assert.deepEqual(options.map((o:{label:string})=>o.label),["Hotel A","Hotel B","Hotel C"]);
  assert.match(options[0].description,/two queen beds/);
  for (const [index, amount] of ["320","480","620"].entries()) assert.match(options[index].description,new RegExp(`\\$${amount} per person`));
  const replay = await s.post(cmd); assert.equal(replay.body.turnId,result.body.turnId);
}, {environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_RECIPES_ENABLED:"false",COMMONS_NATIVE_LODGING_ENABLED:"false"}}));
for (const enabled of ["false","true"]) test(`recovery: pending plan remains intact through poll, costs and rediscovery (recipes/native ${enabled})`, {skip}, () => withCoordinatorScenario(async s => {
  const plan=await withTestDatabase(async db=>{
    await db.update(commons).set({startsOn:"2026-11-05",endsOn:"2026-11-07",timezone:"America/Los_Angeles"}).where(eq(commons.id,s.trip.eventId));
    return (await db.insert(itineraryItems).values({commonsId:s.trip.eventId,title:"Welcome dinner",timezone:"America/Los_Angeles",startsAt:new Date("2026-11-06T03:30:00Z"),status:"planned",audience:"everyone",provenanceLabel:"Synthetic organizer"}).returning())[0];
  });
  let t=await start(s);
  s.next.extra={tripSuggestion:{...EMPTY_SUGGESTION,operations:["plan"],planId:`plan:${plan.id}`,planStatus:"confirmed"}};
  const pending=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text:"Mark Welcome dinner confirmed"}));
  assert.equal(pending.body.capability,"propose_trip_change",JSON.stringify(pending.body));
  const before=await s.thread(t.id);const proposal=before.turns.find((turn:{workspace?:{tripProposal?:unknown}})=>turn.workspace?.tripProposal)?.workspace.tripProposal;
  assert.ok(proposal); t=pending.body.thread;
  choices(s);
  const poll=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text:"Create a lodging poll using the three options above"}));
  assert.equal(poll.body.capability,"prepare_poll");assert.equal(poll.body.artifacts.filter((a:{kind:string})=>a.kind==="poll_draft").length,1);t=poll.body.thread;
  assert.match(JSON.stringify(s.network.providerCalls.at(-1)),/Thursday/);
  for (const text of ["What is the per-person cost breakdown?","Format the cost breakdown in a table","Where's the poll?","Show it to me","Yes"]) {
    s.next.extra={tripSuggestion:{...EMPTY_SUGGESTION,operations:["plan"],planId:`plan:${plan.id}`,planNote:"Unauthorized note"}};
    const response=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text}));t=response.body.thread;
    assert.equal(response.body.status,"completed",JSON.stringify(response.body));
    assert.ok(!response.body.artifacts.some((a:{kind:string})=>a.kind==="trip_change_proposal"));
    if (/cost/.test(text)) for(const amount of ["320","480","620"]) assert.match(response.body.durableAnswer,new RegExp(`\\$${amount} per person`));
    if (text==="Where's the poll?" || text==="Show it to me") assert.ok(response.body.artifacts.some((a:{kind:string})=>a.kind==="poll_draft"),JSON.stringify(response.body));
  }
  const after=await s.thread(t.id);
  assert.equal(after.drafts.length,1);assert.deepEqual(after.turns.find((turn:{workspace?:{tripProposal?:unknown}})=>turn.workspace?.tripProposal)?.workspace.tripProposal,proposal);
  const [unchanged]=await withTestDatabase(db=>db.select().from(itineraryItems).where(eq(itineraryItems.id,plan.id)));
  assert.equal(unchanged.status,"planned");assert.equal(unchanged.startsAt?.toISOString(),"2026-11-06T03:30:00.000Z");
}, {environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_RECIPES_ENABLED:enabled,COMMONS_NATIVE_LODGING_ENABLED:enabled}}));
test("recovery: help-me ask and compound table/poll wording prepare rather than propose a plan", {skip}, () => withCoordinatorScenario(async s => {
  let t = await start(s);
  t=(await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text:"The two dinner options are Garden Bistro and Billy’s Tavern for Thursday welcome dinner."}))).body.thread;
  for(const text of ['Help me ask everyone which of these two dinner options they prefer.', '“Help me ask everyone which of these two dinner options they prefer.”', 'Format that in a table and then spin up a poll.']) {
    choices(s,["Garden Bistro","Billy’s Tavern"]); const r=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text}));
    assert.equal(r.body.capability,"prepare_poll",text); assert.equal(r.body.status,"completed"); assert.equal(r.body.artifacts.filter((a:{kind:string})=>a.kind==="poll_draft").length,1); t=r.body.thread;
    const saved=await s.thread(t.id);assert.deepEqual(saved.drafts.at(-1).data.questions[0].options.map((o:{label:string})=>o.label),["Garden Bistro","Billy’s Tavern"]);
  }
}, {environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_RECIPES_ENABLED:"false",COMMONS_NATIVE_LODGING_ENABLED:"false"}}));
test("recovery: yes consumes a visible poll offer once and missing-artifact discovery stays truthful", {skip}, () => withCoordinatorScenario(async s=>{
 s.next.reply="Want me to prepare a poll for the group?";
 let result=await s.post(s.command({text:"Should we ask the group which hotel they prefer?"}));let t=result.body.thread;
 assert.equal(result.body.capability,"answer");assert.equal(result.body.artifacts.length,0);
 choices(s);result=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text:"Yes"}));t=result.body.thread;
 assert.equal(result.body.capability,"prepare_poll");assert.equal((await s.thread(t.id)).drafts.length,1);
 s.next.extra={};s.next.reply="I prepared your poll.";
 result=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text:"Yes"}));
 assert.equal((await s.thread(t.id)).drafts.length,1);assert.equal(result.body.artifacts.length,0);
 const missing=await s.post(s.command({text:"Where's the poll?"}));assert.equal(missing.body.artifacts.length,0);assert.equal(missing.body.durableAnswer,"Here are the polls you’ve started for this trip.");
}, {environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_RECIPES_ENABLED:"false",COMMONS_NATIVE_LODGING_ENABLED:"false"}}));
test("tools: poll prepares a private artifact, task quick-adds, and book stays unavailable", {skip}, () => withCoordinatorScenario(async s=>{
 choices(s,["Garden","Bistro"]);
 const poll=await s.post(s.command({text:"/poll Which dinner: Garden or Bistro?"}));
 assert.equal(poll.body.status,"completed");assert.equal(poll.body.capability,"prepare_poll");assert.equal(poll.body.shared,false);
 s.next.extra={};
 const task=await s.post(s.command({text:"/task Check the restaurant opening hours"}));
 assert.equal(task.body.status,"completed",JSON.stringify(task.body));assert.equal(task.body.reviewRequired,false,JSON.stringify(task.body));
 const calls=s.network.providerCalls.length;
 const book=await s.post(s.command({text:"/book Hotel A for November 5–7"}));
 assert.equal(book.body.status,"completed");assert.equal(book.body.capability,"unsupported");assert.equal(book.body.artifacts.length,0);assert.equal(s.network.providerCalls.length,calls);assert.match(book.body.durableAnswer,/not connected.*Nothing has been booked or sent/);
}, {environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_RECIPES_ENABLED:"false",COMMONS_NATIVE_LODGING_ENABLED:"false"}}));

test("review recovery: realistic unparsed correction clarifies costs/poll and structured counts recover",{skip},()=>withCoordinatorScenario(async s=>{
 let t=(await s.post(s.command({text:ACTUAL_LODGING_SEED}))).body.thread;
 const next=async(text:string)=>{const r=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text}));t=r.body.thread;assert.equal(r.body.status,"completed",JSON.stringify(r.body));return r.body;};
 await next("Actually, only four of us are coming, sharing two rooms for two nights.");const calls=s.network.providerCalls.length;
 const costs=await next("Show the lodging cost breakdown");assert.equal(s.network.providerCalls.length,calls);assert.match(costs.durableAnswer,/total unknown/);assert.match(costs.durableAnswer,/provide.*room count/);assert.doesNotMatch(costs.durableAnswer,/\$1,920 group total|\$320 per person/);
 choices(s,ACTUAL_LODGING_NAMES);const blocked=await next("Create a lodging poll using the three options above");assert.equal(s.network.providerCalls.length,calls);assert.equal(blocked.artifacts.length,0);assert.match(blocked.durableAnswer,/confirm the room count/);assert.equal((await s.thread(t.id)).drafts.length,0);
 s.next.extra={};await next("Rooms: 2; Nights: 2; Travelers: 4");const corrected=await next("Show the lodging cost breakdown");for(const amount of ["320","480","620"]) assert.match(corrected.durableAnswer,new RegExp(`\\$${amount} per person`));
 choices(s,ACTUAL_LODGING_NAMES);const saved=await next("Create a lodging poll using the three options above");assert.equal(saved.artifacts.filter((a:{kind:string})=>a.kind==="poll_draft").length,1);
 const data=(await s.thread(t.id)).drafts[0].data;assert.match(data.questions[0].options[0].description,/2 rooms, 2 nights, 4 people/);assert.match(data.questions[0].options[0].description,/\$1,280 group total/);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_RECIPES_ENABLED:"false",COMMONS_NATIVE_LODGING_ENABLED:"false"}}));

test("review recovery: multiple dinners allow weekday polls and clarify ambiguous scope",{skip},()=>withCoordinatorScenario(async s=>{
 const plans=await withTestDatabase(async db=>{
  await db.update(commons).set({startsOn:"2026-11-05",endsOn:"2026-11-07",timezone:"America/Los_Angeles"}).where(eq(commons.id,s.trip.eventId));
  return db.insert(itineraryItems).values([{commonsId:s.trip.eventId,title:"QA — Welcome dinner",timezone:"America/Los_Angeles",startsAt:new Date("2026-11-06T03:30:00Z"),status:"planned",audience:"everyone",provenanceLabel:"Synthetic organizer"},{commonsId:s.trip.eventId,title:"QA — Farewell dinner",timezone:"America/Los_Angeles",startsAt:new Date("2026-11-07T03:30:00Z"),status:"planned",audience:"everyone",provenanceLabel:"Synthetic organizer"}]).returning();
 });
 let t=(await s.post(s.command({text:"Dinner options are Garden Bistro and Billy’s Tavern"}))).body.thread;
 const next=async(text:string,intro:string)=>{choices(s,["Garden Bistro","Billy’s Tavern"]);s.next.extra={...s.next.extra,intro};const r=await s.post(s.command({target:{kind:"existing",threadId:t.id,expectedTurnVersion:t.turnVersion},text}));t=r.body.thread;assert.equal(r.body.status,"completed",JSON.stringify(r.body));return r.body;};
 for(const day of ["Thursday","Friday"]) {const r=await next(`Create a dinner poll for ${day} using the two options above`,`Which restaurant for dinner on ${day}?`);assert.equal(r.artifacts.filter((a:{kind:string})=>a.kind==="poll_draft").length,1,JSON.stringify(r));}
 const unclear=await next("Create another dinner poll using the two options above","Which restaurant for dinner?");assert.equal(unclear.artifacts.length,0);assert.match(unclear.durableAnswer,/Which saved event/);
 const wrong=await next("Create a poll for Welcome dinner using the two options above","Which restaurant for dinner on Friday?");assert.equal(wrong.artifacts.length,0);assert.match(wrong.durableAnswer,/contradicted/);
 const all=await withTestDatabase(db=>db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,s.trip.eventId)));assert.deepEqual(all,plans);assert.equal((await s.thread(t.id)).drafts.length,2);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_RECIPES_ENABLED:"false",COMMONS_NATIVE_LODGING_ENABLED:"false"}}));

test("live finding: earlier supplied lodging estimates pass construction price guards, invented prices still fail",{skip},()=>withCoordinatorScenario(async s=>{
 const {readFile}=await import('node:fs/promises');const captured=JSON.parse(await readFile(new URL('../test-support/qa173-lodging-completion.json',import.meta.url),'utf8'));const reply=JSON.parse(captured.choices[0].message.content);
 let t=(await s.post(s.command({text:ACTUAL_LODGING_SEED}))).body.thread;
 s.next.extra=reply;const saved=await s.post(s.command({target:{kind:'existing',threadId:t.id,expectedTurnVersion:t.turnVersion},text:'Create a lodging poll using the three options above'}));
 assert.equal(saved.body.status,'completed',JSON.stringify(saved.body));assert.equal(saved.body.artifacts.filter((a:{kind:string})=>a.kind==='poll_draft').length,1);t=saved.body.thread;
 const snapshot=await s.thread(t.id);const draft=snapshot.drafts[0];assert.match(draft.data.questions[0].options[0].description,/\$1,920 group total/);assert.equal(snapshot.turns.at(-1).userText,'Create a lodging poll using the three options above','price context must not alter stored human instructions');
 s.next.extra={...reply,questions:reply.questions.map((q:{prompt:string})=>({...q,prompt:'Would you pay $999 for this stay?'}))};const invalid=await s.post(s.command({target:{kind:'existing',threadId:t.id,expectedTurnVersion:t.turnVersion},text:'Create another lodging poll using the options above'}));assert.equal(invalid.body.status,'failed');assert.equal((await s.thread(t.id)).drafts.length,1);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:'true',COMMONS_RECIPES_ENABLED:'false',COMMONS_NATIVE_LODGING_ENABLED:'false'}}));

test("poll rediscovery lists permitted trip drafts and shared polls, excluding unavailable and private records",{skip},()=>withCoordinatorScenario(async s=>{
 const {createCommonsPoll,pollDrafts,polls}=await import('@commons/database');const {randomUUID}=await import('node:crypto');
 choices(s,['Garden','Bistro']);const first=await s.post(s.command({text:'Create a dinner poll: Garden or Bistro'}));const dinner=(await s.thread(first.body.thread.id)).drafts[0];
 const published=await createCommonsPoll(s.trip.eventId,{...dinner.data,commandId:randomUUID(),draftId:dinner.id,draftVersion:dinner.version,publicationApproval:{approved:true,access:'link'}},{databaseUrl:process.env.TEST_DATABASE_URL!,actorPersonId:s.trip.organizerId,sharedCoordinator:true});
 choices(s,['Inn','Resort']);const second=await s.post(s.command({text:'Create a lodging poll: Inn or Resort'}));const lodging=(await s.thread(second.body.thread.id)).drafts[0];
 await withTestDatabase(db=>db.insert(pollDrafts).values({id:randomUUID(),lastCommandId:randomUUID(),lastCommandFingerprint:"0".repeat(64),commonsId:s.trip.eventId,ownerPersonId:s.trip.coOrganizerId,organizerShared:false,data:{...lodging.data,title:'Other organizer private legacy poll'}}));
 const calls=s.network.providerCalls.length;const current=await s.thread(first.body.thread.id);const result=await s.post(s.command({target:{kind:'existing',threadId:first.body.thread.id,expectedTurnVersion:current.version},text:'Where’s the poll?'}));
 assert.equal(result.body.status,'completed');assert.equal(result.body.durableAnswer,'Here are the polls you’ve started for this trip.');assert.equal(s.network.providerCalls.length,calls);
 const saved=await s.thread(first.body.thread.id);const refs=saved.turns.at(-1).workspace.pollDiscovery;assert.deepEqual(new Set(refs.map((r:{id:string})=>r.id)),new Set([published.id,lodging.id]));assert.ok(refs.some((r:{kind:string,id:string})=>r.kind==='poll'&&r.id===published.id));assert.ok(refs.some((r:{kind:string,id:string})=>r.kind==='draft'&&r.id===lodging.id));assert.ok(!JSON.stringify(refs).includes('private legacy'));
 await withTestDatabase(async db=>{await db.update(polls).set({status:'revoked'}).where(eq(polls.id,published.id));await db.update(pollDrafts).set({archivedAt:new Date()}).where(eq(pollDrafts.id,lodging.id));});
 const missing=await s.post(s.command({target:{kind:'existing',threadId:result.body.thread.id,expectedTurnVersion:result.body.thread.turnVersion},text:'Where’s the poll?'}));assert.equal(missing.body.durableAnswer,'There are no available saved polls for this trip.');assert.equal(missing.body.artifacts.length,0);assert.equal(s.network.providerCalls.length,calls);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:'true',COMMONS_RECIPES_ENABLED:'false',COMMONS_NATIVE_LODGING_ENABLED:'false'}}));

test('poll rediscovery pronouns do not hijack an itinerary follow-up',{skip},()=>withCoordinatorScenario(async s=>{
 choices(s,['Garden','Bistro']);let r=await s.post(s.command({text:'Create a dinner poll: Garden or Bistro'}));let t=r.body.thread;
 s.next.extra={};s.next.reply='Your itinerary remains unchanged.';r=await s.post(s.command({target:{kind:'existing',threadId:t.id,expectedTurnVersion:t.turnVersion},text:'What about our itinerary?'}));t=r.body.thread;
 const calls=s.network.providerCalls.length;r=await s.post(s.command({target:{kind:'existing',threadId:t.id,expectedTurnVersion:t.turnVersion},text:'Show it to me'}));assert.equal(r.body.status,'completed');assert.ok(!r.body.durableAnswer.includes('Here are the polls'));assert.equal(s.network.providerCalls.length,calls+1);assert.ok(!(await s.thread(t.id)).turns.at(-1).workspace?.pollDiscovery);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:'true'}}));

test('task command keeps for-coffee in its title and explicit third-party ownership stays guarded',{skip},()=>withCoordinatorScenario(async s=>{
 const calls=s.network.providerCalls.length;const result=await s.post(s.command({text:'/task Ask Kevin for coffee'}));assert.equal(result.body.status,'completed');assert.equal(result.body.reviewRequired,false);assert.ok(result.body.artifacts.some((a:{kind:string})=>a.kind==='trip_task_proposal'));
 const proposal=(await s.thread(result.body.thread.id)).turns.at(-1).workspace.taskProposal;assert.equal(proposal.task.title,'Ask Kevin for coffee');assert.equal(proposal.task.ownerPersonId,s.trip.organizerId);assert.equal(proposal.state,'applied');assert.equal(proposal.receipt.id,proposal.task.id);assert.equal(s.network.providerCalls.length,calls);
 for(const text of ['Create a task for Robin to check coffee','/task Check coffee; assigned to Robin','/task Check coffee; owner: Robin']) {const refused=await s.post(s.command({text}));assert.equal(refused.body.status,'completed');assert.equal(refused.body.artifacts.length,0);assert.match(refused.body.durableAnswer,/task editor/);}
 assert.equal(s.network.providerCalls.length,calls);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:'true'}}));


test('slash search keeps a public lodging ceiling without mutating selected itinerary or sending private context',{skip},()=>withCoordinatorScenario(async s=>{
 const result=await s.post(s.command({text:'/search Find me a hotel in texas under 200$'}));assert.equal(result.body.status,'completed',JSON.stringify(result.body));assert.equal(result.body.capability,'research');
 const query=s.network.tavilyCalls.filter(call=>call.path==='search').at(-1)!.body.query;assert.equal(query,'Find me a hotel in texas under 200$');
 const turn=(await s.thread(result.body.thread.id)).turns.at(-1);assert.equal(turn.workspace.research.query,query);assert.ok(!turn.workspace.itineraryDraft);assert.ok(!turn.workspace.proposal);assert.ok(!turn.workspace.tripProposal);
 assert.doesNotMatch(JSON.stringify(s.network.tavilyCalls),/Synthetic|Ridge|ABC123|620/);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:'true'}}));
