import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { PollWorkingDraftSchema, type PollWorkingDraft } from "@commons/contracts";
import { newItineraryDraft, itineraryQuestion } from "../lib/itinerary-workshop";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
registerComponentImportStubs();
const source = `Thursday: Arrival\n1:12 PM Land at SFO\n${"Keep this supplied note. ".repeat(100)}\n7:30 PM Dinner in Sonoma\nFriday: Wineries\n10:00 AM Flowers`;
const draft = () => PollWorkingDraftSchema.parse({id:crypto.randomUUID(),version:1,data:newItineraryDraft("Wine weekend"),publishedPollId:null,updatedAt:new Date().toISOString()});
test("imported schedule autosaves once; failure and reload retain text and the exact retry command", async()=>{
  const original=draft(), requests:Array<{path:string;body:Record<string,unknown>}>=[], saved:PollWorkingDraft[]=[]; let fail=true;
  const live=installFakeLiveEnvironment({liveFetch:async(url,init)=>{const body=JSON.parse(String(init?.body)); requests.push({path:String(url),body}); if(fail) return Response.json({error:"Temporary save failure"},{status:503}); return Response.json({draft:{...original,version:2,data:body.data}}); }});
  const {ItineraryDraftEditor}=await import("./itinerary-draft-editor"); let renderer=createHookRenderer({expand:[ItineraryDraftEditor]}); let flush:(()=>Promise<void>)|null=null;
  const props={slug:"qa-trip",actorId:"qa-organizer",draft:original,onSaved:(value:PollWorkingDraft)=>saved.push(value),onBlocked:()=>{},onReady:(value:(()=>Promise<void>)|null)=>{flush=value;}};
  try {
    renderer.render(createElement(ItineraryDraftEditor,{...props,sourceImport:source})); await settle(10);renderer.flush(); assert.ok(source.length>1800);assert.equal(requests.length,0);
    await assert.rejects((flush as unknown as ()=>Promise<void>)(),/Temporary save failure/);renderer.flush();assert.equal(saved.length,0);
    assert.ok(renderer.tree.map(textOf).join(" ").includes("Temporary save failure"));renderer.unmount();renderer=createHookRenderer({expand:[ItineraryDraftEditor]});
    renderer.render(createElement(ItineraryDraftEditor,props));await settle(10);renderer.flush();assert.equal(renderer.find(node=>node.type==="textarea"&&node.props.rows===6).props.value,source);
    fail=false;await (flush as unknown as ()=>Promise<void>)();renderer.flush();assert.deepEqual(requests[1],requests[0]);assert.equal(saved.length,1);assert.equal(saved[0].data.itinerarySource,source);
    assert.deepEqual(itineraryQuestion(saved[0].data.questions)!.itinerary.days.map(day=>day.label),["Thursday: Arrival","Friday: Wineries"]);
  } finally {renderer.unmount();live.restore();}
});
test("raw pasted notes require review before replacing or saving the document",async()=>{
  const original=draft(),requests:unknown[]=[];const live=installFakeLiveEnvironment({liveFetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);return Response.json({draft:{...original,version:2,data:body.data}});}});
  const {ItineraryDraftEditor}=await import("./itinerary-draft-editor");const renderer=createHookRenderer({expand:[ItineraryDraftEditor]});let flush:(()=>Promise<void>)|null=null;
  try {
    renderer.render(createElement(ItineraryDraftEditor,{slug:"qa-trip",actorId:"organizer",draft:original,onSaved:()=>{},onBlocked:()=>{},onReady:value=>{flush=value;}}));await settle(10);renderer.flush();
    (renderer.find(node=>node.type==="textarea"&&node.props.rows===6).props.onChange as (event:unknown)=>void)({target:{value:source}});renderer.flush();await assert.rejects((flush as unknown as ()=>Promise<void>)(),/Review your pasted notes/);assert.equal(requests.length,0);
    (renderer.find(node=>node.type==="button"&&textOf(node)==="Review pasted itinerary").props.onClick as ()=>void)();await settle(10);renderer.flush();await (flush as unknown as ()=>Promise<void>)();assert.equal(requests.length,1);
  } finally {renderer.unmount();live.restore();}
});


test("imported email default edits prose; Edit reorders sections with both drag and keyboard controls",async()=>{
  const original=draft();const q=itineraryQuestion(original.data.questions)!;q.itinerary.days=[{id:crypto.randomUUID(),label:"Thursday",description:"An easy arrival",items:[]},{id:crypto.randomUUID(),label:"Friday",description:"Healdsburg together",items:[]}];
  const live=installFakeLiveEnvironment({liveFetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));return Response.json({draft:{...original,version:body.expectedVersion+1,data:body.data}});}});
  const {ItineraryDraftEditor}=await import("./itinerary-draft-editor"),{ItineraryMessage}=await import("./itinerary-message"),{ItineraryDocument}=await import("./itinerary-document"),{EditableProse}=await import("./editable-prose");
  let flush:(()=>Promise<void>)|null=null, saved:PollWorkingDraft=original;const renderer=createHookRenderer({expand:[ItineraryDraftEditor,ItineraryMessage,ItineraryDocument,EditableProse]});
  try {
    renderer.render(createElement(ItineraryDraftEditor,{slug:"imported-message",actorId:"organizer",draft:original,onSaved:value=>{saved=value;},onBlocked:()=>{},onReady:value=>{flush=value;}}));await settle(5);renderer.flush();
    assert.equal(renderer.findAll(node=>node.type==="input"&&node.props.type==="date").length,0);
    (renderer.find(node=>node.type==="textarea"&&node.props["aria-label"]==="Opening for the group").props.onChange as (event:unknown)=>void)({target:{value:"Welcome! A relaxed weekend awaits."}});renderer.flush();await (flush as unknown as ()=>Promise<void>)();renderer.flush();assert.equal(saved.data.communication!.paragraphs[0],"Welcome! A relaxed weekend awaits.");
    (renderer.find(node=>node.type==="button"&&textOf(node)==="Edit").props.onClick as ()=>void)();renderer.flush();
    const handle=renderer.find(node=>node.type==="button"&&node.props["aria-label"]==="Drag Thursday section"),target=renderer.find(node=>node.props["data-itinerary-section"]===q.itinerary.days[1].id),event={dataTransfer:{setData(){},effectAllowed:""},preventDefault(){}};
    (handle.props.onDragStart as (event:unknown)=>void)(event);(target.props.onDrop as (event:unknown)=>void)(event);renderer.flush();await (flush as unknown as ()=>Promise<void>)();renderer.flush();assert.deepEqual(itineraryQuestion(saved.data.questions)!.itinerary.days.map(day=>day.label),["Friday","Thursday"]);
    (renderer.findAll(node=>node.type==="button"&&textOf(node)==="Move section later")[0].props.onClick as ()=>void)();renderer.flush();await (flush as unknown as ()=>Promise<void>)();renderer.flush();assert.deepEqual(itineraryQuestion(saved.data.questions)!.itinerary.days.map(day=>day.label),["Thursday","Friday"]);
  } finally {renderer.unmount();live.restore();}
});


test("legacy ballot remains visible after leaving structural editing without changing its feedback mode",async()=>{
  const original=draft(),q=itineraryQuestion(original.data.questions)!;delete q.itinerary.feedbackMode;
  q.itinerary.days=[{id:crypto.randomUUID(),label:"Thursday",description:"A relaxed arrival",items:[]}];
  const live=installFakeLiveEnvironment({liveFetch:async()=>{throw new Error("No save expected");}});
  const {ItineraryDraftEditor}=await import("./itinerary-draft-editor"),{ItineraryMessage}=await import("./itinerary-message"),{ItineraryDocument}=await import("./itinerary-document"),{EditableProse}=await import("./editable-prose");
  const renderer=createHookRenderer({expand:[ItineraryDraftEditor,ItineraryMessage,ItineraryDocument,EditableProse]});
  try {
    renderer.render(createElement(ItineraryDraftEditor,{slug:"legacy-ballot",actorId:"organizer",draft:original,onSaved:()=>{},onBlocked:()=>{}}));await settle(5);renderer.flush();
    (renderer.find(node=>node.type==="button"&&textOf(node)==="Done editing").props.onClick as ()=>void)();renderer.flush();
    assert.equal(renderer.find(node=>node.type==="textarea"&&node.props["aria-label"]==="Heading for Thursday").props.value,"Thursday");
    assert.equal(renderer.find(node=>node.type==="textarea"&&node.props["aria-label"]==="Itinerary title").props.value,"Wine weekend");
    assert.equal(q.itinerary.feedbackMode,undefined);
  } finally {renderer.unmount();live.restore();}
});
