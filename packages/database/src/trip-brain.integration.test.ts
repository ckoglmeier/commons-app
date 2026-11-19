import test from "node:test";import assert from "node:assert/strict";import {randomUUID} from "node:crypto";import {eq} from "drizzle-orm";
import {runBoundedBrainReview} from "./trip-brain-executor";
import {createDatabase} from "./client";import {beginBrainReview,finishBrainReview,brainState,configureLocalBrain,updateBrainSettings,disposeBrainRecommendation} from "./trip-brain-repository";import {deterministicBrainReview} from "@commons/domain";import {commons,memberships,people,itineraryItems,travelPlans,tripBrainSettings,tripBrainReviews,coordinatorGoals,tripTasks} from "./schema";
const skip=process.env.COMMONS_RUN_DATABASE_TESTS!=="1",databaseUrl=process.env.TEST_DATABASE_URL;
async function scenario(fn:(f:Awaited<ReturnType<typeof fixture>>)=>Promise<void>){const f=await fixture();try{await fn(f);}finally{await f.db.db.delete(commons).where(eq(commons.id,f.trip));await f.db.db.delete(people).where(eq(people.id,f.owner));await f.db.db.delete(people).where(eq(people.id,f.member));await f.db.close();}}
async function fixture(){assert.ok(databaseUrl&&new URL(databaseUrl).hostname==="127.0.0.1");const db=createDatabase(databaseUrl),trip=randomUUID(),owner=randomUUID(),member=randomUUID();await db.db.insert(people).values([{id:owner,displayName:"Synthetic Organizer"},{id:member,displayName:"Private Traveler"}]);await db.db.insert(commons).values({id:trip,slug:`brain-${trip}`,name:"Synthetic review trip",timezone:"America/Denver",startsOn:"2026-10-05",endsOn:"2026-10-10",createdByPersonId:owner});await db.db.insert(memberships).values([{commonsId:trip,personId:owner,role:"organizer",status:"active"},{commonsId:trip,personId:member,role:"member",status:"active"}]);const now=new Date("2026-10-01T20:00:00Z"),options={databaseUrl,actorPersonId:owner,enabled:true,now,researchAvailable:false};const config=async(budgetCents=0)=>{await configureLocalBrain(trip,{budgetCents,entitled:true},options);await updateBrainSettings(trip,{commandId:randomUUID(),optedIn:true,paused:false},options);};const plans=async()=>db.db.insert(itineraryItems).values([{commonsId:trip,title:"Fly fishing",timezone:"America/Denver",audience:"everyone",status:"confirmed",startsAt:new Date("2026-10-06T15:00:00Z"),endsAt:new Date("2026-10-06T17:00:00Z"),provenanceLabel:"Synthetic saved plan"},{commonsId:trip,title:"Group lunch",timezone:"America/Denver",audience:"everyone",status:"confirmed",startsAt:new Date("2026-10-06T16:00:00Z"),endsAt:new Date("2026-10-06T18:00:00Z"),provenanceLabel:"Synthetic saved plan"}]).returning();return{db,trip,owner,member,options,config,plans};}
const reservation={worstCaseCents:0,modelPolicy:"deterministic-v1" as const};
test("Brain: default-off, opt-in, entitlement and budget gates; concurrent dispatch reserves once",{skip},()=>scenario(async f=>{assert.equal((await beginBrainReview(f.trip,reservation,{...f.options,enabled:false})).dispatched,false);assert.equal((await beginBrainReview(f.trip,reservation,f.options)).dispatched,false);await f.config(5);const [a,b]=await Promise.all([beginBrainReview(f.trip,{worstCaseCents:5,modelPolicy:"bounded-model-v1",monthlyTripCents:5,monthlyGlobalCents:100},f.options),beginBrainReview(f.trip,{worstCaseCents:5,modelPolicy:"bounded-model-v1",monthlyTripCents:5,monthlyGlobalCents:100},f.options)]);assert.equal(Number(a.dispatched)+Number(b.dispatched),1);const started=a.dispatched?a:b;assert.ok(started.dispatched);await finishBrainReview(started.reviewId,[],null,f.options);const [settings]=await f.db.db.select().from(tripBrainSettings).where(eq(tripBrainSettings.commonsId,f.trip));assert.equal(settings.spentCents,5);assert.equal(settings.reservedCents,0);const next={...f.options,now:new Date("2026-10-03T20:00:00Z")};await f.db.db.update(commons).set({name:"changed",updatedAt:next.now}).where(eq(commons.id,f.trip));assert.equal((await beginBrainReview(f.trip,{worstCaseCents:1,modelPolicy:"bounded-model-v1",monthlyTripCents:5,monthlyGlobalCents:100},next)).dispatched,false);}));
test("Brain: strict shared snapshot, stale edit and fabricated evidence never publish or write a task",{skip},()=>scenario(async f=>{await f.config();await f.plans();await f.db.db.insert(travelPlans).values({commonsId:f.trip,personId:f.member,kind:"arrival",date:"2026-10-05",route:"PRIVATE ROUTE",time:"09:00",note:"PRIVATE CONTEXT",confirmationCode:"SECRET",sourceLabel:"Private",visibility:"private"});const start=await beginBrainReview(f.trip,reservation,f.options);assert.ok(start.dispatched);assert.doesNotMatch(JSON.stringify(start.snapshot),/PRIVATE|SECRET|Private Traveler/);const findings=deterministicBrainReview(start.snapshot);assert.equal(findings.length,1);await f.db.db.update(itineraryItems).set({updatedAt:new Date("2026-10-01T20:01:00Z")}).where(eq(itineraryItems.commonsId,f.trip));assert.equal((await finishBrainReview(start.reviewId,findings,0,f.options)).published,false);assert.equal((await brainState(f.trip,f.options)).recommendations.length,0);assert.equal((await f.db.db.select().from(tripTasks).where(eq(tripTasks.commonsId,f.trip))).length,0);assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId,f.trip))).length,0);await assert.rejects(brainState(f.trip,{...f.options,actorPersonId:f.member}));}));
test("Brain: quiet healthy review, duplicate finish, recommendation acceptance once, stale acceptance refused",{skip},()=>scenario(async f=>{await f.config();await f.plans();const start=await beginBrainReview(f.trip,reservation,f.options);assert.ok(start.dispatched);const findings=deterministicBrainReview(start.snapshot);await finishBrainReview(start.reviewId,findings,0,f.options);assert.equal((await finishBrainReview(start.reviewId,findings,0,f.options)).published,false);const state=await brainState(f.trip,f.options);assert.equal(state.recommendations.length,1);const r=state.recommendations[0],input={commandId:randomUUID(),recommendationId:r.id,expectedSnapshot:r.snapshotHash,action:"accept"};const [a,b]=await Promise.all([disposeBrainRecommendation(f.trip,input,f.options),disposeBrainRecommendation(f.trip,input,f.options)]);assert.equal(a.todoId,b.todoId);assert.ok(a.todoId);assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId,f.trip))).length,0);assert.equal((await f.db.db.select().from(tripTasks).where(eq(tripTasks.commonsId,f.trip))).length,1);assert.equal((await beginBrainReview(f.trip,reservation,f.options)).dispatched,false);await assert.rejects(disposeBrainRecommendation(f.trip,{...input,commandId:randomUUID(),expectedSnapshot:"stale"},f.options));}));
test("Brain: pause/revocation/timeout fences publication; unknown cost consumes reservation",{skip},()=>scenario(async f=>{await f.config(5);const start=await beginBrainReview(f.trip,{worstCaseCents:5,modelPolicy:"bounded-model-v1",monthlyTripCents:5,monthlyGlobalCents:100},f.options);assert.ok(start.dispatched);await updateBrainSettings(f.trip,{commandId:randomUUID(),optedIn:true,paused:true},f.options);assert.equal((await finishBrainReview(start.reviewId,[],null,f.options)).published,false);const [settings]=await f.db.db.select().from(tripBrainSettings).where(eq(tripBrainSettings.commonsId,f.trip));assert.equal(settings.spentCents,5);const [review]=await f.db.db.select().from(tripBrainReviews).where(eq(tripBrainReviews.id,start.reviewId));assert.equal(review.status,"superseded");}));

test("Brain: healthy trip is quiet across worker restart; snooze and material evidence changes stay bounded",{skip},()=>scenario(async f=>{
  await f.config();const start=await beginBrainReview(f.trip,reservation,f.options);assert.ok(start.dispatched);await finishBrainReview(start.reviewId,[],0,f.options);
  assert.equal((await brainState(f.trip,f.options)).recommendations.length,0);
  const next={...f.options,now:new Date("2026-10-03T20:00:00Z")};const skipped=await beginBrainReview(f.trip,reservation,next);assert.equal(skipped.dispatched,false);if(!skipped.dispatched)assert.equal(skipped.reason,"unchanged");
  await f.plans();const active=await beginBrainReview(f.trip,reservation,next);assert.ok(active.dispatched);await finishBrainReview(active.reviewId,deterministicBrainReview(active.snapshot),0,next);
  const r=(await brainState(f.trip,next)).recommendations[0];assert.ok(r);assert.ok(r.todoId);
  const [todo]=await f.db.db.select().from(tripTasks).where(eq(tripTasks.commonsId,f.trip));
  assert.equal(todo.itemId,null);assert.equal(todo.itemKind,null);
  await f.db.db.update(tripTasks).set({completed:true,title:"Already checked these plans"}).where(eq(tripTasks.id,todo.id));
  await disposeBrainRecommendation(f.trip,{commandId:randomUUID(),recommendationId:r.id,expectedSnapshot:r.snapshotHash,action:"snooze"},next);
  assert.equal((await brainState(f.trip,next)).recommendations.length,0);
  await f.db.db.update(itineraryItems).set({updatedAt:new Date("2026-10-04T19:00:00Z")}).where(eq(itineraryItems.commonsId,f.trip));
  const changed={...f.options,now:new Date("2026-10-04T20:00:00Z")},review=await beginBrainReview(f.trip,reservation,changed);assert.ok(review.dispatched);await finishBrainReview(review.reviewId,deterministicBrainReview(review.snapshot),0,changed);
  assert.equal((await brainState(f.trip,changed)).recommendations.length,0,"completed to-dos remain quiet across evidence changes");
  assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId,f.trip))).length,0);
  const reminders=await f.db.db.select().from(tripTasks).where(eq(tripTasks.commonsId,f.trip));
  assert.equal(reminders.length,1);assert.equal(reminders[0].id,todo.id);assert.equal(reminders[0].completed,true);assert.equal(reminders[0].title,"Already checked these plans");
}));
test("Brain: expired lease conservatively settles cost; revoked membership cannot read or publish",{skip},()=>scenario(async f=>{
  await f.config(5);const start=await beginBrainReview(f.trip,{worstCaseCents:5,modelPolicy:"bounded-model-v1",monthlyTripCents:5,monthlyGlobalCents:100},f.options);assert.ok(start.dispatched);
  const expired={...f.options,now:new Date("2026-10-01T20:06:00Z")};assert.equal((await beginBrainReview(f.trip,reservation,expired)).dispatched,false);
  const [settings]=await f.db.db.select().from(tripBrainSettings).where(eq(tripBrainSettings.commonsId,f.trip));assert.equal(settings.spentCents,5);assert.equal(settings.reservedCents,0);
  await f.db.db.update(memberships).set({status:"removed"}).where(eq(memberships.personId,f.owner));
  await assert.rejects(brainState(f.trip,f.options));assert.equal((await finishBrainReview(start.reviewId,[],0,f.options)).published,false);
}));

test("Brain model: missing global limits deny dispatch; one bounded call persists usage and cannot invent work",{skip},()=>scenario(async f=>{
 await f.config(20);await f.plans();let calls=0;
 const policy={enabled:true,model:"authored-economical-candidate",worstCaseCents:2,monthlyTripCents:20,monthlyGlobalCents:20,inputCentsPerMillion:10,outputCentsPerMillion:20};
 const adapter:import("./trip-brain-executor").BrainModelAdapter=async request=>{calls++;assert.equal(request.maxOutputTokens,800);assert.equal(request.promptVersion,"brain-select-v1");assert.ok(request.signal);return{findingKeys:request.candidates.map(f=>f.key),inputTokens:1000,outputTokens:20};};
 assert.equal((await runBoundedBrainReview(f.trip,f.options,{...policy,enabled:false},adapter)).reason,"model_disabled");
 const denied=await beginBrainReview(f.trip,{worstCaseCents:2,modelPolicy:"bounded-model-v1"},f.options);assert.equal(denied.dispatched,false);if(!denied.dispatched)assert.equal(denied.reason,"model_limits_missing");assert.equal(calls,0);
 const done=await runBoundedBrainReview(f.trip,f.options,policy,adapter);assert.ok("published" in done && done.published);assert.equal(calls,1);
 const [review]=await f.db.db.select().from(tripBrainReviews).where(eq(tripBrainReviews.commonsId,f.trip));assert.equal(review.actualCents,1);assert.equal(review.execution?.model,policy.model);assert.equal(review.execution?.inputTokens,1000);assert.equal(review.execution?.error,null);
 assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId,f.trip))).length,0);
}));
test("Brain model: invalid candidate ids fail without repair, unknown provider spend consumes reservation",{skip},()=>scenario(async f=>{
 await f.config(20);await f.plans();let calls=0;
 const policy={enabled:true,model:"authored-candidate",worstCaseCents:2,monthlyTripCents:20,monthlyGlobalCents:20,inputCentsPerMillion:10,outputCentsPerMillion:20};
 const done=await runBoundedBrainReview(f.trip,f.options,policy,async()=>{calls++;return{findingKeys:["cross-trip-fiction"],inputTokens:1000,outputTokens:20};});
 assert.ok("published" in done && !done.published);assert.equal(calls,1);assert.equal((await brainState(f.trip,f.options)).recommendations.length,0);
 const later={...f.options,now:new Date("2026-10-03T20:00:00Z")};await f.db.db.update(commons).set({name:"Material change",updatedAt:new Date("2026-10-03T19:00:00Z")}).where(eq(commons.id,f.trip));
 const failed=await runBoundedBrainReview(f.trip,later,policy,async()=>{calls++;throw new Error("Authored transport failure");});assert.ok("published" in failed && !failed.published);assert.equal(calls,2);
 const rows=await f.db.db.select().from(tripBrainReviews).where(eq(tripBrainReviews.commonsId,f.trip));assert.equal(rows.find(r=>r.execution?.error==="provider_failed")?.actualCents,2);
}));
test("Brain model: concurrent reservations across trips enforce the global month ceiling",{skip},()=>scenario(async a=>scenario(async b=>{
 await a.config(10);await b.config(10);const reservation={worstCaseCents:5,modelPolicy:"bounded-model-v1" as const,monthlyTripCents:10,monthlyGlobalCents:5};
 const results=await Promise.all([beginBrainReview(a.trip,reservation,a.options),beginBrainReview(b.trip,reservation,b.options)]);assert.equal(results.filter(r=>r.dispatched).length,1);assert.ok(results.some(r=>!r.dispatched&&r.reason==="monthly_budget_exhausted"));
})));

test("Brain model: offers twelve grounded candidates, selects beyond baseline three and exposes omitted coverage",{skip},()=>scenario(async f=>{
 await f.config(20);
 await f.db.db.insert(itineraryItems).values(Array.from({length:13},(_,i)=>({commonsId:f.trip,title:`Crowded plan ${i}`,timezone:"America/Denver",audience:"everyone" as const,status:"confirmed" as const,startsAt:new Date("2026-10-06T15:00:00Z"),endsAt:new Date("2026-10-06T17:00:00Z"),provenanceLabel:"Synthetic saved plan"})));
 const policy={enabled:true,model:"authored-pool-selection",worstCaseCents:2,monthlyTripCents:20,monthlyGlobalCents:100,inputCentsPerMillion:10,outputCentsPerMillion:20};
 let calls=0,selected="";
 const done=await runBoundedBrainReview(f.trip,f.options,policy,async request=>{
   calls++;assert.equal(request.candidates.length,12);selected=request.candidates[5].key;
   assert.ok(!deterministicBrainReview(request.snapshot).some(candidate=>candidate.key===selected));
   assert.match(request.snapshot.coverage.join(" "),/66 other supported findings are excluded/);
   return {findingKeys:[selected],inputTokens:1000,outputTokens:20};
 });
 assert.ok("published" in done && done.published);assert.equal(calls,1);
 const state=await brainState(f.trip,f.options);assert.equal(state.recommendations[0].finding.key,selected);
 assert.match(state.coverage.join(" "),/78 supported findings/);
 assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId,f.trip))).length,0);
}));
test("Brain model: grounded keys outside the offered pool are refused without a repair call",{skip},()=>scenario(async f=>{
 await f.config(20);
 const rows=await f.db.db.insert(itineraryItems).values(Array.from({length:8},(_,i)=>({commonsId:f.trip,title:`Plan ${i}`,timezone:"America/Denver",audience:"everyone" as const,status:"confirmed" as const,startsAt:new Date("2026-10-06T15:00:00Z"),endsAt:new Date("2026-10-06T17:00:00Z"),provenanceLabel:"Synthetic saved plan"}))).returning();
 const key=`overlap:${rows.map(row=>row.id).sort().slice(-2).join(":")}`;let calls=0;
 const done=await runBoundedBrainReview(f.trip,f.options,{enabled:true,model:"authored-excluded-selection",worstCaseCents:2,monthlyTripCents:20,monthlyGlobalCents:100,inputCentsPerMillion:10,outputCentsPerMillion:20},async request=>{
   calls++;assert.ok(!request.candidates.some(candidate=>candidate.key===key));return {findingKeys:[key],inputTokens:1000,outputTokens:20};
 });
 assert.ok("published" in done && !done.published);assert.equal(calls,1);assert.equal((await brainState(f.trip,f.options)).recommendations.length,0);
 const [review]=await f.db.db.select().from(tripBrainReviews).where(eq(tripBrainReviews.commonsId,f.trip));assert.equal(review.execution?.error,"invalid_output");assert.equal(review.actualCents,1);
}));
test("Brain model: oversized snapshot dispatches zero calls and releases the unused reservation",{skip},()=>scenario(async f=>{
 await f.config(20);
 await f.db.db.insert(itineraryItems).values(Array.from({length:100},(_,i)=>({commonsId:f.trip,title:`${i} ${"x".repeat(117)}`,timezone:"America/Denver",audience:"everyone" as const,status:"confirmed" as const,startsAt:new Date("2026-10-06T15:00:00Z"),endsAt:new Date("2026-10-06T17:00:00Z"),provenanceLabel:"Synthetic saved plan"})));
 let calls=0;
 const done=await runBoundedBrainReview(f.trip,f.options,{enabled:true,model:"authored-input-limit",worstCaseCents:2,monthlyTripCents:20,monthlyGlobalCents:100,inputCentsPerMillion:10,outputCentsPerMillion:20},async()=>{calls++;return {findingKeys:[],inputTokens:0,outputTokens:0};});
 assert.ok("published" in done && !done.published);assert.equal(calls,0);
 const [settings]=await f.db.db.select().from(tripBrainSettings).where(eq(tripBrainSettings.commonsId,f.trip));assert.equal(settings.reservedCents,0);assert.equal(settings.spentCents,0);
 const [review]=await f.db.db.select().from(tripBrainReviews).where(eq(tripBrainReviews.commonsId,f.trip));assert.equal(review.actualCents,0);
 assert.equal((await brainState(f.trip,f.options)).recommendations.length,0);
}));

test("Brain gap review adds one attributed to-do without creating Plan facts or executable goals",{skip},()=>scenario(async f=>{
  await f.config();
  const [van]=await f.db.db.insert(travelPlans).values({commonsId:f.trip,personId:f.owner,kind:"transport",date:"2026-10-05",route:"Shared airport van",time:null,status:"considering",visibility:"basic",sourceLabel:"Synthetic saved transport"}).returning();
  const start=await beginBrainReview(f.trip,reservation,f.options);assert.ok(start.dispatched);
  const finding=deterministicBrainReview(start.snapshot);assert.equal(finding[0].title,"Check pickup time: Shared airport van");
  await finishBrainReview(start.reviewId,finding,0,f.options);
  const [todo]=await f.db.db.select().from(tripTasks).where(eq(tripTasks.commonsId,f.trip));
  assert.equal(todo.title,"Check pickup time: Shared airport van");assert.equal(todo.ownerPersonId,f.owner);assert.equal(todo.brainFindingKey,`missing-time:${van.id}`);assert.equal(todo.itemId,null);
  assert.equal((await f.db.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,f.trip))).length,0);
  assert.equal((await f.db.db.select().from(coordinatorGoals).where(eq(coordinatorGoals.commonsId,f.trip))).length,0);
  const [savedVan]=await f.db.db.select().from(travelPlans).where(eq(travelPlans.id,van.id));assert.equal(savedVan.time,null);assert.equal(savedVan.status,"considering");
  const state=await brainState(f.trip,f.options);assert.equal(state.recommendations[0].todoId,todo.id);
}));
