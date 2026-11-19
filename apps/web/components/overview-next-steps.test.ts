import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import type {CoordinatorGoal} from "@commons/contracts";
import {createHookRenderer,registerComponentImportStubs,textOf} from "../lib/test-support/hook-harness";
import {installFakeLiveEnvironment,settle} from "../lib/test-support/fake-live-transport";
import {pilotSnapshot} from "../lib/pilot-fixture";
registerComponentImportStubs();
test("Overview shows three real questions, expands the rest, opens the exact task, and removes completed work",async()=>{
  const live=installFakeLiveEnvironment();
  const {HomeDashboard}=await import("./home-dashboard");
  const renderer=createHookRenderer({expand:[HomeDashboard]});
  const opened:string[]=[];const noop=()=>{};
  const goals=Array.from({length:4},(_,i)=>({goalId:`goal-${i}`,threadId:`thread-${i}`,title:`Question ${i}`,waitDetail:`Saved question ${i}?`,lifecycle:"waiting_for_input",ownedByMe:true,revision:1,updatedAt:`2026-10-02T12:00:0${i}Z`} as CoordinatorGoal));
  const props={state:{...pilotSnapshot.state,proposals:[],pollRequests:[],stays:[],travelPlans:[]},commons:{...pilotSnapshot.commons,status:"archived" as const},participants:pilotSnapshot.participants,currentActorId:pilotSnapshot.currentActor.id,activityParticipation:{},canAskGroup:true,goals,openTask:(id:string)=>opened.push(id),addTravelPlans:noop,addPlan:noop,addReceipt:noop,openProposal:noop,goToPlan:noop,goToMoney:noop,openTripDetails:noop};
  try{
    renderer.render(createElement(HomeDashboard,props));await settle(5);renderer.flush();
    const prompts=()=>renderer.findAll(node=>node.type==="button"&&node.props.className==="home-next-step");
    assert.equal(prompts().length,3);assert.match(textOf(prompts()[0]),/Saved question 0\?/);
    (prompts()[0].props.onClick as ()=>void)();assert.deepEqual(opened,["thread-0"]);
    (renderer.find(node=>node.type==="button"&&/Show\s+1\s+more/.test(textOf(node))).props.onClick as ()=>void)();renderer.flush();assert.equal(prompts().length,4);
    renderer.render(createElement(HomeDashboard,{...props,goals:goals.map(goal=>({...goal,lifecycle:"completed" as const}))}));renderer.flush();assert.equal(prompts().length,0);
    renderer.render(createElement(HomeDashboard,{...props,tasksUnavailable:true}));renderer.flush();
    assert.equal(prompts().length,0);assert.match(renderer.tree.map(textOf).join(" "),/updates are unavailable/);assert.doesNotMatch(renderer.tree.map(textOf).join(" "),/No questions or approvals/);
    renderer.render(createElement(HomeDashboard,{...props,goals:[],state:{...props.state,pollRequests:[{id:"results-poll",title:"Review our itinerary",status:"open",canManage:true,itinerary:true}]} as unknown as typeof pilotSnapshot.state}));renderer.flush();
    const results=renderer.find(node=>typeof node.props.href === "string" && textOf(node).includes("Review results"));
    assert.equal(results.props.href,`/c/${props.commons.id}/polls/results-poll`);
  }finally{renderer.unmount();live.restore();}
});
