import test from "node:test";
import assert from "node:assert/strict";
import type { DocumentSave, DocumentState } from "../lib/itinerary-document-autosave";
import { createElement } from "react";
import { PollWorkingDraftSchema, itineraryParticipantDraft } from "@commons/contracts";
import { syntheticDraft } from "../../../packages/contracts/src/fixtures/research-itinerary";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
registerComponentImportStubs();

test("Publish opens only access confirmation; confirmation prepares and publishes the exact saved participant version", async () => {
  const requests: Record<string,unknown>[] = [];
  const draft=syntheticDraft(), data=itineraryParticipantDraft(draft.content,()=>crypto.randomUUID());
  const projection=PollWorkingDraftSchema.parse({id:crypto.randomUUID(),version:3,data,publishedPollId:null,updatedAt:new Date().toISOString()});
  const poll={...data,id:crypto.randomUUID(),publicId:"abcdef123456",event:{slug:"feedback",name:"QA"},status:"open",createdByName:"Organizer",createdAt:new Date().toISOString(),responseCount:0,resultsVisible:true,aggregates:[],shareToken:"a".repeat(32),currentActorRole:"organizer",currentActorCanManage:true,responses:[]};
  const live=installFakeLiveEnvironment({liveFetch:async(_url,init)=>{requests.push(JSON.parse(String(init?.body)));return Response.json({poll});}});
  Object.assign(window.location,{origin:"http://localhost:4334"});
  const {CoordinatorItinerary}=await import("./coordinator-itinerary"),{ItineraryMessage}=await import("./itinerary-message"),{ItineraryDocument}=await import("./itinerary-document"),{ItineraryPublishConfirmation}=await import("./itinerary-publish-confirmation");
  const calls:unknown[]=[], receipts:string[]=[];
  const renderer=createHookRenderer({expand:[CoordinatorItinerary,ItineraryMessage,ItineraryDocument,ItineraryPublishConfirmation]});
  const click=(label:string,last=false)=>{const nodes=renderer.findAll(n=>n.type==="button"&&textOf(n)===label);(nodes[last?nodes.length-1:0].props.onClick as ()=>void)();};
  const props={draft,turnId:draft.threadId,current:true,slug:"feedback",actorId:draft.ownerId,disabled:false,onSave:async(request:DocumentSave)=>({turnId:request.turnId,draft:{...draft,version:request.expectedVersion+1,content:request.content}}),onAction:async(action:unknown)=>{calls.push(action);return projection;},onSharingChanged:async(id:string)=>{receipts.push(id);}};
  try {
    renderer.render(createElement(CoordinatorItinerary,props));await settle(5);renderer.flush();
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "),/Review what the group will see|Prepare group review draft/);
    assert.doesNotMatch(renderer.findAll(n=>n.type==="summary").map(textOf).join(" "),/Still to decide|Private planning notes|Add items to Plan|Imported commentary|Revision history/);
    click("Share with the group");renderer.flush();assert.deepEqual(calls,[]);assert.equal(requests.length,0);assert.match(renderer.tree.map(textOf).join(" "),/No email or SMS notifications/);
    click("Cancel");renderer.flush();assert.equal(requests.length,0);
    click("Share with the group");renderer.flush();click("Share with the group",true);await settle(10);renderer.flush();
    assert.deepEqual(calls,[{operation:"prepare_poll"}]);assert.equal(requests.length,1);assert.equal(requests[0].draftId,projection.id);assert.equal(requests[0].draftVersion,3);assert.deepEqual(requests[0].publicationApproval,{approved:true,access:"invitees"});assert.deepEqual(receipts,[poll.id]);assert.doesNotMatch(JSON.stringify(requests),/PRIVATE_/);
    renderer.render(createElement(CoordinatorItinerary,{...props,hasPublishedVersion:true}));renderer.flush();assert.equal(renderer.findAll(n=>n.type==="button"&&textOf(n)==="Share with the group").length,1);
  } finally {renderer.unmount();live.restore();}
});

test("group-input Work omits canonical conversion; failed edits survive remount and stay actor-scoped", async () => {
  const live = installFakeLiveEnvironment();
  const { CoordinatorItinerary } = await import("./coordinator-itinerary");
  const { ItineraryTimeline } = await import("./itinerary-timeline");
  const draft = syntheticDraft(); draft.content.items[0].time = "19:30";
  let fail = true;
  const calls: unknown[] = [];
  let flush: (() => Promise<DocumentState>) | null = null;
  const props = { draft, turnId: draft.threadId, onReady: (next: (() => Promise<DocumentState>) | null) => { flush = next; }, onSave: async (request: DocumentSave) => { calls.push(request); if (fail) throw new Error("Temporary failure"); return { turnId: request.turnId, draft: { ...draft, version: request.expectedVersion + 1, content: request.content } }; }, current: true, slug: "synthetic", actorId: "organizer-a", disabled: false, onAction: async (action: unknown) => { calls.push(action); if (fail) throw new Error("Temporary failure"); } };
  let renderer = createHookRenderer({ expand: [CoordinatorItinerary, ItineraryTimeline] });
  const click = (label: string) => (renderer.find(node => node.type === "button" && textOf(node) === label).props.onClick as () => void)();
  try {
    renderer.render(createElement(CoordinatorItinerary, props)); await settle(5); renderer.flush();
    (renderer.find(node=>node.type==="button" && textOf(node)==="Edit").props.onClick as ()=>void)();renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "), /7:30 PM/);
    assert.equal(renderer.findAll(node => node.type === "input" && node.props.type === "checkbox").length, 0, "group input has no canonical conversion controls");
    (renderer.find(node => node.type === "input" && node.props["aria-label"] === "Title for Dinner near the hotel on 2026-11-05").props.onChange as (event: unknown) => void)({ target: { value: "My unsaved dinner" } }); renderer.flush();
    assert.ok(flush); await assert.rejects((flush as unknown as () => Promise<DocumentState>)()); await settle(5); renderer.flush();
    renderer.unmount(); renderer = createHookRenderer({ expand: [CoordinatorItinerary, ItineraryTimeline] });
    renderer.render(createElement(CoordinatorItinerary, props)); await settle(5); renderer.flush();
    click("Edit");renderer.flush();
    assert.equal(renderer.find(node => node.type === "input" && node.props["aria-label"] === "Title for My unsaved dinner on 2026-11-05").props.value, "My unsaved dinner");
    renderer.unmount(); renderer = createHookRenderer({ expand: [CoordinatorItinerary, ItineraryTimeline] });
    renderer.render(createElement(CoordinatorItinerary, { ...props, actorId: "organizer-b" })); await settle(5); renderer.flush();
    click("Edit");renderer.flush();
    assert.equal(renderer.find(node => node.type === "input" && node.props["aria-label"] === "Title for Dinner near the hotel on 2026-11-05").props.value, "Dinner near the hotel");
    fail = false;
  } finally { renderer.unmount(); live.restore(); }
});


test("timeline preserves supplied order, optional undated interests and missing times without writes", async () => {
  const { ItineraryTimeline } = await import("./itinerary-timeline");
  const items = syntheticDraft().content.items;
  items[0].time = "19:30";
  items.push({ ...items[0], id: "yoga", title: "Yoga", day: null, time: null, participation: "optional" });
  const before = JSON.stringify(items);
  const renderer = createHookRenderer({ expand: [ItineraryTimeline] });
  try {
    renderer.render(createElement(ItineraryTimeline, { items, renderDetails: item => createElement("p", null, item.note) }));
    const headings = renderer.findAll(node => node.type === "h4").map(textOf);
    assert.ok(headings.includes("Thursday, November 5"));
    assert.equal(headings.at(-1), "Unscheduled interests and ideas");
    const rows = renderer.findAll(node => node.type === "details");
    assert.equal(rows.length, items.length);
    assert.ok(rows.every(row => !row.props.open));
    const summaries = renderer.findAll(node => node.type === "summary").map(textOf);
    assert.match(summaries[0], /7:30 PM/);
    assert.match(summaries.at(-1)!, /Day open.*Yoga.*Optional/);
    assert.ok(summaries.some(summary => summary.includes("Time open")));
    assert.equal(JSON.stringify(items), before);
    assert.equal(renderer.findAll(node => node.type === "input").length, 0);
  } finally { renderer.unmount(); }
});

test("historical saved Task receipts remain linked to normal Tasks without assignment controls", async () => {
  const live = installFakeLiveEnvironment();
  const { CoordinatorItinerary } = await import("./coordinator-itinerary");
  const draft = syntheticDraft(), candidate = draft.content.tasks[0], savedId = crypto.randomUUID();
  draft.receipts = [{ candidateId: candidate.id, kind: "task", savedId, commandId: crypto.randomUUID() }];
  const renderer = createHookRenderer({ expand: [CoordinatorItinerary] });
  try {
    renderer.render(createElement(CoordinatorItinerary, { draft, turnId: draft.threadId, onSave: async request => ({ turnId: request.turnId, draft: { ...draft, version: request.expectedVersion + 1, content: request.content } }), current: true, slug: "saved-task", actorId: draft.ownerId, disabled: false, onAction: async () => { throw new Error("Read only"); } })); await settle(5); renderer.flush();
    const link = renderer.find(node => node.type === "a" && textOf(node) === "Open saved task");
    assert.ok(String(link.props.href).includes(`todo=${savedId}`));
    assert.equal(renderer.findAll(node => node.type === "select").length, 0);
    assert.deepEqual(draft.receipts.map(receipt => receipt.savedId), [savedId]);
  } finally { renderer.unmount(); live.restore(); }
});


test("default is an editable email; structural Edit allows section dragging without changing stop dates",async()=>{
  const live=installFakeLiveEnvironment();const {CoordinatorItinerary}=await import("./coordinator-itinerary"),{ItineraryMessage}=await import("./itinerary-message"),{ItineraryDocument}=await import("./itinerary-document"),{EditableProse}=await import("./editable-prose"),{ItineraryTimeline}=await import("./itinerary-timeline");
  const draft=syntheticDraft();draft.content.title="A".repeat(160);draft.content.tasks=[];draft.content.opening="Welcome to wine country!";draft.content.days=[{day:"2026-11-05",description:"Thursday narrative"},{day:"2026-11-06",description:"Friday narrative"},{day:"2026-11-07",description:"Saturday narrative"}];draft.content.items[0].participantNote="A relaxed dinner together.";draft.content.items.push({...draft.content.items[0],id:"optional-yoga",title:"Yoga",day:null,time:null,participation:"optional"});
  let flush:(()=>Promise<DocumentState>)|null=null;const saves:DocumentSave[]=[];
  const renderer=createHookRenderer({expand:[CoordinatorItinerary,ItineraryMessage,ItineraryDocument,EditableProse,ItineraryTimeline]});
  try {
    renderer.render(createElement(CoordinatorItinerary,{draft,turnId:draft.threadId,current:true,slug:"message-qa",actorId:draft.ownerId,disabled:false,onReady:value=>{flush=value;},onSave:async request=>{saves.push(request);return{turnId:request.turnId,draft:{...draft,version:request.expectedVersion+1,content:request.content}};},onAction:async()=>{throw new Error("No consequential action authorized");}}));await settle(5);renderer.flush();
    assert.equal(renderer.findAll(node=>node.type==="input"&&node.props.type==="date").length,0);
    assert.equal(renderer.findAll(node=>node.type==="button"&&textOf(node)==="Add question").length,0);
    assert.match(String(renderer.find(node=>node.type==="textarea"&&node.props["aria-label"]==="Closing for the group").props.value),/What would you change or add/);
    assert.equal(renderer.findAll(node=>node.type==="textarea" && String(node.props["aria-label"]).startsWith("Title for ")).every(node=>node.props.maxLength===120),true,"dated and undated titles match the private schema limit");
    const proseLabels=renderer.findAll(node=>node.type==="textarea").map(node=>String(node.props["aria-label"]));
    assert.ok(proseLabels.includes("Heading for Thursday, November 5"));
    assert.ok(proseLabels.includes("Title for Yoga (optional idea)"));
    for(const label of proseLabels)assert.doesNotMatch(label,/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9-]{20,}/i,"field names are readable rather than UUIDs");
    const opening=renderer.find(node=>node.type==="textarea"&&node.props["aria-label"]==="Opening for the group");(opening.props.onChange as (event:unknown)=>void)({target:{value:"Welcome, everyone. Let’s unwind together."}});renderer.flush();
    await (flush as unknown as ()=>Promise<DocumentState>)();renderer.flush();assert.equal(saves.at(-1)!.content.opening,"Welcome, everyone. Let’s unwind together.");assert.equal(saves.at(-1)!.content.title,draft.content.title);
    const heading=renderer.find(node=>node.type==="textarea" && String(node.props["aria-label"]).startsWith("Heading for "));(heading.props.onChange as (event:unknown)=>void)({target:{value:"Thursday — Arrive and unwind"}});renderer.flush();await (flush as unknown as ()=>Promise<DocumentState>)();renderer.flush();assert.equal(saves.at(-1)!.content.days![0].label,"Thursday — Arrive and unwind");
    (renderer.find(node=>node.type==="textarea"&&node.props["aria-label"]==="Closing for the group").props.onChange as (event:unknown)=>void)({target:{value:"Tell us what you’d enjoy most!"}});renderer.flush();await (flush as unknown as ()=>Promise<DocumentState>)();renderer.flush();assert.equal(saves.at(-1)!.content.closing,"Tell us what you’d enjoy most!");
    (renderer.find(node=>node.type==="button"&&textOf(node)==="Edit").props.onClick as ()=>void)();renderer.flush();
    assert.ok(renderer.findAll(node=>node.type==="input"&&node.props.type==="date").length>0);
    const handles=renderer.findAll(node=>node.type==="button"&&String(node.props["aria-label"]).startsWith("Drag "));
    assert.equal(handles.length,3);assert.equal(handles[0].props.draggable,true);
    const drag={dataTransfer:{setData(){},effectAllowed:"",dropEffect:""},preventDefault(){}};
    (handles[0].props.onDragStart as (event:unknown)=>void)(drag);
    const target=renderer.find(node=>node.props["data-itinerary-section"]==="2026-11-07");(target.props.onDrop as (event:unknown)=>void)(drag);renderer.flush();
    await (flush as unknown as ()=>Promise<DocumentState>)();renderer.flush();assert.deepEqual(saves.at(-1)!.content.days!.map(day=>day.day),["2026-11-06","2026-11-07","2026-11-05"]);
    assert.deepEqual(saves.at(-1)!.content.items,draft.content.items,"section order does not reschedule stops");
    (renderer.find(node=>node.type==="button"&&textOf(node)==="Done editing").props.onClick as ()=>void)();renderer.flush();
    assert.deepEqual(renderer.findAll(node=>node.type==="textarea" && String(node.props["aria-label"]).startsWith("Heading for ")).map(node=>node.props.value).slice(0,3),["Friday, November 6","Saturday, November 7","Thursday — Arrive and unwind"]);
  } finally {renderer.unmount();live.restore();}
});


test("preparing review exposes the actual safe action error instead of a generic refresh instruction",async()=>{
 const live=installFakeLiveEnvironment();const {CoordinatorItinerary}=await import("./coordinator-itinerary"),{CoordinatorRequestError}=await import("../lib/coordinator-client");const {ItineraryPublishConfirmation}=await import("./itinerary-publish-confirmation");const draft=syntheticDraft(),renderer=createHookRenderer({expand:[CoordinatorItinerary,ItineraryPublishConfirmation]});
 try{renderer.render(createElement(CoordinatorItinerary,{draft,turnId:draft.threadId,current:true,slug:"qa-error",actorId:draft.ownerId,disabled:false,onSave:async()=>{throw new Error("No save needed");},onAction:async()=>{throw new CoordinatorRequestError({code:"stale_version",retryable:false,userMessage:"This document changed in another tab. Reload the saved version before preparing group review."},409);}}));await settle(5);renderer.flush();(renderer.find(node=>node.type==="button"&&textOf(node)==="Share with the group").props.onClick as ()=>void)();renderer.flush();(renderer.findAll(node=>node.type==="button"&&textOf(node)==="Share with the group").at(-1)!.props.onClick as ()=>void)();await settle(5);renderer.flush();assert.match(textOf(renderer.find(node=>node.props.role==="alert")),/changed in another tab/);}
 finally{renderer.unmount();live.restore();}
});

test("activity decision controls require the server-granted account pilot", async () => {
  const live = installFakeLiveEnvironment({ liveFetch: async () => Response.json({}) });
  const { CoordinatorItinerary } = await import("./coordinator-itinerary");
  const draft = syntheticDraft();
  draft.content.questions = [{ id: "q", prompt: "Lunch?" }];
  const renderer = createHookRenderer({ expand: [CoordinatorItinerary] });
  const props = { draft, turnId: draft.threadId, current: true, slug: "feedback", actorId: draft.ownerId, disabled: false, hasPublishedVersion: true,
    onSave: async (request: DocumentSave) => ({ turnId: request.turnId, draft: { ...draft, content: request.content } }), onAction: async () => {} };
  try {
    renderer.render(createElement(CoordinatorItinerary, props)); await settle(5); renderer.flush();
    assert.equal(renderer.findAll(n => n.type === "button" && textOf(n) === "Review additions to Plan").length, 0);
    renderer.render(createElement(CoordinatorItinerary, { ...props, activityDecisionsEnabled: true })); renderer.flush();
    assert.equal(renderer.findAll(n => n.type === "button" && textOf(n) === "Review additions to Plan").length, 1);
    const edit = renderer.findAll(n => n.type === "button" && textOf(n) === "Edit")[0];
    assert.ok(edit); (edit.props.onClick as () => void)(); renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "), /Add a saved activity/);
    assert.match(renderer.tree.map(textOf).join(" "), /Resolved — leave out of the next group ask/);
    renderer.render(createElement(CoordinatorItinerary, props)); renderer.flush();
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "), /Add a saved activity|Resolved — leave out of the next group ask/);
  } finally { renderer.unmount(); live.restore(); }
});
