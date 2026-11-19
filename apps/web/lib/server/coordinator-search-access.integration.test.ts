import test from "node:test";
import assert from "node:assert/strict";
import {withCoordinatorScenario,databaseTestsEnabled} from "./coordinator-route-harness";
// Goals are on by default; these cases cover the Coordinator paths without them.
process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "false";
test("non-allowlisted pilot cannot invoke search, while poll/task retain authorization",{skip:!databaseTestsEnabled},()=>withCoordinatorScenario(async s=>{
 for(const text of ["/search Hotel in Texas under $200","Find me a hotel in Texas"]){const r=await s.post(s.command({text}));assert.equal(r.body.status,"completed",JSON.stringify(r.body));assert.match(r.body.durableAnswer,/Web search.*account/);assert.equal(s.network.tavilyCalls.length,0);assert.equal(s.network.providerCalls.length,0);}
 const task=await s.post(s.command({text:"/task Pack a charger"}));assert.equal(task.body.status,"completed");assert.equal(task.body.reviewRequired,false);assert.match(task.body.durableAnswer,/Added your task/);
 s.next.extra={operations:[{kind:"add_question",prompt:"Which dinner?",selectionMode:"single",options:[{label:"Garden",description:null},{label:"Bistro",description:null}]}]};const poll=await s.post(s.command({text:"/poll Which dinner: Garden or Bistro?"}));assert.equal(poll.body.status,"completed");assert.equal(poll.body.capability,"prepare_poll");assert.equal(s.network.tavilyCalls.length,0);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_TEST_SEARCH_EMAIL:""}}));


test("allowlisted synthetic session can search; another verified email cannot",{skip:!databaseTestsEnabled},()=>withCoordinatorScenario(async s=>{
 const {COORDINATOR_SEARCH_OWNER_EMAIL}=await import("./coordinator-search-access");
 process.env.COMMONS_TEST_SEARCH_EMAIL=COORDINATOR_SEARCH_OWNER_EMAIL.toUpperCase();
 let r=await s.post(s.command({text:"/search Hotel in Texas under $200"}));assert.equal(r.body.status,"completed");assert.equal(r.body.capability,"research");assert.equal(s.network.tavilyCalls.filter(c=>c.path==="search").length,1);
 const calls=s.network.tavilyCalls.length;process.env.COMMONS_TEST_SEARCH_EMAIL="other@example.com";r=await s.post(s.command({text:"/search Hotel in Texas"}));assert.match(r.body.durableAnswer,/Web search.*account/);assert.equal(s.network.tavilyCalls.length,calls);
},{environment:{COMMONS_TEST_SEARCH_EMAIL:""}}));
