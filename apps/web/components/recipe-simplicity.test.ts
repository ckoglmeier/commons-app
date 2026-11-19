import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { CoordinatorGoalSchema, type RecipeRunDetail } from "@commons/contracts";
import { createHookRenderer,registerComponentImportStubs,textOf } from "@/lib/test-support/hook-harness";
import { installFakeLiveEnvironment,settle } from "@/lib/test-support/fake-live-transport";
registerComponentImportStubs();
const run=(stage:RecipeRunDetail["stage"])=>({id:crypto.randomUUID(),recipe:"food_preferences",title:"Meal preferences",workflow:{key:"food",version:1},stage,draft:{id:crypto.randomUUID(),version:1,published:stage!=="draft",archived:false},poll:stage==="draft"?null:{id:crypto.randomUUID(),publicId:"abc123abc123",status:stage==="decide"?"closed":"open",responseCount:0,superseded:false,audienceKind:"invitees",ballotMode:"transparent"},notes:[],evidenceFingerprint:null,outcome:null,history:[],trip:{startsOn:null,endsOn:null,locationNames:[]},askedTrip:null,headcount:null,summary:null}) as RecipeRunDetail;

test("embedded guided drafts delegate to the shared stages without the old progress rail",async()=>{
  const {RecipeRun}=await import("./recipe-run"),{RecipeNextStep}=await import("./recipe-next-step"),{GuidedGoalStages}=await import("./guided-goal-stages");
  const renderer=createHookRenderer({expand:[RecipeRun]});
  try{
    renderer.render(createElement(RecipeRun,{slug:"qa",initial:{...run("draft"),recipe:"attendance"} as RecipeRunDetail,embedded:true}));
    assert.equal(renderer.findAll(n=>n.type===RecipeNextStep).length,0);
    assert.equal(renderer.findAll(n=>n.props["aria-label"]==="Progress").length,0);
    assert.equal(renderer.findAll(n=>n.type===GuidedGoalStages).length,1);
  }finally{renderer.unmount();}
});

test("empty closed rounds say no answers and separate follow-ups are secondary",async()=>{
  const {RecipeNextStep}=await import("./recipe-next-step"),renderer=createHookRenderer({expand:[RecipeNextStep]});
  try{
    renderer.render(createElement(RecipeNextStep,{slug:"qa",run:run("decide")}));
    assert.match(renderer.tree.map(textOf).join(" "),/Voting closed · no answers/);
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "),/Answers are ready/);
    assert.equal(renderer.find(n=>n.type==="details").props.open,undefined);
  }finally{renderer.unmount();}
});

test("poll copying has a persistent acknowledgment, truthful fallback and no implicit close",async()=>{
  const {SavedPollShare,PollShareLink,CloseVotingControl}=await import("./recipe-shared"),live=installFakeLiveEnvironment({liveFetch:async()=>Response.json({})});
  const current=run("collecting"),requests:Array<unknown>=[];
  Object.assign(window.location,{origin:"http://localhost"});Object.assign(navigator,{clipboard:{writeText:async()=>{throw new Error("Denied");}}});
  const renderer=createHookRenderer({expand:[SavedPollShare,PollShareLink,CloseVotingControl]});
  try{
    renderer.render(createElement("div",{},createElement(SavedPollShare,{slug:"qa",run:current}),createElement(CloseVotingControl,{run:current,busy:false,base:"/api/qa",runBase:"/api/qa/run",act:async work=>{await work();},call:async(path,method,body)=>{requests.push({path,method,body});return {ok:true,data:{} as never};}})));
    assert.equal(renderer.findAll(n=>n.type==="input").length,0);
    assert.equal(textOf(renderer.find(n=>n.props.role==="status")),"");
    await (renderer.find(n=>n.type==="button"&&textOf(n)==="Copy poll link").props.onClick as ()=>Promise<void>)();await settle(2);renderer.flush();
    assert.match(renderer.tree.map(textOf).join(" "),/Couldn’t copy automatically/);
    assert.match(String(renderer.find(n=>n.type==="input").props.value),/abc123abc123/);
    assert.equal(requests.length,0);
    Object.assign(navigator,{clipboard:{writeText:async()=>{}}});
    await (renderer.find(n=>n.type==="button"&&textOf(n)==="Copy poll link").props.onClick as ()=>Promise<void>)();await settle(2);renderer.flush();
    assert.equal(textOf(renderer.find(n=>n.props.role==="status")),"Copied");assert.equal(renderer.findAll(n=>n.type==="input").length,0);
    (renderer.find(n=>n.type==="button"&&textOf(n)==="Close voting").props.onClick as ()=>void)();renderer.flush();
    assert.equal(requests.length,0,"opening close confirmation does not close the round");
  }finally{renderer.unmount();live.restore();}
});

test("saved poll work refreshes the Goal immediately, with a visible retry instruction if status cannot load",async()=>{
  const {PlanningGoal}=await import("./planning-goal"),{RecipeRun}=await import("./recipe-run");
  const initial={...run("draft"),recipe:"attendance"} as RecipeRunDetail,now=new Date().toISOString();
  const goal=CoordinatorGoalSchema.parse({goalId:crypto.randomUUID(),threadId:crypto.randomUUID(),mainThreadId:crypto.randomUUID(),kind:"planning",title:"Meal preferences",goal:"Make meals work",completionCriterion:"Review the answers",revision:1,lifecycle:"waiting_for_approval",waitDetail:"Continue the saved draft",planning:{runId:initial.id,stage:"draft",label:"Drafting",nextAction:"Continue the saved draft",action:"continue_draft"},steps:[],research:null,outcome:null,outcomeRevision:null,errorCode:null,executionBlocked:null,ideaIds:[],ownedByMe:true,requestedByName:"Casey",legacy:false,createdAt:now,updatedAt:now,completedAt:null});
  let failed=false,requests=0;
  const live=installFakeLiveEnvironment({liveFetch:async()=>{requests++;return failed ? Response.json({error:"Unavailable"},{status:503}) : Response.json({goals:[{...goal,planning:{...goal.planning,stage:"collecting",label:"Waiting on 5 people",action:"wait"}}],reports:[]});}});
  const renderer=createHookRenderer({expand:[PlanningGoal]});
  try{
    renderer.render(createElement(PlanningGoal,{slug:"qa",actorId:crypto.randomUUID(),initialGoal:goal,initialRun:initial}));
    (renderer.find(n=>n.type===RecipeRun).props.onRefresh as (r:RecipeRunDetail)=>void)({...run("collecting"),recipe:"attendance"} as RecipeRunDetail);await settle(3);renderer.flush();
    assert.equal(requests,1);assert.equal(((renderer.find(n=>n.type===RecipeRun).props.goalBuild as {props:{goal:typeof goal}}).props.goal).planning?.label,"Waiting on 5 people");
    failed=true;(renderer.find(n=>n.type===RecipeRun).props.onRefresh as (r:RecipeRunDetail)=>void)({...run("decide"),recipe:"attendance"} as RecipeRunDetail);await settle(3);renderer.flush();
    assert.match(textOf(renderer.find(n=>n.props.role==="alert")),/Poll saved.*reload/);
  }finally{renderer.unmount();live.restore();}
});
