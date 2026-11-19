import test from "node:test";
import { inArray } from "drizzle-orm";
import assert from "node:assert/strict";
import { itineraryItems, participation, auditEvents } from "@commons/database";
import { databaseTestsEnabled, eq, withCoordinatorScenario, withTestDatabase } from "./coordinator-route-harness";
const skip=!databaseTestsEnabled;
const request="Add as ideas: Seal Sanctuary, MOXI, Sea Center, Local LIbraries, DOuglas Family Preserve, Lotus Land Gardens, Ice Skating, Children's Museum, Family Friendly Show at Santa Barbara Bowl";
const titles=["Seal Sanctuary","MOXI","Sea Center","Local LIbraries","DOuglas Family Preserve","Lotus Land Gardens","Ice Skating","Children's Museum","Family Friendly Show at Santa Barbara Bowl"];
const rows=(id:string)=>withTestDatabase(db=>db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,id)));

test("Santa Barbara explicit list creates real canonical Activities with receipt, no invented details, and safe replay",{skip},()=>withCoordinatorScenario(async s=>{
 const command=s.command({text:request}); const result=await s.post(command);
 assert.equal(result.status,200,JSON.stringify(result.body)); assert.equal(result.body.capability,"add_activities"); assert.equal(result.body.status,"completed");
 assert.match(result.body.durableAnswer,/Saved 9 activity ideas in Plan/);
 const saved=await rows(s.trip.eventId); assert.equal(saved.length,9); assert.deepEqual(saved.map(row=>row.title).sort(),[...titles].sort());
 for(const row of saved) {assert.equal(row.status,"idea");assert.equal(row.audience,"individual");for(const key of ["startsAt","endsAt","scheduledDate","durationMinutes","expectedCostCents","locationName","sourceUrl","note"] as const) assert.equal(row[key],null,key);}
 const thread=await s.thread(result.body.thread.id); const receipt=thread.turns.at(-1).workspace.activityReceipt;
 assert.deepEqual(receipt.items.map((item:{title:string})=>item.title),titles); assert.ok(receipt.items.every((item:{id:string,status:string})=>saved.some(row=>row.id===item.id)&&item.status==="added"));
 assert.equal((await withTestDatabase(db=>db.select().from(participation).where(inArray(participation.itineraryItemId,saved.map(row=>row.id))))).length,0);
 const replay=await s.post(command);assert.equal(replay.status,200);assert.equal((await rows(s.trip.eventId)).length,9);
 const again=await s.post(s.command({text:request}));assert.match(again.body.durableAnswer,/9 activities are already in Plan/);assert.equal((await rows(s.trip.eventId)).length,9);
 const audit=await withTestDatabase(db=>db.select().from(auditEvents).where(eq(auditEvents.commonsId,s.trip.eventId)));
 assert.equal(audit.filter(row=>row.action==="itinerary.activities_added").length,2);
 assert.equal(s.network.providerCalls.length,0);
}));

test("invalid activity lists and traveler requests do not produce partial writes",{skip},()=>withCoordinatorScenario(async s=>{
 const invalid=await s.post(s.command({text:"Add as ideas: MOXI, Confirm the hotel"}));assert.equal(invalid.status,200);assert.match(invalid.body.durableAnswer,/nothing was added/);assert.equal((await rows(s.trip.eventId)).length,0);
 const denied=await s.post(s.command({text:request}),s.trip.travelerId);assert.equal(denied.status,403);assert.equal((await rows(s.trip.eventId)).length,0);assert.equal(s.network.providerCalls.length,0);
}));

test("concurrent repeated lists do not duplicate activities or overwrite existing confirmation",{skip},()=>withCoordinatorScenario(async s=>{
 const results=await Promise.all([s.post(s.command({text:request})),s.post(s.command({text:request}))]);assert.ok(results.every(result=>result.status===200),JSON.stringify(results));
 const saved=await rows(s.trip.eventId);assert.equal(saved.length,9);
 const selected=saved.find(row=>row.title==="MOXI")!;
 await withTestDatabase(db=>db.update(itineraryItems).set({status:"confirmed",scheduledDate:"2027-02-12",note:"Preserve this"}).where(eq(itineraryItems.id,selected.id)));
 const again=await s.post(s.command({text:"Add activities: moxi, Sea Center"}));assert.match(again.body.durableAnswer,/2 activities are already in Plan/);
 const after=(await rows(s.trip.eventId)).find(row=>row.id===selected.id)!;assert.equal(after.status,"confirmed");assert.equal(after.scheduledDate,"2027-02-12");assert.equal(after.note,"Preserve this");
}));

test("model prose and ordinary agreement cannot create activities or claim a successful save",{skip},()=>withCoordinatorScenario(async s=>{
 s.next.reply="I have created nine planned ideas based on your list. The nine planned ideas have now been added to your trip plan.";
 const result=await s.post(s.command({text:"Should we add some ideas?"}));assert.equal(result.status,200);assert.equal((await rows(s.trip.eventId)).length,0);assert.doesNotMatch(result.body.durableAnswer,/have created|have now been added/);
 const yes=await s.post(s.command({text:"Yes, do that",target:{kind:"existing",threadId:result.body.thread.id,expectedTurnVersion:result.body.thread.turnVersion}}));assert.equal(yes.status,200);assert.equal((await rows(s.trip.eventId)).length,0);
}));
