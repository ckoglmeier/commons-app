import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { shortlistFromChoices, syncDecisionOptions, type ItineraryContent } from "@commons/contracts";
import { syntheticDraft } from "../../../packages/contracts/src/fixtures/research-itinerary";
import { itineraryPublishedPreferences, publishedItineraryId } from "./itinerary-published-preferences";
import type { itineraryResults } from "./itinerary-workshop";
test("published IDs match the historical server SHA algorithm", async () => {
 const doc = syntheticDraft().id, key = "item:stop";
 const h = createHash("sha256").update(JSON.stringify([doc, `public:${key}`])).digest("hex");
 assert.equal(await publishedItineraryId(doc,key), `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`);
});
test("duplicate titles/questions, renamed labels and reordered options cannot cross-attribute a preference", async () => {
 const doc=syntheticDraft();
 const items: ItineraryContent["items"] = ["one","two"].map(id => {
   const item={...doc.content.items[1],id,title:"Same title"};
   const shortlist=shortlistFromChoices(item,["Flowers","DaVero"],[],{partySize:9,day:item.day,requirements:[]});
   return {...item,decision:{question:"Same question",options:syncDecisionOptions(shortlist),shortlist}};
 });
 const choices=await Promise.all(items.map(async(item,index)=>({id:await publishedItineraryId(doc.id,`item:${item.id}`),title:item.title,question:"Same question",options:await Promise.all(item.decision!.shortlist!.map(async option=>({id:await publishedItineraryId(doc.id,`choice:${item.id}:option:${option.id}`),label:option.label,people:index===0?["Ana"]:["Ben","Cam"]})))})));
 const results={choices} as NonNullable<ReturnType<typeof itineraryResults>>;
 items[0].title="Renamed stop"; items[0].decision!.shortlist!.reverse();items[0].decision!.shortlist![0].label="Renamed option";
 // The second stop represents a legacy round published before the private shortlist existed.
 choices[1].options[0].id=await publishedItineraryId(doc.id,`choice:two:${choices[1].options[0].label}`);
 const mapped=await itineraryPublishedPreferences(doc.id,items,results);
 assert.deepEqual(mapped.one.map(row=>row.names),[["Ana"],["Ana"]]); assert.deepEqual(mapped.two.map(row=>row.names),[["Ben","Cam"],["Ben","Cam"]]);
 assert.deepEqual(await itineraryPublishedPreferences(crypto.randomUUID(),items,results),{one:[],two:[]},"another document's round cannot match");
});
