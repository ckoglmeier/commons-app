import test from "node:test";
import assert from "node:assert/strict";
import { detailedSonomaItinerary } from "../../../packages/contracts/src/fixtures/sonoma-message";
import { applyItineraryTextEdits, itineraryTextTargets } from "./itinerary-text-edit";
import { createOpenAIItineraryAdapter } from "./server/itinerary-execution";
import { itineraryModelInput } from "./itinerary-model-input";
import { syntheticDraft } from "../../../packages/contracts/src/fixtures/research-itinerary";
test("exact Robin prose requests target the opening and Saturday narrative, not times or unrelated text",()=>{
 const content=detailedSonomaItinerary(); content.days=[{day:"2026-11-05",description:"Thursday"},{day:"2026-11-06",description:"Friday"},{day:"2026-11-07",description:"Long Saturday narrative with airport buffer"}];
 const targets=itineraryTextTargets(content,"Revise this same itinerary. Make the opening warmer and shorter. Do not create tasks or change saved trip plans."); assert.deepEqual(targets.map(t=>t.id),["opening"]);
 const opening=applyItineraryTextEdits(content,targets,[{id:"opening",text:"A lovely weekend together."}]); assert.deepEqual({...opening,opening:content.opening},content);
 const saturdayTargets=itineraryTextTargets(opening,"Simplify Saturday’s description, keeping all flight times and airport-arrival requirements unchanged.");assert.deepEqual(saturdayTargets.map(t=>t.id),["day:2026-11-07"]);
 const saturday=applyItineraryTextEdits(opening,saturdayTargets,[{id:"day:2026-11-07",text:"A quiet morning, then the airport with our existing buffer."}]);assert.deepEqual(saturday.items,opening.items);assert.deepEqual(saturday.days!.slice(0,2),opening.days!.slice(0,2));assert.equal(saturday.opening,opening.opening);
 assert.throws(()=>applyItineraryTextEdits(opening,targets,[{id:"closing",text:"wrong"}]),/scope/);assert.throws(()=>applyItineraryTextEdits(opening,targets,[]),/requested text/);
 assert.deepEqual(itineraryTextTargets(content,"Remove Saturday's second stop"),[]);
});
test("prose adapter merges only validated text targets into exact current content",async()=>{
 const draft=syntheticDraft();draft.content.opening="Original organizer prose";let calls=0;
 const adapter=createOpenAIItineraryAdapter({apiKey:"fake",model:"gpt-6.1-sol",fetcher:async(_url,init)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.response_format.json_schema.name,"commons_itinerary_prose");assert.match(body.messages.at(-2).content,/CURRENT request/);const input=JSON.parse(body.messages.at(-1).content);assert.deepEqual(input.textTargets.map((t:{id:string})=>t.id),["opening"]);return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify({edits:[{id:"opening",text:"Welcome to our lovely weekend."}]})}}]});}});
 const result=await adapter(itineraryModelInput("Revise this same itinerary. Make the opening warmer and shorter. Do not create tasks or change saved trip plans.",draft));assert.equal(calls,1);assert.equal(result.opening,"Welcome to our lovely weekend.");assert.deepEqual({...result,opening:draft.content.opening},draft.content);
});

test("prose output cannot discard supplied clocks or qualified tour restrictions",()=>{const content=detailedSonomaItinerary();const restriction="Our planning notes say Schramsberg does not publicly offer Saturday tours; check directly before including this stop.";content.days=[{day:"2026-11-07",description:`A relaxed morning, then SFO by 1:30 PM. ${restriction}`}];const targets=itineraryTextTargets(content,"Simplify Saturday's description");assert.throws(()=>applyItineraryTextEdits(content,targets,[{id:"day:2026-11-07",text:"Go to Schramsberg if available."}]),/omitted/);const text=`A quiet morning; SFO by 1:30 PM. ${restriction}`;assert.equal(applyItineraryTextEdits(content,targets,[{id:"day:2026-11-07",text}]).days![0].description,text);});
