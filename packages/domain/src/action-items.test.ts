import test from "node:test";
import assert from "node:assert/strict";
import type { CommonsState, TripTask } from "@commons/contracts";
import { actionItems } from "./action-items";
const state = { commonsId: "trip", proposals: [], pollRequests: [] } as unknown as CommonsState;
const input = { tripId: "trip", personId: "me", organizer: true, state };
test("scope excludes other trips, while unanswered polls remain personal actions", () => {
  const mixed = {...state,pollRequests:[{id:"open",title:"Which day?",status:"open",responded:false},{id:"answered",status:"open",responded:true},{id:"closed",status:"closed",responded:false}]} as CommonsState;
  assert.deepEqual(actionItems({...input,state:mixed,organizer:false}).map(item=>item.id),["poll:open"]);
  assert.deepEqual(actionItems({...input,tripId:"different",state:mixed}),[]);
  assert.deepEqual(actionItems({...input,state:mixed}).map(item=>item.action),["Answer poll"]);
});
test("saved and suggested to-dos use one channel-neutral list with personal ownership and completion",()=>{
  const todo={id:"todo",title:"Bring sunscreen",ownerPersonId:"me",completed:false,dueOn:null,itemKind:null,itemId:null,suggestedByCommons:false,suggestionKey:null} as TripTask;
  const items=actionItems({...input,tripTasks:[todo,{...todo,id:"other",ownerPersonId:"someone"},{...todo,id:"done",completed:true}]});
  assert.deepEqual(items.map(item=>item.id),["todo:todo"]);
  assert.deepEqual(items[0].target,{kind:"todo",id:"todo"});
  assert.deepEqual(actionItems({...input,tripTasks:[{...todo,completed:true}]}),[]);
  // The same serializable reminders can be rendered on web or by a messaging adapter.
  assert.deepEqual(JSON.parse(JSON.stringify(items)),items);
});
test("missing transport times become quiet to-dos without exposing private travel or duplicating saved reminders",()=>{
  const travelState={...state,travelPlans:[{id:"van",kind:"transport",date:"2027-05-14",route:"Airport van",visibility:"basic"},{id:"private",kind:"transport",date:"2027-05-14",route:"PRIVATE ROUTE",visibility:"private"},{id:"old",kind:"transport",date:"2025-01-01",route:"Past ride",visibility:"basic"},{id:"known",kind:"transport",date:"2027-05-14",time:"13:12",route:"Known ride",visibility:"basic"}]} as CommonsState;
  assert.deepEqual(actionItems({...input,state:travelState,today:"2026-10-02"}).map(item=>item.id),["missing-time:van"]);
  const brainTodo={id:"brain",title:"Edited reminder",ownerPersonId:"me",completed:true,dueOn:null,itemKind:null,itemId:null,suggestedByCommons:true,suggestionKey:"missing-time:van"} as TripTask;
  assert.deepEqual(actionItems({...input,state:travelState,today:"2026-10-02",tripTasks:[brainTodo]}),[]);
  assert.deepEqual(actionItems({...input,state:travelState,today:"2026-10-02",tripTasks:[{...brainTodo,suggestionKey:null,itemKind:"travel",itemId:"van"}]}),[]);
  assert.deepEqual(actionItems({...input,state:travelState,today:"2026-10-02",tripTasks:[{...brainTodo,suggestionKey:null,title:"Check pickup time: Airport van"}]}),[]);
  assert.deepEqual(actionItems({...input,state:travelState,today:"2026-10-02",organizer:false}),[]);
});

test("saved itinerary polls supply one durable organizer review task; old revisions do not stay outstanding",()=>{
  const polls = [{id:"new",title:"Weekend",status:"open",responded:false,canManage:true,itinerary:true},{id:"old",title:"Previous",status:"closed",responded:true,canManage:true,itinerary:true,superseded:true}];
  const projected={...state,pollRequests:polls} as CommonsState;
  assert.deepEqual(actionItems({...input,state:projected}).map(item=>item.target),[{kind:"poll_results",id:"new"}]);
  assert.deepEqual(actionItems({...input,state:projected,organizer:false}).map(item=>item.target),[{kind:"poll",id:"new"}]);
});
