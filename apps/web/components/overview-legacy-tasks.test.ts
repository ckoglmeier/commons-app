import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
registerComponentImportStubs();
test("legacy Overview reads only given authorized threads, reports unavailable data, and stays off in goal mode", async () => {
  const requests:string[]=[];
  let fail=false;
  const live=installFakeLiveEnvironment({liveFetch:async url=>{requests.push(url);return fail?new Response("Denied",{status:403}):Response.json({tasks:[]});}});
  const {useOverviewLegacyTasks}=await import("./use-overview-legacy-tasks");
  function Harness({enabled,ids}:{enabled:boolean;ids:string[]}) {const state=useOverviewLegacyTasks("trip",ids,enabled);return createElement("p",null,JSON.stringify(state));}
  const renderer=createHookRenderer({expand:[Harness]});
  const render=async(enabled:boolean,ids:string[])=>{renderer.render(createElement(Harness,{enabled,ids}));await settle(5);renderer.flush();};
  try{
    await render(false,["one"]);assert.equal(requests.length,0);
    await render(true,["one","two"]);assert.deepEqual(requests.sort(),["/api/v1/commons/trip/coordinator/tasks?threadId=one","/api/v1/commons/trip/coordinator/tasks?threadId=two"]);
    assert.match(textOf(renderer.find(node=>node.type==="p")),/"unavailable":false/);
    fail=true;await render(true,["three"]);assert.match(textOf(renderer.find(node=>node.type==="p")),/"unavailable":true/);
    await render(false,["three"]);assert.match(textOf(renderer.find(node=>node.type==="p")),/"tasks":\[\]/);
  }finally{renderer.unmount();live.restore();}
});
