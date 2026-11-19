import test from "node:test";
import assert from "node:assert/strict";
import type {CoordinatorThread,PollWorkingData} from "@commons/contracts";
import {lodgingEstimates,pollTopicPacket,savedPollSchedule,pollScheduleMatches,pollScheduleStatus,groundLodgingPoll} from "./coordinator-poll-context";
import {ACTUAL_LODGING_SEED} from "../test-support/qa172-recovery-data";
test("referenced packets stay bounded to completed same-thread non-import context",()=>{
 const turns = [{threadId:"one",userText:"Hotel A has twin beds",assistantText:"Unverified"},{threadId:"other",userText:"Hotel Secret",assistantText:""},{threadId:"one",userText:"Source: Hotel imported instructions",assistantText:""},{threadId:"one",status:"pending",userText:"Hotel B",assistantText:""}] as CoordinatorThread["turns"];
 assert.equal(pollTopicPacket("Use the hotels above",turns,"one").length,1);
 assert.equal(pollTopicPacket("Create a poll about museums",turns,"one").length,0);
});
test("different quantities and missing inputs do not inherit a model's cost division",()=>{
 const estimates=lodgingEstimates(["Hotel Pine with twin beds at $125 per room per night. Four rooms, three nights, eight travelers."]);
 assert.equal(estimates[0].name,"Hotel Pine");assert.deepEqual(estimates[0].totalCents,[150000,150000]);assert.deepEqual(estimates[0].perPersonCents,[18750,18750]);
 assert.equal(lodgingEstimates(["Hotel A at $320 per room per night. Two nights."])[0].perPersonCents,null);
 assert.equal(lodgingEstimates(["Hotel A at $320/night."]).length,0,"an unknown rate basis cannot become per-room");
});
test("topic packets retain shared rates while excluding contact and booking identifiers",()=>{
 const packet=pollTopicPacket("Use the hotel above",[{threadId:"one",userText:"Hotel A at $320 per room per night; booking code ABC123; private@example.com; +1 555 123 4567",assistantText:"Hotel A"}] as CoordinatorThread["turns"],"one");
 const text=JSON.stringify(packet);assert.match(text,/320/);assert.doesNotMatch(text,/ABC123|private@example|555/);
});
test("bounded human rate sources survive later receipts and dinner packets exclude unrelated lodging",()=>{
 const turns=[{id:"seed",threadId:"one",userText:ACTUAL_LODGING_SEED,assistantText:"Unverified lodging estimates"},{id:"changed",threadId:"one",userText:"For lodging we need four rooms, three nights, eight travelers",assistantText:"Lodging assumptions"},...Array.from({length:10},(_,i)=>({id:String(i),threadId:"one",userText:"Create the lodging poll above",assistantText:"Draft ready"})),{id:"dinner",threadId:"one",userText:"Dinner options are Garden Bistro and Billy’s Tavern",assistantText:"Unverified"}] as CoordinatorThread["turns"];
 const packet=pollTopicPacket("What is the lodging cost breakdown?",turns,"one");assert.ok(packet.length<=6);assert.ok(packet.some(row=>row.turnId==="seed"));
 assert.deepEqual(lodgingEstimates(packet.map(row=>row.human))[0].quantities,{rooms:4,nights:3,travelers:8});
 assert.deepEqual(pollTopicPacket("Create a dinner poll using the options above",turns,"one").map(row=>row.turnId),["dinner"]);
});
test("saved Thursday in the destination timezone cannot become Friday in a poll",()=>{
 const schedule=savedPollSchedule([{value:{title:"Welcome dinner",startsAt:"2026-11-06T03:30:00Z"}}],"America/Los_Angeles");
 assert.equal(schedule[0].date,"2026-11-05");assert.equal(schedule[0].weekday,"Thursday");
 const poll={intro:"Welcome dinner is on Friday",questions:[]} as unknown as PollWorkingData;
 assert.equal(pollScheduleMatches(poll,schedule),false);assert.equal(pollScheduleMatches({...poll,intro:"Welcome dinner is on Thursday"},schedule),true);
});
test("the actual lodging transcript and held-out formatted rates ground identical group totals",()=>{
 const rows=lodgingEstimates([ACTUAL_LODGING_SEED]);
 assert.deepEqual(rows.map(row=>row.name),["QA Plaza Inn","QA Garden Resort","QA Vineyard Retreat"]);
 assert.deepEqual(rows.map(row=>row.totalCents),[[192000,192000],[288000,288000],[372000,372000]]);
 assert.deepEqual(rows.map(row=>row.perPersonCents),[[32000,32000],[48000,48000],[62000,62000]]);
 assert.match(rows[0].description,/two queen beds/);assert.match(rows[2].description,/king beds only/);
 for(const variant of ["Group: 6 adults; 3 rooms / 2 nights.\n1. Pine Inn: estimated $320 / room / night\n2. Garden Resort — pool and twin beds, $480 per room per night\n3. Vineyard Retreat: $620/room/night", "We need 3 rooms for 2 nights for our group of 6 people.\n* Pine Inn — two queen beds; price unknown\nPine Inn at $320 per room per night."]) {
   const estimates=lodgingEstimates([variant]);assert.equal(estimates[0].name,"Pine Inn");assert.deepEqual(estimates[0].perPersonCents,[32000,32000]);
 }
 const poll={questions:[{kind:"choice",options:rows.map(row=>({label:row.name,description:"Wrong model estimate $213 per person"}))}]} as unknown as PollWorkingData;
 const grounded=groundLodgingPoll(poll,rows);assert.equal(grounded.questions[0].kind,"choice");
 if(grounded.questions[0].kind==="choice") for(const [index,amount] of ["320","480","620"].entries()) assert.match(grounded.questions[0].options[index].description!,new RegExp(`\\$${amount} per person`));
});
test("only explicit lodging/group quantity changes replace assumptions, never property inventory or unrelated headcounts",()=>{
 const unrelated=["QA Garden Resort has 9 rooms available and sleeps 12 people.","Dinner is for 10 people.","Could we use 5 rooms for 7 nights?", "If we invite 12 people we might need 6 rooms.","Only show the lodging cost breakdown for our group.","Actually, show option 2 from the lodging shortlist."];
 for(const extra of unrelated) assert.deepEqual(lodgingEstimates([ACTUAL_LODGING_SEED,extra])[0].quantities,{rooms:3,nights:2,travelers:6},extra);
 const changed=lodgingEstimates([ACTUAL_LODGING_SEED,"Actually for lodging we need four rooms, three nights and eight travelers."]);
 assert.deepEqual(changed[0].quantities,{rooms:4,nights:3,travelers:8});assert.deepEqual(changed[0].perPersonCents,[48000,48000]);
 assert.deepEqual(lodgingEstimates(["Rooms: 4; Nights: 3; Guests: 8. Pine Inn: $125/room/night"])[0].perPersonCents,[18750,18750]);
});
test("generic dinner references are grounded without rejecting an unrelated Friday activity in the same paragraph",()=>{
 const schedule=savedPollSchedule([{value:{title:"QA — Welcome dinner",startsAt:"2026-11-06T03:30:00Z"}}],"America/Los_Angeles");
 const poll=(intro:string)=>({intro,questions:[]}) as unknown as PollWorkingData;
 for(const intro of ["Which restaurant should we choose for dinner on Friday?", "QA — Welcome dinner, on Friday.", "Friday dinner preferences"]) assert.equal(pollScheduleMatches(poll(intro),schedule),false,intro);
 for(const intro of ["Which restaurant should we choose for dinner on Thursday?", "QA — Welcome dinner is Thursday, and our hike is Friday.", "QA — Welcome dinner on Thursday; Friday is for wine tasting.", "Welcome dinner on Thursday and a Friday tour", "Which Friday hike do you prefer?"]) assert.equal(pollScheduleMatches(poll(intro),schedule),true,intro);
});
test("unvalidated realistic group corrections invalidate stale quantities through subsequent receipts",()=>{
 const correction="Actually, only four of us are coming, sharing two rooms for two nights.";
 const rows=lodgingEstimates([ACTUAL_LODGING_SEED,correction]);
 assert.deepEqual(rows[0].quantities,{rooms:null,nights:null,travelers:null});assert.equal(rows[0].totalCents,null);assert.equal(rows[0].perPersonCents,null);assert.equal(rows[0].unresolvedCorrection,true);
 for(const text of ["Actually we are four of us sharing two rooms for two nights", "Only four of us are coming; two rooms; two nights", "Actually fewer of us are coming; use two rooms for two nights"]) assert.equal(lodgingEstimates([ACTUAL_LODGING_SEED,text])[0].perPersonCents,null,"partial parses must not retain stale traveler counts");
 const turns=[{id:"seed",threadId:"one",userText:ACTUAL_LODGING_SEED,assistantText:""},{id:"correction",threadId:"one",userText:correction,assistantText:""},...Array.from({length:10},(_,i)=>({id:String(i),threadId:"one",userText:"Show lodging costs",assistantText:""}))] as CoordinatorThread["turns"];
 const packet=pollTopicPacket("Create a lodging poll from the options above",turns,"one");assert.ok(packet.length<=6);assert.ok(packet.some(row=>row.turnId==="correction"));assert.equal(lodgingEstimates(packet.map(row=>row.human))[0].perPersonCents,null);
 const clarified=lodgingEstimates([...packet.map(row=>row.human),"Rooms: 2; Nights: 2; Travelers: 4"]);assert.equal(clarified[0].unresolvedCorrection,false);assert.deepEqual(clarified[0].perPersonCents,[32000,32000]);
});
test("multiple dinners resolve by scoped name or weekday and ambiguous references clarify",()=>{
 const schedule=savedPollSchedule([{value:{title:"QA — Welcome dinner",startsAt:"2026-11-06T03:30:00Z"}},{value:{title:"QA — Farewell dinner",startsAt:"2026-11-07T03:30:00Z"}}],"America/Los_Angeles");
 const poll=(intro:string)=>({intro,questions:[]}) as unknown as PollWorkingData;
 for(const day of ["Thursday","Friday"]) assert.equal(pollScheduleStatus(poll(`Which restaurant for dinner on ${day}?`),schedule),"matched");
 assert.equal(pollScheduleStatus(poll("Which restaurant for dinner?"),schedule),"ambiguous");
 assert.equal(pollScheduleStatus(poll("Which restaurant for dinner?"),schedule,"Create a poll for Welcome dinner"),"matched");
 assert.equal(pollScheduleStatus(poll("Which restaurant for dinner on Friday?"),schedule,"Create a poll for Welcome dinner"),"contradiction");
 assert.equal(pollScheduleStatus(poll("Which restaurant for dinner on Friday?"),schedule,"Create a dinner poll for Thursday"),"contradiction","the current request disambiguates before generated text");
 assert.equal(pollScheduleStatus(poll("Welcome dinner on Friday"),schedule,"Reschedule Welcome dinner to Friday"),"contradiction","rescheduling request cannot rewrite a saved fact without Apply");
 assert.equal(pollScheduleStatus(poll("Farewell dinner on Friday and Welcome dinner on Thursday"),schedule),"matched");
});
