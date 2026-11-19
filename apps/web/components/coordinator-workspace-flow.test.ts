import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { CoordinatorThreadSchema, PollWorkingDraftSchema } from "@commons/contracts";
import { pollDrafts, itineraryItems } from "@commons/database";
import { itineraryQuestion } from "../lib/itinerary-workshop";
import { createHookRenderer, registerComponentImportStubs, textOf, type HostNode, type OpaqueNode } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
import { actAs, createRouteFetch, fakeProviderResponse, databaseTestsEnabled, eq, jsonRequest, loadCoordinatorRoutes, params, seedSyntheticTrip, withTestDatabase, type RouteRecord } from "../lib/server/coordinator-route-harness";

// End-to-end client reproductions: the real CoordinatorWorkspace and voice
// component run under the hook harness; their fetches go to the real route
// handlers and the disposable local database; the model provider and WebRTC are
// fakes. Every voice test here uses a fake microphone, peer and Live session (no real OpenAI); the repro tests began as failing `todo` tests
// (design doc §1) and are ordinary passing tests now.
const skip = !databaseTestsEnabled;
registerComponentImportStubs();

async function mountWorkspace(options: { threadTitle: string; voice: boolean; draft?: boolean; embedded?: boolean; failFirst?: boolean; delayedStartup?: boolean; holdFirstPost?: boolean; proposePoll?: boolean; layout?: "legacy" | "persistent" }) {
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  let failFirst=Boolean(options.failFirst);
  const router = createRouteFetch(routes,options.failFirst || options.proposePoll ? {provider:body=>{if(failFirst){failFirst=false;return Response.json({error:"Synthetic failure"},{status:503});}return fakeProviderResponse(body as Parameters<typeof fakeProviderResponse>[0],"A private proposal for review.","Choose lodging",{operations:[{kind:"add_question",prompt:"Which option works?",selectionMode:"single",options:[{label:"A",description:null},{label:"B",description:null}]}]});}} : undefined);
  const draftRoute=await import("../app/api/v1/commons/[slug]/poll-drafts/route");
  let releasePost: () => void = () => {};
  let firstPostHeld = false;
  const firstPost = new Promise<void>(resolve => { releasePost = resolve; });
  const live = installFakeLiveEnvironment({ liveFetch: async(url,init) => {
    const path=new URL(String(url),"http://localhost").pathname;
    if ((options.delayedStartup || options.holdFirstPost) && !firstPostHeld && init?.method === "POST" && path.endsWith("/turns")) { firstPostHeld = true; await firstPost; }
    return path.endsWith("/poll-drafts") ? draftRoute.POST(new Request(new URL(String(url),"http://localhost"),init),params(trip.eventId)) : router.fetch(url,init);
  } });
  const originalFrame = window.requestAnimationFrame, originalCancelFrame = window.cancelAnimationFrame;
  const delayedFrames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  if (options.delayedStartup) {
    window.requestAnimationFrame = callback => { const id = ++frameId; delayedFrames.set(id, callback); return id; };
    window.cancelAnimationFrame = id => { delayedFrames.delete(id); };
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  }
  if(options.embedded) window.history.pushState=(_data,_unused,url)=>{
    const target=new URL(String(url),"http://localhost");
    Object.assign(window.location,{pathname:target.pathname,search:target.search});
  };
  process.env.OPENROUTER_API_KEY = "test-openrouter-key"; process.env.OPENAI_API_KEY = "test-openai-key";
  actAs(trip.organizerId);
  const created = await (await routes.threads.POST(jsonRequest(trip.eventId, "/threads", "POST", { id: randomUUID(), commandId: randomUUID(), title: options.threadTitle }), params(trip.eventId))).json();
  let initialThread = CoordinatorThreadSchema.parse(created);
  if(options.draft){
    await withTestDatabase(db=>db.insert(pollDrafts).values({id:randomUUID(),commonsId:trip.eventId,threadId:initialThread.activeThreadId,ownerPersonId:trip.organizerId,organizerShared:true,data:{title:"Synthetic dinner poll",intro:null,ballotMode:"transparent",questions:[]},lastCommandId:randomUUID(),lastCommandFingerprint:"synthetic"}));
    initialThread=CoordinatorThreadSchema.parse(await (await routes.turn.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator?threadId=${initialThread.activeThreadId}`),params(trip.eventId))).json());
  }
  const [{ CoordinatorWorkspace }, { CoordinatorLiveConversation }, { AppRouterContext }, {ItineraryDraftEditor}] = await Promise.all([
    import("./coordinator-workspace"), import("./coordinator-live-conversation"), import("next/dist/shared/lib/app-router-context.shared-runtime"), import("./itinerary-draft-editor"),
  ]);
  const fakeRouter = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} };
  const {ItineraryOrganizerActions}=await import("./itinerary-organizer-actions");
  const {CoordinatorComposerMenu}=await import("./coordinator-composer-menu");
  const {WorkspacePaneLayout}=await import("./workspace-pane-layout");
  const {CoordinatorContextSelector}=await import("./coordinator-context-selector");
  const makeRenderer=()=>createHookRenderer({ expand: [CoordinatorWorkspace, CoordinatorLiveConversation, ItineraryDraftEditor, ItineraryOrganizerActions, CoordinatorComposerMenu, WorkspacePaneLayout, CoordinatorContextSelector], context: context => context === AppRouterContext ? fakeRouter : undefined });
  let renderer = makeRenderer();
  const workspaceProps={ slug: trip.eventId, actorId:trip.organizerId, eventName: "Synthetic Breckenridge weekend", initialThread, initialRecommendations: [], conversationAvailable: true, voiceAvailable: options.voice, embedded:options.embedded, layout: options.layout };
  renderer.render(createElement(CoordinatorWorkspace, workspaceProps));
  await settle(5);
  renderer.flush();
  const records = router.records;
  return {
    trip, get renderer(){return renderer;}, live, records,
    releasePost,
    async waitForHeldPost() { for (let i=0;i<250;i++) { if(firstPostHeld)return; await settle(20); renderer.flush(); } throw new Error("New turn POST was never held"); },
    releaseStartupFrames() { window.requestAnimationFrame = originalFrame; window.cancelAnimationFrame = originalCancelFrame; globalThis.requestAnimationFrame = originalFrame; globalThis.cancelAnimationFrame = originalCancelFrame; for (const callback of delayedFrames.values()) callback(Date.now()); delayedFrames.clear(); },
    async remount(threadId=initialThread.activeThreadId){
      renderer.unmount();
      workspaceProps.initialThread=CoordinatorThreadSchema.parse(await (await routes.turn.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator?threadId=${threadId}`),params(trip.eventId))).json());
      renderer=makeRenderer();renderer.render(createElement(CoordinatorWorkspace,workspaceProps));await settle(10);renderer.flush();
    },
    navigate(selected:string,revision:number){renderer.render(createElement(CoordinatorWorkspace,{...workspaceProps,navigation:{selected,revision}}));},
    async waitForTurns(count: number) {
      for (let waited = 0; waited < 5_000; waited += 20) {
        if (records.filter(isTurnPost).length >= count) { await settle(5); renderer.flush(); return; }
        await settle(20); renderer.flush();
      }
      throw new Error(`Timed out waiting for ${count} coordinator turn request(s): ${JSON.stringify(summary(records))}`);
    },
    async cleanup() { renderer.unmount(); live.restore(); delete process.env.OPENROUTER_API_KEY; delete process.env.OPENAI_API_KEY; await trip.cleanup(); },
  };
}

/** Threaded turns go to /turns; unthreaded legacy contexts still use the original route. */
const isTurnPost = (record: RouteRecord) => record.method === "POST" && (record.path === "/" || record.path === "/turns");

function summary(records: RouteRecord[]) {
  return records.map(record => `${record.method} ${record.path || "/"} ${record.status}${record.status >= 400 ? ` ${(record.body as { error?: string } | null)?.error ?? ""}` : ""}`);
}
const byLabel = (label: string) => (node: HostNode | OpaqueNode) => node.props["aria-label"] === label;

test("failed Ask the group retains its exact action for retry after reload", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Main conversation", voice: false, failFirst: true });
  try {
    (app.renderer.find(node => node.type === "button" && textOf(node) === "Ask the group").props.onClick as () => void)(); app.renderer.flush();
    (app.renderer.find(byLabel("Message your coordinator")).props.onChange as (event: unknown) => void)({ target: { value: "Prepare a poll asking which option works: A or B." } }); app.renderer.flush();
    (app.renderer.find(node => node.type === "form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await app.waitForTurns(1);
    for (let attempt=0;attempt<100&&!app.renderer.findAll(node=>typeof node.props.onRetry === "function").length;attempt++){await settle(20);app.renderer.flush();}
    const failed = app.renderer.find(node => typeof node.props.onRetry === "function" && Boolean(node.props.turn));
    const turn = failed.props.turn as { threadId: string; commandId: string };
    await app.remount(turn.threadId);
    const retry = app.renderer.find(node => typeof node.props.onRetry === "function" && Boolean(node.props.turn));
    (retry.props.onRetry as () => void)(); await app.waitForTurns(2);
    const routes = await loadCoordinatorRoutes();
    const read = async () => CoordinatorThreadSchema.parse(await (await routes.turn.GET(new Request(`http://localhost/api/v1/commons/${app.trip.eventId}/coordinator?threadId=${turn.threadId}`), params(app.trip.eventId))).json());
    let thread = await read();
    // Stream headers arrive before retry admission. On a slower database the first read can
    // still see the previous failed attempt; wait for the expected saved outcome, not just
    // while status is pending. A genuinely failed retry still fails the assertion below.
    const retryDeadline = Date.now() + 10_000;
    while (thread.turns[0].status !== "completed" && Date.now() < retryDeadline) {
      await settle(20); app.renderer.flush(); thread = await read();
    }
    assert.equal(thread.turns.length, 1);
    assert.equal(thread.turns[0].commandId, turn.commandId);
    assert.equal(thread.turns[0].status, "completed", JSON.stringify(summary(app.records)));
    assert.equal(thread.drafts.length, 1);
    assert.equal(thread.threads.length, 1, "Ask the group stays in the existing conversation");
    assert.equal(thread.drafts[0].data.questions.length, 1);
    await settle(50); app.renderer.flush();
    assert.equal(app.renderer.find(byLabel("Working material")).props.hidden, false, "successful retry opens the saved poll in Work");
    const review = app.renderer.find(node => typeof node.props.onPublished === "function");
    assert.equal((review.props.initialDraft as {id:string}).id, thread.drafts[0].id);
    await app.remount(turn.threadId);
    assert.ok(app.renderer.findAll(node => node.type === "button" && textOf(node) === "Review poll").length, "saved poll has a durable reopening button");
  } finally { await app.cleanup(); }
});

test("working material collapses navigation without changing the conversation or its unsent message", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Choose lodging", voice: false, draft: true, embedded: true });
  const layout = () => app.renderer.find(node => node.props.className === "review-layout workspace-columns");
  const click = (label: string) => {
    (app.renderer.find(byLabel(label)).props.onClick as () => void)();
    app.renderer.flush();
  };
  try {
    const unsent = "Keep this message while I review the poll";
    (app.renderer.find(byLabel("Message your coordinator")).props.onChange as (event: unknown) => void)({ target: { value: unsent } });
    app.renderer.flush();
    assert.equal(layout().props["data-board"], "expanded");
    click("Open working material");
    assert.equal(layout().props["data-pane"], "work");
    assert.equal(layout().props["data-board"], "collapsed");
    assert.equal(app.renderer.find(byLabel("Message your coordinator")).props.value, unsent);
    assert.equal(app.renderer.find(byLabel("Working material")).props.hidden, false);
    click("Close working material");
    assert.equal(layout().props["data-pane"], "conversation");
    assert.equal(layout().props["data-board"], "expanded");
    click("Open working material");
    click("Show Trip board");
    assert.equal(layout().props["data-pane"], "conversation");
    assert.equal(layout().props["data-board"], "expanded");
    assert.equal(app.renderer.find(byLabel("Working material")).props.hidden, true);
    click("Hide Trip board");
    click("Open working material");
    click("Close working material");
    assert.equal(layout().props["data-board"], "collapsed", "an explicitly collapsed navigation stays collapsed");
    assert.equal(app.renderer.find(byLabel("Message your coordinator")).props.value, unsent);
    assert.equal(app.records.filter(isTurnPost).length, 0, "opening either rail never sends the draft");
  } finally { await app.cleanup(); }
});

// Observed code finding: "New thread currently calls the question/poll starter".
test("repro 3: New thread starts an ordinary conversation without creating a poll draft", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Lodging", voice: false });
  try {
    (app.renderer.find(byLabel("Start something new")).props.onClick as () => void)();
    app.renderer.flush();
    (app.renderer.find(byLabel("Message your coordinator")).props.onChange as (event: unknown) => void)({ target: { value: "Where should we eat on Saturday around 5?" } });
    app.renderer.flush();
    (app.renderer.find(node => node.type === "form" && node.props.className === "review-composer").props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
    await app.waitForTurns(1);
    const drafts = await withTestDatabase(db => db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, app.trip.eventId)));
    const observed = { requests: summary(app.records), pollDraftsCreated: drafts.length };
    assert.deepEqual({ draftRequests: app.records.filter(record => record.path === "/drafts").length, pollDraftsCreated: drafts.length, turnStatus: app.records.filter(isTurnPost).at(-1)?.status },
      { draftRequests: 0, pollDraftsCreated: 0, turnStatus: 200 }, `observed on current code: ${JSON.stringify(observed)}`);
  } finally { await app.cleanup(); }
});

// Observed failure 2 end-to-end: the second voice request in the same session.
test("repro 2: the second voice request in one session saves to the same thread with the updated version [mocked voice transport and provider]", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Dinner", voice: true });
  try {
    (app.renderer.find(byLabel("Talk with Commons")).props.onClick as () => void)();
    await settle(5);
    app.renderer.flush();
    const channel = app.live.channel!;
    channel.emit({ type: "session.started" });
    channel.emit({ type: "session.input_transcript.delta", delta: "We are driving up from Denver.", start_ms: 100, end_ms: 900 });
    channel.emit({ type: "session.delegation.created", delegation: { id: "delegation-1", target: "client" }, offset_ms: 1_000 });
    await app.waitForTurns(1);
    channel.emit({ type: "session.input_transcript.delta", delta: "Where should we eat around five?", start_ms: 2_100, end_ms: 2_900 });
    channel.emit({ type: "session.delegation.created", delegation: { id: "delegation-2", target: "client" }, offset_ms: 3_000 });
    await app.waitForTurns(2);
    await settle(20);
    const turnRequests = app.records.filter(isTurnPost);
    const spoken = channel.sent.filter(event => event.type === "session.commentary.append").map(event => `${event.delegation_id}: ${event.content}`);
    const observed = { requests: summary(app.records), spokenToModel: spoken };
    assert.deepEqual(turnRequests.map(record => record.status), [200, 200], `observed on current code: ${JSON.stringify(observed)}`);
  } finally { await app.cleanup(); }
});

test("delayed startup recovery ignores a new request sent by this mounted page", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Lodging", voice: false, delayedStartup: true });
  try {
    (app.renderer.find(byLabel("Start something new")).props.onClick as () => void)(); app.renderer.flush();
    const input = app.renderer.find(node => node.type === "textarea" && node.props["aria-label"] === "Message your coordinator");
    (input.props.onChange as (event: unknown) => void)({target:{value:"Plan dinner on Saturday"}}); app.renderer.flush();
    (app.renderer.find(node => node.type === "form" && node.props.className === "review-composer").props.onSubmit as (event: unknown) => void)({preventDefault(){}});
    await app.waitForHeldPost();
    app.releaseStartupFrames(); await settle(50); app.renderer.flush();
    assert.equal(app.records.filter(record => record.path.startsWith("/turns/")).length, 0, "startup recovery must not look up this page's request before its first POST reaches the server");
    app.releasePost(); await app.waitForTurns(1);
    for (let i=0;i<250&&!app.records.some(record=>record.path.startsWith("?threadId="));i++) { await settle(20); app.renderer.flush(); }
    assert.ok(app.records.some(record=>record.path.startsWith("?threadId=")), "client has loaded the completed request before teardown");
  } finally { app.releasePost(); await app.cleanup(); }
});

// Same stale-closure mechanism when voice starts on a fresh topic: every later
// delegation replays the session-start "new topic" state.
test("repro 2b: voice started on New thread creates one thread for the whole session [mocked voice transport and provider]", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Lodging", voice: true });
  try {
    (app.renderer.find(byLabel("Start something new")).props.onClick as () => void)();
    app.renderer.flush();
    (app.renderer.find(byLabel("Talk with Commons")).props.onClick as () => void)();
    await settle(5);
    app.renderer.flush();
    const channel = app.live.channel!;
    channel.emit({ type: "session.started" });
    channel.emit({ type: "session.input_transcript.delta", delta: "Let's plan dinner on Saturday.", start_ms: 100, end_ms: 900 });
    channel.emit({ type: "session.delegation.created", delegation: { id: "delegation-1", target: "client" }, offset_ms: 1_000 });
    await app.waitForTurns(1);
    channel.emit({ type: "session.input_transcript.delta", delta: "Somewhere near the stay around five.", start_ms: 2_100, end_ms: 2_900 });
    channel.emit({ type: "session.delegation.created", delegation: { id: "delegation-2", target: "client" }, offset_ms: 3_000 });
    await app.waitForTurns(2);
    await settle(50);
    // A new conversation is created by its first turn (there is no separate /threads request): one thread for the whole session.
    const threadIds = new Set(app.records.filter(record => record.method === "GET" && record.path.startsWith("?threadId=")).map(record => record.path.slice("?threadId=".length)));
    const observed = { requests: summary(app.records) };
    assert.deepEqual({ threadsCreatedSeparately: app.records.filter(record => record.method === "POST" && record.path === "/threads").length, distinctThreads: threadIds.size, failures: app.records.filter(record => record.status >= 400).length },
      { threadsCreatedSeparately: 0, distinctThreads: 1, failures: 0 }, `observed: ${JSON.stringify(observed)}`);
  } finally { await app.cleanup(); }
});

test("delayed publication refresh preserves the chosen Conversation pane",{skip},async()=>{
 const app=await mountWorkspace({threadTitle:"Collect dinner choices",voice:false,draft:true});
 const originalFetch=globalThis.fetch;let release:()=>void=()=>{};let held=false;
 globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const response=await originalFetch(input,init);
  if(!held&&String(input).includes("/coordinator?threadId=")){held=true;await new Promise<void>(resolve=>{release=resolve;});}
  return response;
 }) as typeof fetch;
 try{
  const published=app.renderer.find(node=>typeof node.props.onPublished==="function");
  const completion=(published.props.onPublished as (id:string)=>Promise<void>)(randomUUID());
  for(let tries=0;tries<100&&!held;tries++)await settle(10);assert.ok(held,"the real route refresh is delayed");
  const conversation=()=>app.renderer.find(node=>node.type==="button"&&textOf(node)==="Conversation");
  (conversation().props.onClick as ()=>void)();app.renderer.flush();assert.equal(conversation().props["aria-pressed"],true);
  release();await completion;app.renderer.flush();assert.equal(conversation().props["aria-pressed"],true,"a late publish result does not reopen Share");
 }finally{release();globalThis.fetch=originalFetch;await app.cleanup();}
});

test("pasting a long rendered itinerary opens Work and autosaves only the private draft",{skip},async()=>{
  const app=await mountWorkspace({threadTitle:"Coordinator",voice:false,embedded:true});
  const source="Thursday: Arrival\n1:12 PM Land at SFO\n"+"Keep this supplied note. ".repeat(100)+"\n7:30 PM Dinner in Sonoma\nFriday: Wineries\n10:00 AM Flowers";
  const originalPlans=await withTestDatabase(db=>db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,app.trip.eventId)));
  async function until(condition:()=>boolean) {
    for(let i=0;i<250;i++){app.renderer.flush();if(condition())return;await settle(20);}
    assert.ok(condition(),"the client workflow did not finish");
  }
  try{
    const input=app.renderer.find(byLabel("Message your coordinator"));
    assert.ok(Number(input.props.maxLength)>=source.length);
    (input.props.onChange as (event:unknown)=>void)({target:{value:source}});app.renderer.flush();
    assert.ok(app.renderer.find(byLabel("Review pasted itinerary")));
    (app.renderer.find(node=>node.type==="form"&&node.props.className==="review-composer").props.onSubmit as (event:unknown)=>void)({preventDefault(){}});
    for(let i=0;i<100&&!app.records.some(record=>record.path==="/drafts");i++){await settle(20);app.renderer.flush();}
    await until(()=>app.renderer.findAll(node=>node.type==="textarea"&&node.props.rows===6&&node.props.value===source).length===1);
    assert.equal(app.records.filter(isTurnPost).length,0,"pasting did not send a truncated request to the model");
    const before=await withTestDatabase(db=>db.select().from(pollDrafts).where(eq(pollDrafts.commonsId,app.trip.eventId)));
    assert.equal(before.length,1);
    const main=`thread:${before[0].threadId}`;
    assert.equal(new URLSearchParams(window.location.search).get("thread"),before[0].threadId,"opening the editor writes its real thread deep link");
    assert.equal(app.renderer.find(node=>node.type==="div"&&node.props.className==="review-layout workspace-columns").props["data-pane"],"work","writing the deep link keeps its editor open");
    assert.equal(itineraryQuestion(before[0].data.questions)!.itinerary.days[0].items.length,0,"review is not yet saved");
    assert.equal(app.renderer.find(node=>node.type==="textarea"&&node.props.maxLength===30000&&node.props.rows===6).props.value,source);
    await until(()=>app.renderer.find(byLabel("Message your coordinator")).props.value==="");
    const after=await withTestDatabase(db=>db.select().from(pollDrafts).where(eq(pollDrafts.commonsId,app.trip.eventId)));
    assert.equal(after.length,1);assert.equal(after[0].version,before[0].version+1);
    const saved=PollWorkingDraftSchema.parse({...after[0],updatedAt:after[0].updatedAt.toISOString()});
    assert.equal(saved.data.itinerarySource,source);assert.equal(saved.publishedPollId,null);
    assert.deepEqual(itineraryQuestion(saved.data.questions)!.itinerary.days.map(day=>day.label),["Thursday: Arrival","Friday: Wineries"]);
    assert.equal(app.renderer.find(byLabel("Message your coordinator")).props.value,"");
    await app.remount(); await until(()=>app.renderer.findAll(node=>node.type==="textarea"&&node.props.rows===6&&node.props.value===source).length===1);
    assert.deepEqual(await withTestDatabase(db=>db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,app.trip.eventId))),originalPlans);
    app.navigate(main,1);await until(()=>app.renderer.find(node=>node.type==="div"&&node.props.className==="review-layout workspace-columns").props["data-pane"]==="conversation");
    assert.equal(app.renderer.find(node=>node.type==="div"&&node.props.className==="review-layout workspace-columns").props["data-pane"],"conversation","explicit navigation still returns to the conversation");
  }finally{await app.cleanup();}
});


test("composer Add categories preserve the unsent draft; Help appends and direct paste stays inline with useful limits",{skip},async()=>{
 const app=await mountWorkspace({threadTitle:"Coordinator",voice:false});
 const input=()=>app.renderer.find(byLabel("Message your coordinator"));
 const set=(text:string)=>{(input().props.onChange as (event:unknown)=>void)({target:{value:text}});app.renderer.flush();};
 const open=()=>{(app.renderer.find(byLabel("Add sources or get help")).props.onClick as ()=>void)();app.renderer.flush();};
 try{
  set("Existing unsent details");open();(app.renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="Existing Itinerary").props.onClick as ()=>void)();app.renderer.flush();
  assert.equal(input().props.value,"Existing unsent details");assert.match(app.renderer.tree.map(textOf).join(" "),/Paste the itinerary here/);assert.equal(app.records.filter(record=>record.method==="POST").length,0);
  open();(app.renderer.find(node=>node.props.role==="menuitem"&&textOf(node)==="Find a place to stay").props.onClick as ()=>void)();app.renderer.flush();assert.equal(input().props.value,"Existing unsent details\n\nHelp me find a place to stay for this trip.");assert.equal(app.records.filter(record=>record.method==="POST").length,0);
  let prevented=false;const event={clipboardData:{getData:()=>"Pasted multiline\nemail content"},currentTarget:{selectionStart:0,selectionEnd:0},preventDefault:()=>{prevented=true;}};
  (input().props.onPaste as (event:unknown)=>void)(event);assert.equal(prevented,false,"native paste proceeds without a category-specific intake");
  set("Existing unsent details\nPasted multiline\nemail content");assert.match(String(input().props.value),/Pasted multiline\nemail content/);
  (input().props.onPaste as (event:unknown)=>void)({...event,clipboardData:{getData:()=>"x".repeat(30001)}});app.renderer.flush();assert.equal(prevented,true);assert.match(app.renderer.tree.map(textOf).join(" "),/30,000 characters/);assert.match(String(input().props.value),/Pasted multiline/);assert.equal(app.records.filter(record=>record.method==="POST").length,0);
 }finally{await app.cleanup();}
});

// ---- Persistent-rail layout (layout="persistent"): the same controller with Work left / conversation right, a Conversations selector, and Tasks in Work. ----
// The harness has no DOM, so the container is never measured and one surface shows at a time (`work` mode); split sizing is covered by lib/workspace-presentation.test.ts
// and workspace-pane-layout.test.ts. These tests prove state, mounting and ordering behavior around the unchanged controller.
const modeOf = (app: Awaited<ReturnType<typeof mountWorkspace>>) => String(app.renderer.find(node => node.type === "div" && node.props.className === "workspace-pane-layout").props["data-mode"]);
const slot = (app: Awaited<ReturnType<typeof mountWorkspace>>, which: "work" | "conversation") => app.renderer.find(node => node.type === "div" && node.props.className === `workspace-pane-slot workspace-pane-slot--${which}`);
const buttonByClass = (app: Awaited<ReturnType<typeof mountWorkspace>>, className: string) => app.renderer.findAll(node => node.type === "button" && String(node.props.className ?? "").split(" ").includes(className));
const clickButton = (app: Awaited<ReturnType<typeof mountWorkspace>>, className: string) => { const [button] = buttonByClass(app, className); assert.ok(button, `button .${className} is present`); (button.props.onClick as (event?: unknown) => void)({ currentTarget: { closest: () => null } }); app.renderer.flush(); };
const composerValue = (app: Awaited<ReturnType<typeof mountWorkspace>>) => app.renderer.find(byLabel("Message your coordinator")).props.value;
const type = (app: Awaited<ReturnType<typeof mountWorkspace>>, value: string) => { (app.renderer.find(byLabel("Message your coordinator")).props.onChange as (event: unknown) => void)({ target: { value } }); app.renderer.flush(); };

test("persistent: a section (never main) with one composer; Work opens on demand and closing it keeps the conversation and its unsent text", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Choose lodging", voice: false, draft: true, embedded: true, layout: "persistent" });
  try {
    assert.equal(app.renderer.findAll(node => node.type === "main").length, 0, "the shell owns the single main landmark");
    const root = app.renderer.find(node => node.type === "section" && node.props["data-layout"] === "persistent");
    assert.equal(root.props["aria-label"], "Synthetic Breckenridge weekend workspace");
    assert.equal(app.renderer.findAll(node => node.props.className === "review-layout workspace-columns").length, 0, "none of the legacy three-region markup");
    assert.equal(modeOf(app), "conversation", "no empty Work column is reserved");
    assert.equal(slot(app, "work").props.hidden, true);
    assert.equal(slot(app, "work").props.inert, true, "closed Work is hidden and inert, not merely moved");
    assert.equal(slot(app, "conversation").props.hidden, false);
    assert.equal(app.renderer.findAll(byLabel("Message your coordinator")).length, 1);
    const reviews = () => app.renderer.findAll(node => typeof node.props.onPublished === "function").length;
    assert.equal(reviews(), 1, "the draft editor is mounted once even while Work is closed");
    const unsent = "Keep this message while I review the poll";
    type(app, unsent);
    clickButton(app, "workspace-work-restore");
    assert.equal(modeOf(app), "work");
    assert.equal(slot(app, "work").props.hidden, false);
    assert.equal(slot(app, "conversation").props.hidden, true, "one readable surface when two do not fit");
    assert.equal(slot(app, "conversation").props.inert, true);
    assert.equal(composerValue(app), unsent, "the composer stayed mounted with its text");
    assert.equal(reviews(), 1, "the same editor instance, not a duplicate");
    assert.equal(app.renderer.find(node => node.type === "aside" && node.props.id === "workspace-working-pane").props["aria-label"], "Working material");
    clickButton(app, "workspace-work-back");
    assert.equal(modeOf(app), "conversation");
    assert.equal(composerValue(app), unsent);
    assert.equal(reviews(), 1);
    assert.equal(buttonByClass(app, "workspace-work-restore").length, 1, "a restore action stays because the draft is meaningful material");
    assert.equal(app.records.filter(isTurnPost).length, 0, "opening and closing Work never sends the draft");
  } finally { await app.cleanup(); }
});

test("persistent: the main conversation alone offers no empty Work to restore, and Tasks opens in Work on demand", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Main conversation", voice: false, embedded: true, layout: "persistent" });
  try {
    assert.equal(modeOf(app), "conversation");
    const tasks = () => buttonByClass(app, "workspace-tasks-toggle")[0];
    assert.equal(tasks().props["aria-label"], "Trip board", "the plain board keeps its name on the Tasks icon");
    assert.equal(tasks().props["aria-pressed"], false);
    clickButton(app, "workspace-tasks-toggle");
    assert.equal(modeOf(app), "work");
    assert.equal(tasks().props["aria-pressed"], true);
    assert.equal(app.renderer.find(node => node.type === "aside" && node.props.id === "workspace-working-pane").props["aria-label"], "Trip board");
    assert.equal(app.renderer.find(node => node.type === "div" && node.props.className === "workspace-tasks-scroll").props.hidden, false);
    assert.equal(app.renderer.find(node => node.type === "div" && node.props.className === "workspace-work-scroll").props.hidden, true, "working material is hidden and inert while Tasks shows");
    clickButton(app, "workspace-tasks-toggle");
    assert.equal(modeOf(app), "conversation", "the Tasks action toggles Work closed");
  } finally { await app.cleanup(); }
});

test("persistent: a late result does not reopen Work the organizer dismissed, and still opens it when nothing was dismissed", { skip }, async () => {
  // Embedded, as the shell mounts it: the location is then a real trip path, so product analytics looks the DOM up; give it an empty one.
  const hadDocument = "document" in globalThis;
  if (!hadDocument) Object.assign(globalThis, { document: { querySelector: () => null } });
  try { for (const dismiss of [true, false]) {
    const app = await mountWorkspace({ threadTitle: "Collect dinner choices", voice: false, embedded: true, layout: "persistent", holdFirstPost: true, proposePoll: true });
    try {
      (app.renderer.find(node => node.type === "button" && textOf(node) === "Ask the group").props.onClick as () => void)(); app.renderer.flush();
      type(app, "Prepare a poll asking which option works: A or B.");
      (app.renderer.find(node => node.type === "form").props.onSubmit as (event: unknown) => void)({ preventDefault() {} });
      await app.waitForHeldPost();
      if (dismiss) { clickButton(app, "workspace-tasks-toggle"); clickButton(app, "workspace-work-back"); }
      assert.equal(modeOf(app), "conversation");
      app.releasePost();
      await app.waitForTurns(1);
      for (let attempt = 0; attempt < 100 && app.renderer.findAll(node => typeof node.props.onPublished === "function").length === 0 && !dismiss; attempt++) { await settle(20); app.renderer.flush(); }
      await settle(50); app.renderer.flush();
      if (dismiss) assert.equal(modeOf(app), "conversation", "a late poll result must not reopen Work the organizer dismissed");
      else assert.equal(modeOf(app), "work", "without a dismissal the saved poll opens in Work");
    } finally { await app.cleanup(); }
  } } finally { if (!hadDocument) delete (globalThis as { document?: unknown }).document; }
});

test("persistent: the Conversations selector switches conversations and each keeps its own unsent text", { skip }, async () => {
  const app = await mountWorkspace({ threadTitle: "Choose lodging", voice: false, embedded: true, layout: "persistent" });
  try {
    const routes = await loadCoordinatorRoutes();
    const second = CoordinatorThreadSchema.parse(await (await routes.threads.POST(jsonRequest(app.trip.eventId, "/threads", "POST", { id: randomUUID(), commandId: randomUUID(), title: "Pick restaurants" }), params(app.trip.eventId))).json());
    (app.renderer.find(node => node.type === "button" && textOf(node) === "Refresh conversation").props.onClick as () => void)(); await settle(30); app.renderer.flush();
    const choices = () => app.renderer.findAll(node => node.type === "button" && String(node.props.className ?? "").includes("workspace-selector-choice"));
    const headingText = () => { const node = app.renderer.findAll(node => node.type === "h1" && node.props.className === "workspace-context")[0]; return node ? textOf(node) : ""; };
    const choose = async (title: string) => { const choice = choices().find(node => textOf(node).includes(title)); assert.ok(choice, `${title} is listed`); (choice.props.onClick as () => void)(); for (let attempt = 0; attempt < 200 && (headingText() !== title || choices().some(node => node.props.disabled)); attempt++) { await settle(20); app.renderer.flush(); } };
    const heading = () => textOf(app.renderer.find(node => node.type === "h1" && node.props.className === "workspace-context"));
    // The refresh is a real route round trip; wait for it rather than a fixed delay (slower CI runners).
    for (let attempt = 0; attempt < 200 && !choices().some(node => textOf(node).includes("Pick restaurants")); attempt++) { await settle(20); app.renderer.flush(); }
    // Refresh can land on the newest conversation before the selection resolves; start from an explicit choice, as an organizer would.
    await choose("Choose lodging");
    assert.equal(heading(), "Choose lodging");
    assert.ok(choices().some(node => textOf(node).includes("Pick restaurants")), "the new conversation is in the selector");
    assert.equal(app.renderer.find(node => node.type === "button" && String(node.props.className ?? "").includes("workspace-selector-title")).props["aria-label"], "Choose lodging. Switch conversation", "the title is the conversation switcher");
    type(app, "Lodging note");
    await choose("Pick restaurants");
    assert.equal(heading(), "Pick restaurants");
    assert.equal(second.activeThreadId !== undefined, true);
    assert.equal(composerValue(app), "", "another conversation starts with its own box");
    type(app, "Restaurant note");
    await choose("Choose lodging");
    assert.equal(heading(), "Choose lodging");
    assert.equal(composerValue(app), "Lodging note", "returning restores that conversation's unsent text");
    assert.equal(app.records.filter(isTurnPost).length, 0, "switching never sends a draft");
  } finally { await app.cleanup(); }
});
