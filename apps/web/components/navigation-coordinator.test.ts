import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { CoordinatorThreadSchema, type PersonalCoordinatorTurn } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
import { readUnsent, transferUnsent, writeUnsent } from "../lib/coordinator-unsent";
import { pilotSnapshot } from "../lib/pilot-fixture";
registerComponentImportStubs();

test("four primary destinations select Coordinator independently and retain canonical links", async () => {
  const {EventNavigationLinks}=await import("./event-navigation");
  const {commonsViewPath}=await import("../lib/commons-route");
  const slug=randomUUID(), navigated:string[]=[];
  const renderer=createHookRenderer({expand:[EventNavigationLinks]});
  try {
    for (const canUseWorkspace of [false,true]) for (const view of ["home","coordinator","workspace","logistics","money"] as const) {
      renderer.render(createElement(EventNavigationLinks,{eventId:slug,view,canUseWorkspace,navigate:value=>navigated.push(value)}));
      const links=renderer.findAll(node=>typeof node.props.href === "string");
      assert.deepEqual(links.map(textOf),["Trip","Coordinator","Plan","Money"]);
      assert.deepEqual(links.map(node=>node.props.href),["home","coordinator","plan","money"].map(value=>commonsViewPath(slug,value as "home"|"coordinator"|"plan"|"money")));
      assert.deepEqual(links.filter(node=>node.props["aria-current"] === "page").map(textOf),[view === "workspace" ? "Coordinator" : view === "logistics" ? "Plan" : view === "home" ? "Trip" : view === "coordinator" ? "Coordinator" : "Money"]);
      const coordinator=links[1]; let prevented=false;
      const click=coordinator.props.onClick as (event:unknown)=>void;
      click({button:0,metaKey:true,preventDefault(){prevented=true;}});
      assert.equal(prevented,false,"Modified clicks retain normal link behavior");
      click({button:0,preventDefault(){prevented=true;}});
      assert.equal(prevented,true);assert.equal(navigated.at(-1),"coordinator");
    }
    renderer.render(createElement(EventNavigationLinks,{eventId:slug,view:"coordinator",busy:true,navigate:value=>navigated.push(value)}));
    const before=navigated.length;
    (renderer.find(node=>textOf(node)==="Trip").props.onClick as (event:unknown)=>void)({button:0,preventDefault(){}});
    assert.equal(navigated.length,before,"A standalone workspace's busy guard remains enforced");
  } finally {renderer.unmount();}
});

test("Overview revalidates its travel shortcut and opens no editor for completed or unavailable work", async () => {
  const original=structuredClone(pilotSnapshot);
  original.state.travelPlans=[];
  const fresh=structuredClone(original);
  fresh.commons.status="archived";
  const requests:string[]=[],opened:unknown[]=[];
  let unavailable=false;
  const live=installFakeLiveEnvironment({liveFetch:async url=>{
    requests.push(url);
    if (url.endsWith("/tasks")) return Response.json({tasks:[]});
    return unavailable ? new Response("unavailable",{status:503}) : new Response(JSON.stringify({snapshot:fresh}),{headers:{"Content-Type":"application/json"}});
  }});
  const {HomeDashboard}=await import("./home-dashboard");
  const renderer=createHookRenderer({expand:[HomeDashboard]});
  const noop=()=>{};
  try {
    renderer.render(createElement(HomeDashboard,{state:original.state,commons:original.commons,participants:original.participants,currentActorId:original.currentActor.id,activityParticipation:{},travelUploadAvailable:true,addTravelPlans:step=>opened.push(step),addPlan:noop,addReceipt:noop,openProposal:noop,goToPlan:noop,goToMoney:noop,openTripDetails:noop}));
    await settle(5); renderer.flush();
    const click=()=> (renderer.find(node=>node.props["data-next-step"] === "arrival_missing").props.onClick as ()=>void)();
    click(); await settle(5); renderer.flush();
    assert.deepEqual(requests,[`/api/v1/commons/${original.commons.slug}/tasks`,`/api/v1/commons/${original.commons.slug}/state`]);
    assert.deepEqual(opened,[undefined],"Obsolete recommendation only opens the authorized Travel view");
    unavailable=true; click(); await settle(5); renderer.flush();
    assert.equal(opened.length,1,"Unknown data must not open a missing-arrival editor");
    assert.match(textOf(renderer.find(node=>node.props.role === "alert")),/Couldn’t reload/);
  } finally {renderer.unmount();live.restore();}
});

test("embedded Overview handoff restores cached main exactly, keeps task draft and calls no API", async () => {
  const requests: string[] = [];
  const live = installFakeLiveEnvironment({liveFetch:async url=>{requests.push(url);throw new Error("No request allowed during handoff");}});
  const {CoordinatorWorkspace}=await import("./coordinator-workspace");
  const slug=randomUUID(), actorId=randomUUID(), mainId=randomUUID(), taskId=randomUUID(),at="2026-10-01T12:00:00.000Z";
  const threads=[{id:mainId,title:"Coordinator"},{id:taskId,title:"Dinner task"}].map(row=>({...row,status:"active",version:1,createdByPersonId:actorId,createdByName:"Synthetic organizer",turnCount:0,draftCount:0,pollCount:0,archivedAt:null,createdAt:at,updatedAt:at}));
  const record=(id:string)=>CoordinatorThreadSchema.parse({version:0,activeThreadId:id,threads,turns:[],drafts:[],polls:[],hasEarlier:false});
  const {AppRouterContext}=await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const renderer=createHookRenderer({expand:[CoordinatorWorkspace],context:context=>context === AppRouterContext ? {push(){},replace(){},refresh(){}} : undefined});
  let props:Parameters<typeof CoordinatorWorkspace>[0]={slug,actorId,eventName:"Synthetic",initialThread:record(taskId),mainThread:record(mainId),initialRecommendations:[],conversationAvailable:true,embedded:true,showOverview:false,overview:createElement("div",null,"Overview facts"),continuity:{mainThreadId:mainId,capability:{steering:false,available:false,reason:"off"},relations:[]}};
  const render=()=>{renderer.render(createElement(CoordinatorWorkspace,props));renderer.flush();};
  const composer=()=>renderer.find(node=>node.props.id==="workspace-prompt");
  try {
    render();await settle(5);renderer.flush();
    (composer().props.onChange as (event:unknown)=>void)({target:{value:"Task-only unsent note"}});renderer.flush();
    props={...props,showOverview:true,active:false};render();
    assert.equal(renderer.find(node=>node.type === "main").props.hidden,true);
    assert.equal(renderer.find(node=>node.props.className === "trip-overview").props.hidden,false);
    assert.equal(renderer.findAll(node=>node.type === "button" && textOf(node) === "Overview").length,0,"Overview has no Coordinator navigation entry");
    const containsOverview=(node:import("../lib/test-support/hook-harness").RenderedNode):boolean=>typeof node!=="string"&&(node.props.className === "trip-overview" || node.children.some(containsOverview));
    assert.equal(containsOverview(renderer.find(node=>node.type === "main")),false,"Overview renders outside the Coordinator workspace");
    const text="  Exact → question.\nKeep punctuation & whitespace.  ";writeUnsent(slug,actorId,"overview",text);
    assert.equal(transferUnsent(slug,actorId,"overview",`thread:${mainId}`,text),"transferred");
    props={...props,showOverview:false,active:true,navigation:{selected:`thread:${mainId}`,revision:1}};render();await settle(5);renderer.flush();
    assert.equal(composer().props.value,text);assert.match(textOf(renderer.find(node=>node.props.id==="workspace-destination")),/Coordinator/);
    assert.equal(readUnsent(slug,actorId,`thread:${taskId}`),"Task-only unsent note");assert.equal(readUnsent(slug,actorId,"overview"),"");
    assert.deepEqual(requests,[],"Continue must not fetch or send");
    props={...props,navigation:{selected:`thread:${taskId}`,revision:2}};render();await settle(5);renderer.flush();assert.equal(composer().props.value,"Task-only unsent note");
  } finally {renderer.unmount();live.restore();}
});

test("mounted actor changes keep itinerary pastes in each organizer's composer", async () => {
  const live=installFakeLiveEnvironment({liveFetch:async()=>{throw new Error("No API call expected");}});
  const {CoordinatorWorkspace}=await import("./coordinator-workspace");
  const {AppRouterContext}=await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const renderer=createHookRenderer({expand:[CoordinatorWorkspace],context:c=>c===AppRouterContext?{push(){},replace(){},refresh(){}}:undefined});
  const slug=randomUUID(),first=randomUUID(),second=randomUUID(),threadId=randomUUID();
  const at="2026-10-01T12:00:00.000Z";
  const initialThread=CoordinatorThreadSchema.parse({version:0,activeThreadId:threadId,turns:[],drafts:[],polls:[],threads:[{id:threadId,title:"Coordinator",status:"active",version:1,createdByPersonId:first,createdByName:"Synthetic organizer",turnCount:0,draftCount:0,pollCount:0,archivedAt:null,createdAt:at,updatedAt:at}],hasEarlier:false});
  const props={slug,eventName:"Synthetic",initialThread,initialRecommendations:[],conversationAvailable:true};
  const composer=()=>renderer.find(node=>node.props.id==="workspace-prompt");
  const render=(actorId:string)=>{renderer.render(createElement(CoordinatorWorkspace,{...props,actorId}));renderer.flush();};
  const paste="Thursday\n9:00 AM — Arrive at SFO\n1:00 PM — Group lunch";
  writeUnsent(slug,second,`thread:${threadId}`,"Second organizer's own note");
  try {
    render(first);await settle(5);renderer.flush();
    (composer().props.onChange as (event:unknown)=>void)({target:{value:paste}});renderer.flush();
    render(second);assert.equal(composer().props.value,"","Hide the prior actor's paste immediately, before hydration");
    await settle(5);renderer.flush();assert.equal(composer().props.value,"Second organizer's own note");
    render(first);assert.equal(composer().props.value,paste);
    assert.equal(readUnsent(slug,first,`thread:${threadId}`),paste);
    assert.equal(readUnsent(slug,second,`thread:${threadId}`),"Second organizer's own note");
  } finally {renderer.unmount();live.restore();}
});

test("Overview prompts only incomplete human tasks assigned to the viewer", async () => {
  const actor = pilotSnapshot.currentActor.id;
  const base = {id:randomUUID(),title:"Arrange airport van",ownerPersonId:actor,dueOn:null,completed:false,version:1,itemKind:"travel",itemId:randomUUID(),itemTitle:"Shared van"};
  const live = installFakeLiveEnvironment({liveFetch:async url => url.endsWith("/tasks") ? Response.json({tasks:[base,{...base,id:randomUUID(),title:"Someone else's work",ownerPersonId:randomUUID()},{...base,id:randomUUID(),title:"Completed work",completed:true}]}) : Response.json({snapshot:pilotSnapshot})});
  const {HomeDashboard} = await import("./home-dashboard");
  const renderer = createHookRenderer({expand:[HomeDashboard]});
  const noop=()=>{};
  try {
    renderer.render(createElement(HomeDashboard,{state:pilotSnapshot.state,commons:pilotSnapshot.commons,participants:pilotSnapshot.participants,currentActorId:actor,activityParticipation:{},travelUploadAvailable:true,addTravelPlans:noop,addPlan:noop,addReceipt:noop,openProposal:noop,goToPlan:noop,goToMoney:noop,openTripDetails:noop}));
    await settle(5);renderer.flush();
    const next = renderer.find(node=>node.props["aria-labelledby"]==="home-next-steps-title");
    assert.match(textOf(next),/Arrange airport van.*Assigned to you/);
    assert.doesNotMatch(textOf(next),/Someone else's work|Completed work/);
  } finally {renderer.unmount();live.restore();}
});

test("personal chat stages without requests, sends only own command and preserves newer unsent text", async()=>{
  const calls:Array<{url:string;body:unknown}>=[];let finish:(response:Response)=>void=()=>{};
  const response=new Promise<Response>(resolve=>{finish=resolve;});
  const live=installFakeLiveEnvironment({liveFetch:async(url,init)=>{calls.push({url,body:JSON.parse(String(init?.body))});return response;}});
  const {PersonalCoordinator}=await import("./personal-coordinator");
  const {WorkspacePaneLayout}=await import("./workspace-pane-layout");
  const slug=randomUUID(),actorId=randomUUID(),text="My own trip question";writeUnsent(slug,actorId,"personal",text);
  const renderer=createHookRenderer({expand:[PersonalCoordinator,WorkspacePaneLayout]});const input=()=>renderer.find(node=>node.type==="textarea");
  try {
    renderer.render(createElement(PersonalCoordinator,{slug,actorId,initialTurns:[],available:true,active:true}));await settle(5);renderer.flush();assert.equal(input().props.value,text);assert.equal(calls.length,0);
    (renderer.find(node=>node.type==="form").props.onSubmit as (event:unknown)=>void)({preventDefault(){}});renderer.flush();
    assert.equal(calls.length,1);assert.equal(calls[0].url,`/api/v1/commons/${slug}/coordinator/personal`);
    const command=calls[0].body as {commandId:string;text:string};assert.deepEqual(Object.keys(command).sort(),["commandId","text"]);assert.equal(command.text,text);
    (input().props.onChange as (event:unknown)=>void)({target:{value:"Newer unsent question"}});renderer.flush();
    const turn:PersonalCoordinatorTurn={id:randomUUID(),commandId:command.commandId,userText:text,reply:"Saved facts only.",status:"completed",createdAt:new Date().toISOString()};
    finish(new Response(JSON.stringify({turn}),{headers:{"Content-Type":"application/json"}}));await settle(5);renderer.flush();
    assert.equal(input().props.value,"Newer unsent question");assert.equal(readUnsent(slug,actorId,"personal"),"Newer unsent question");assert.match(renderer.tree.map(textOf).join("\n"),/Saved facts only/);
  } finally {renderer.unmount();live.restore();}
});

for (const startup of ["established", "microphone", "session"] as const) test(`mounted navigation releases voice during ${startup}`, async () => {
  const live = installFakeLiveEnvironment({holdMicrophone:startup === "microphone",holdLive:startup === "session"});
  const {CoordinatorWorkspace}=await import("./coordinator-workspace");
  const {CoordinatorLiveConversation}=await import("./coordinator-live-conversation");
  const {AppRouterContext}=await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const renderer=createHookRenderer({expand:[CoordinatorWorkspace,CoordinatorLiveConversation],context:c=>c===AppRouterContext?{push(){},replace(){},refresh(){}}:undefined});
  let active=true;
  const voiceSlug=randomUUID();
  const render=()=>{renderer.render(createElement(CoordinatorWorkspace,{slug:voiceSlug,eventName:"Synthetic",initialThread:CoordinatorThreadSchema.parse({version:0,turns:[],drafts:[],polls:[],threads:[],hasEarlier:false}),initialRecommendations:[],conversationAvailable:true,voiceAvailable:true,embedded:true,active,showOverview:!active}));renderer.flush();};
  const back=()=>{active=false;render();};
  window.addEventListener("popstate",back);
  try {
    render();await settle(5);renderer.flush();
    (renderer.find(n=>n.props["aria-label"]==="Talk with Commons").props.onClick as ()=>void)();await settle(15);renderer.flush();
    if(startup === "established") {live.channel?.emit({type:"session.started"});await settle(2);renderer.flush();}
    window.dispatchEvent(new Event("popstate"));await settle(5);renderer.flush();
    live.releaseMicrophone();live.releaseLive();await settle(15);renderer.flush();
    assert.equal(live.streams.length,1,"The delayed or established microphone was actually acquired");
    if (startup !== "microphone") assert.equal(live.peers.length,1);
    assert.ok(live.streams.every(stream=>stream.tracks.every(track=>track.stopped)));
    assert.ok(live.peers.every(peer=>peer.closed));
    assert.equal(startup === "microphone" ? live.liveRequests.length : 0,0);
  } finally {window.removeEventListener("popstate",back);renderer.unmount();live.restore();}
});

test("saved poll edits survive Overview, task and history restoration; mobile activation preserves URLs",async()=>{
  const live=installFakeLiveEnvironment({liveFetch:async()=>{throw new Error("Navigation must not send");}});
  const {CoordinatorWorkspace}=await import("./coordinator-workspace");
  const {CoordinatorReview}=await import("./coordinator-review");
  const {AppRouterContext}=await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const slug=randomUUID(),actorId=randomUUID(),mainId=randomUUID(),taskId=randomUUID(),draftId=randomUUID(),at=new Date().toISOString();
  const threads=[mainId,taskId].map(id=>({id,title:id===mainId?"Coordinator":"Task",status:"active",version:1,createdByPersonId:actorId,createdByName:"Synthetic",turnCount:0,draftCount:1,pollCount:0,archivedAt:null,createdAt:at,updatedAt:at}));
  const record=CoordinatorThreadSchema.parse({version:0,activeThreadId:mainId,threads,turns:[],drafts:[{id:draftId,threadId:mainId,version:1,data:{title:"Original title",intro:"Intro",ballotMode:"transparent",questions:[],communication:{heading:"Question",paragraphs:["Nothing booked"],links:[]}},createdAt:at,updatedAt:at,publishedPollId:null}],polls:[],hasEarlier:false});
  const renderer=createHookRenderer({expand:[CoordinatorWorkspace],context:c=>c===AppRouterContext?{push(){},replace(){},refresh(){}}:undefined});
  const paths:string[]=[];
  window.history.pushState=(_data,_unused,url)=>{const parsed=new URL(String(url),"http://localhost");window.location.pathname=parsed.pathname;window.location.search=parsed.search;paths.push(String(url));};
  let props:Parameters<typeof CoordinatorWorkspace>[0]={slug,actorId,eventName:"Synthetic",initialThread:record,mainThread:{...record,activeThreadId:taskId,drafts:[]},initialRecommendations:[],conversationAvailable:true,embedded:true,active:true,continuity:{mainThreadId:mainId,capability:{steering:false,available:false,reason:"off"},relations:[]}};
  const render=()=>{renderer.render(createElement(CoordinatorWorkspace,props));renderer.flush();};
  const navigate=async(selected:string,revision:number)=>{props={...props,showOverview:selected==="overview",navigation:{selected,revision}};render();await settle(5);renderer.flush();};
  const review=()=>renderer.find(n=>n.type===CoordinatorReview);
  const activate=(label:string)=>(renderer.find(n=>n.type==="button"&&textOf(n)===label).props.onClick as ()=>void)();
  try {
    render();await settle(5);renderer.flush();
    (review().props.onSaved as (draft:unknown)=>void)({...record.drafts[0],version:2,data:{...record.drafts[0].data,title:"Saved new title"}});renderer.flush();
    await navigate("overview",1);activate("Conversation");renderer.flush();
    assert.equal(new URL(paths.at(-1)!,"http://localhost").searchParams.get("thread"),mainId);
    await navigate(`thread:${mainId}`,2);
    assert.equal((review().props.initialDraft as typeof record.drafts[0]).version,2);
    await navigate(`thread:${taskId}`,3);await navigate("overview",4);
    window.location.search="?view=home";activate("Work");renderer.flush();
    const copied=new URL(paths.at(-1)!,"http://localhost");assert.equal(copied.searchParams.get("view"),"coordinator");assert.equal(copied.searchParams.get("thread"),taskId);
    window.location.search=`?view=coordinator&thread=${mainId}`;window.dispatchEvent(new Event("popstate"));renderer.flush();
    assert.equal((review().props.initialDraft as typeof record.drafts[0]).data.title,"Saved new title");
    window.location.search=copied.search;window.dispatchEvent(new Event("popstate"));renderer.flush();
    assert.match(textOf(renderer.find(n=>n.props.id==="workspace-destination")),/Task/);
  } finally {renderer.unmount();live.restore();}
});

for (const goalsEnabled of [false,true]) test(`tasks stay in the left navigation and earlier chats stay collapsed (goals ${goalsEnabled})`,async()=>{
  const requests:Array<{url:string;method:string}>=[];
  const live=installFakeLiveEnvironment({liveFetch:async(url,init)=>{requests.push({url,method:init?.method??"GET"});return new Response(JSON.stringify(url.endsWith("/goals")?{goals:[],reports:[],suggestions:[]}:record),{headers:{"Content-Type":"application/json"}});}});
  const {CoordinatorWorkspace}=await import("./coordinator-workspace");
  const {CoordinatorTaskPanel}=await import("./coordinator-continuity");
  const {GoalTaskRail}=await import("./coordinator-goals");
  const {AppRouterContext}=await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const mainId=randomUUID(),topicId=randomUUID(),actorId=randomUUID(),at=new Date().toISOString();
  const threads=[mainId,topicId].map(id=>({id,title:id===mainId?"Coordinator":"Balloon Fiesta",status:"active",version:1,createdByPersonId:actorId,createdByName:"Synthetic",turnCount:0,draftCount:0,pollCount:0,archivedAt:null,createdAt:at,updatedAt:at}));
  const record=CoordinatorThreadSchema.parse({version:0,activeThreadId:mainId,threads,turns:[],drafts:[],polls:[],hasEarlier:false});
  const renderer=createHookRenderer({expand:[CoordinatorWorkspace],context:c=>c===AppRouterContext?{push(){},replace(){},refresh(){}}:undefined});
  try{
    renderer.render(createElement(CoordinatorWorkspace,{slug:randomUUID(),actorId,eventName:"Synthetic",initialThread:record,mainThread:record,initialRecommendations:[],conversationAvailable:true,embedded:true,goalsEnabled,tripIdeas:[{id:randomUUID(),title:"A saved idea",status:"idea",provenanceLabel:"Saved by organizer"}],continuity:{mainThreadId:mainId,capability:{steering:false,available:false,reason:"off"},relations:[]}}));
    await settle(5);renderer.flush();

    const chat=renderer.find(node=>node.props["aria-label"]==="Your coordinator");
    const contains=(node:import("../lib/test-support/hook-harness").RenderedNode,type:unknown):boolean=>typeof node!=="string"&&(node.type===type||node.children.some(child=>contains(child,type)));
    assert.equal(contains(renderer.find(node=>node.props["aria-label"]==="Trip navigation"),goalsEnabled?GoalTaskRail:CoordinatorTaskPanel),true);
    assert.equal(contains(chat,CoordinatorTaskPanel)||contains(chat,GoalTaskRail),false);
    const earlier=renderer.find(node=>node.type==="details"&&textOf(node).includes("Earlier conversations"));
    assert.ok(!earlier.props.open);assert.match(textOf(earlier),/Balloon Fiesta/);
    assert.equal(renderer.find(node=>node.props["aria-label"]==="Start something new").props.hidden,true);
    if(!goalsEnabled){
      (renderer.find(node=>node.type==="button"&&textOf(node).includes("Discuss with Coordinator")).props.onClick as ()=>void)();
      await settle(8);renderer.flush();
      assert.ok(requests.some(request=>request.method==="PATCH"),"Idea is linked to the existing conversation");
      assert.equal(requests.some(request=>request.method==="POST"),false,"Discussing an idea creates no additional chat");
      assert.match(textOf(renderer.find(node=>node.props.id==="workspace-destination")),/Coordinator/);
    }
  }finally{renderer.unmount();live.restore();}
});

test("traveler Coordinator is conversation first with a slim header, embedded send and no permanent tasks or link chips", async()=>{
  const {renderToStaticMarkup}=await import("react-dom/server");
  const {PersonalCoordinator}=await import("./personal-coordinator");
  const html=renderToStaticMarkup(createElement(PersonalCoordinator,{slug:"trip",actorId:randomUUID(),initialTurns:[],available:true,active:true}));
  assert.match(html,/Just you · Commons answers from saved trip details\. Nothing changes from chat\./);
  assert.match(html,/placeholder="Ask Commons about this trip…"/);assert.match(html,/aria-label="Message Commons"/);assert.match(html,/aria-label="Send"/);
  assert.doesNotMatch(html,/Authorized trip views|Message Commons<\/label>|>Tasks</,"no link chips, visible label, or Tasks action without a task context");
  const unavailable=renderToStaticMarkup(createElement(PersonalCoordinator,{slug:"trip",actorId:randomUUID(),initialTurns:[],available:false,active:true}));
  assert.match(unavailable,/Conversation is unavailable here/);assert.match(unavailable,/<button[^>]*aria-label="Send"[^>]*disabled/);
});
