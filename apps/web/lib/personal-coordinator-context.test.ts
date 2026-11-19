import test from "node:test";
import assert from "node:assert/strict";
import type { TripTask } from "@commons/contracts";
import { personalCoordinatorContext } from "./personal-coordinator-context";
import { pilotSnapshot } from "./pilot-fixture";
import { converseWithCoordinator } from "./server/coordinator-review-inference";

test("personal context allowlist excludes organizer chats, tasks, other private travel and original files",()=>{
  const snapshot=structuredClone(pilotSnapshot),me=snapshot.currentActor.id;
  snapshot.state.messages=[{id:"hidden",body:"ORGANIZER_CHAT_SECRET"}] as never;
  snapshot.state.auditEvents=[{summary:"PRIVATE_AUDIT_SECRET"}] as never;
  snapshot.state.travelPlans=[{id:"mine",personId:me,kind:"arrival",route:"Own airport",date:"2027-07-18",time:"15:00",note:"PRIVATE_DOCUMENT_NOTE",confirmationCode:"PRIVATE_CODE",confirmationDocumentUrl:"PRIVATE_FILE"},{id:"other",personId:"other-person",kind:"arrival",route:"OTHER_PRIVATE_BOOKING",date:"2027-07-18"}] as never;
  const ownTask={id:"own-todo",title:"Pack charger",ownerPersonId:me,completed:false,dueOn:null} as TripTask;
  const context=personalCoordinatorContext(snapshot,Date.now(),{tasks:[ownTask,{...ownTask,id:"other",title:"OTHER_TASK_SECRET",ownerPersonId:"other"}]}),encoded=JSON.stringify(context);
  assert.match(encoded,/Own airport/);assert.match(encoded,/Pack charger/);
  assert.doesNotMatch(encoded,/ORGANIZER_CHAT_SECRET|PRIVATE_AUDIT_SECRET|PRIVATE_DOCUMENT_NOTE|PRIVATE_CODE|PRIVATE_FILE|OTHER_PRIVATE_BOOKING|OTHER_TASK_SECRET/);
  assert.equal(context.scope.personId,me);assert.equal(context.scope.tripId,snapshot.commons.id);assert.equal(context.scope.authority,"read_only");
});

test("personal inference reuses the configured transport with a reply-only schema and no tools",async()=>{
  let sent:Record<string,unknown>={};
  const fetcher=async(_url:RequestInfo|URL,init?:RequestInit)=>{sent=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{finish_reason:"stop",message:{content:JSON.stringify({reply:"Your schedule is saved in Plan."})}}]}),{headers:{"content-type":"application/json"}});};
  const result=await converseWithCoordinator(null,"When is dinner?",{personal:true,apiKey:"synthetic",model:"openai/gpt-4.1-mini",transport:"openai"},undefined,fetcher,{tripContext:{trip:{name:"Synthetic"}},conversation:[],priorPolls:[]});
  assert.equal(result.reply,"Your schedule is saved in Plan.");
  const raw=JSON.stringify(sent);assert.match(raw,/ONE authenticated traveler/);assert.match(raw,/no tools/i);assert.doesNotMatch(raw,/tripSuggestion|otherConversations|ORGANIZERS of ONE trip/);
  assert.equal(sent.tools,undefined);
});
