import test from "node:test";
import assert from "node:assert/strict";
import type { CommonsState, CoordinatorGoal, CoordinatorTask, TripTask } from "@commons/contracts";
import { coordinatorActionItems } from "./coordinator-action-items";
const state = { commonsId: "trip", proposals: [], pollRequests: [] } as unknown as CommonsState;
const input = { tripId: "trip", personId: "me", organizer: true, state };
const goal = (overrides: Partial<CoordinatorGoal> = {}) => ({ goalId: "goal", threadId: "thread", title: "Dinner", waitDetail: "Which night should we compare?", lifecycle: "waiting_for_input", ownedByMe: true, revision: 1, updatedAt: "2026-10-02T12:00:00Z", ...overrides } as CoordinatorGoal);
test("only my actionable tasks become prompts; the saved question and destination survive", () => {
  const items = coordinatorActionItems({ ...input, goals: [goal(), goal({goalId:"other",ownedByMe:false}), ...(["running","completed","cancelled","waiting_for_event","failed"] as const).map(lifecycle=>goal({goalId:lifecycle,lifecycle}))] });
  assert.equal(items.length, 1);
  assert.equal(items[0].detail, "Which night should we compare?");
  assert.deepEqual(items[0].target, {kind:"task",id:"thread"});
  assert.equal(items[0].descriptor?.scope.personId,"me");
  assert.deepEqual(coordinatorActionItems({...input,goals:[goal({lifecycle:"completed"})]}), []);
});
test("scope and role exclude organizer work, while unanswered polls remain personal actions", () => {
  const mixed = {...state, proposals:[{id:"proposal",title:"Review dinner",summary:"Friday",status:"proposed"}],pollRequests:[{id:"open",title:"Which day?",status:"open",responded:false},{id:"answered",status:"open",responded:true},{id:"closed",status:"closed",responded:false}]} as CommonsState;
  assert.deepEqual(coordinatorActionItems({...input,state:mixed,organizer:false,goals:[goal()]}).map(item=>item.id),["poll:open"]);
  assert.deepEqual(coordinatorActionItems({...input,tripId:"different",state:mixed,goals:[goal()]}),[]);
  assert.deepEqual(coordinatorActionItems({...input,state:mixed,goals:[goal({lifecycle:"waiting_for_approval"})]}).map(item=>item.action),["Review task","Review proposal","Answer poll"]);
});
test("legacy task questions work without the goal feature and disappear on completion", () => {
  const task = { taskId:"legacy", threadId:"old-thread", title:"Research", needsInput:"What is your budget?", status:"needs_input",ownedByMe:true } as CoordinatorTask;
  assert.equal(coordinatorActionItems({...input,legacyTasks:[task]})[0].detail,"What is your budget?");
  assert.deepEqual(coordinatorActionItems({...input,legacyTasks:[{...task,status:"succeeded"},{...task,ownedByMe:false}]}),[]);
});
test("saved and suggested to-dos use one channel-neutral list with personal ownership and completion",()=>{
  const todo={id:"todo",title:"Bring sunscreen",ownerPersonId:"me",completed:false,dueOn:null,itemKind:null,itemId:null,suggestedByCommons:false,suggestionKey:null} as TripTask;
  const items=coordinatorActionItems({...input,tripTasks:[todo,{...todo,id:"other",ownerPersonId:"someone"},{...todo,id:"done",completed:true}]});
  assert.deepEqual(items.map(item=>item.id),["todo:todo"]);
  assert.deepEqual(items[0].target,{kind:"todo",id:"todo"});
  assert.deepEqual(coordinatorActionItems({...input,tripTasks:[{...todo,completed:true}]}),[]);
  // The same serializable reminders can be rendered on web or by a messaging adapter.
  assert.deepEqual(JSON.parse(JSON.stringify(items)),items);
});
test("missing transport times become quiet to-dos without exposing private travel or duplicating saved reminders",()=>{
  const travelState={...state,travelPlans:[{id:"van",kind:"transport",date:"2027-05-14",route:"Airport van",visibility:"basic"},{id:"private",kind:"transport",date:"2027-05-14",route:"PRIVATE ROUTE",visibility:"private"},{id:"old",kind:"transport",date:"2025-01-01",route:"Past ride",visibility:"basic"},{id:"known",kind:"transport",date:"2027-05-14",time:"13:12",route:"Known ride",visibility:"basic"}]} as CommonsState;
  assert.deepEqual(coordinatorActionItems({...input,state:travelState,today:"2026-10-02"}).map(item=>item.id),["missing-time:van"]);
  const brainTodo={id:"brain",title:"Edited reminder",ownerPersonId:"me",completed:true,dueOn:null,itemKind:null,itemId:null,suggestedByCommons:true,suggestionKey:"missing-time:van"} as TripTask;
  assert.deepEqual(coordinatorActionItems({...input,state:travelState,today:"2026-10-02",tripTasks:[brainTodo]}),[]);
  assert.deepEqual(coordinatorActionItems({...input,state:travelState,today:"2026-10-02",tripTasks:[{...brainTodo,suggestionKey:null,itemKind:"travel",itemId:"van"}]}),[]);
  assert.deepEqual(coordinatorActionItems({...input,state:travelState,today:"2026-10-02",tripTasks:[{...brainTodo,suggestionKey:null,title:"Check pickup time: Airport van"}]}),[]);
  assert.deepEqual(coordinatorActionItems({...input,state:travelState,today:"2026-10-02",organizer:false}),[]);
});

test("saved itinerary polls supply one durable organizer review task; old revisions do not stay outstanding",()=>{
  const polls = [{id:"new",title:"Weekend",status:"open",responded:false,canManage:true,itinerary:true},{id:"old",title:"Previous",status:"closed",responded:true,canManage:true,itinerary:true,superseded:true}];
  const projected={...state,pollRequests:polls} as CommonsState;
  assert.deepEqual(coordinatorActionItems({...input,state:projected}).map(item=>item.target),[{kind:"poll_results",id:"new"}]);
  assert.deepEqual(coordinatorActionItems({...input,state:projected,organizer:false}).map(item=>item.target),[{kind:"poll",id:"new"}]);
});
