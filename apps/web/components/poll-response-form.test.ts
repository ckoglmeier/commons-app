import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { PublicPollSchema } from "@commons/contracts";
import { createHookRenderer, textOf, registerComponentImportStubs } from "@/lib/test-support/hook-harness";
import { installFakeBrowserEnvironment, settle } from "@/lib/test-support/fake-browser-environment";
registerComponentImportStubs();
test("signed-in ordinary polls omit name entry, save under account and revise existing response",async()=>{
 const questionId=crypto.randomUUID(),optionId=crypto.randomUUID();const initial=PublicPollSchema.parse({id:crypto.randomUUID(),publicId:"123456abcdef",event:{slug:"qa",name:"QA"},title:"Dinner",intro:null,status:"open",ballotMode:"transparent",questions:[{id:questionId,kind:"choice",prompt:"Where?",selectionMode:"single",required:true,options:[{id:optionId,label:"Plaza",description:null,url:null,exclusive:false}]}],createdByName:"Organizer",createdAt:"2026-10-05T00:00:00Z",responseCount:0,aggregates:[],resultsVisible:true,identityBound:true,authenticatedName:"Taylor QA"});
 const requests:Array<Record<string,any>>=[]; // eslint-disable-line @typescript-eslint/no-explicit-any
 const live=installFakeBrowserEnvironment({fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);return Response.json({poll:{...initial,responseCount:1,ownResponse:{respondentName:"Taylor QA",answers:body.answers,updatedAt:"2026-10-05T01:00:00Z"}},receiptToken:crypto.randomUUID()+crypto.randomUUID()});}});window.scrollTo=()=>{};
 const {PollResponseForm}=await import("../app/poll/[token]/poll-response-form");const renderer=createHookRenderer({expand:[PollResponseForm]});const submit=()=>{(renderer.find(n=>n.type==="form").props.onSubmit as (event:unknown)=>void)({preventDefault(){}});};
 try{renderer.render(createElement(PollResponseForm,{token:initial.publicId,initialPoll:initial}));await settle(5);renderer.flush();assert.equal(renderer.findAll(n=>n.type==="input"&&n.props.placeholder==="First name").length,0);assert.match(renderer.tree.map(textOf).join(" "),/Responding as Taylor QA/);(renderer.find(n=>n.type==="input"&&n.props.type==="radio").props.onChange as ()=>void)();renderer.flush();submit();renderer.flush();submit();await settle(5);renderer.flush();assert.equal(requests.length,1);assert.equal("respondentName" in requests[0],false);assert.match(renderer.tree.map(textOf).join(" "),/Thanks, Taylor QA/);(renderer.find(n=>n.type==="button"&&textOf(n)==="Edit my response").props.onClick as ()=>void)();renderer.flush();submit();renderer.flush();submit();await settle(5);assert.equal(requests.length,2);assert.equal(requests[1].expectedResponseUpdatedAt,"2026-10-05T01:00:00Z");assert.equal("respondentName" in requests[1],false);}finally{renderer.unmount();live.restore();}
});

test("one organizer-note editor preserves separate question notes through review, save and editing", async () => {
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  const initial = PublicPollSchema.parse({ id: crypto.randomUUID(), publicId: "abc123abc123", event: {slug:"qa",name:"QA"}, title:"Weekend input", intro:null, status:"open", ballotMode:"transparent", questions:[first,second].map((id,index)=>({id,kind:"choice",prompt:`Question ${index+1}`,selectionMode:"single",required:false,options:[{id:crypto.randomUUID(),label:"Works"},{id:crypto.randomUUID(),label:"Maybe"}]})),createdByName:"Organizer",createdAt:"2026-10-05T00:00:00Z",responseCount:0,aggregates:[],resultsVisible:true,identityBound:true,authenticatedName:"Taylor QA"});
  const requests: Array<{answers:Array<{questionId:string;context?:{text:string;kind:string}}>}>=[];
  const live=installFakeBrowserEnvironment({fetch:async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);return Response.json({poll:{...initial,responseCount:1,ownResponse:{respondentName:"Taylor QA",answers:body.answers,updatedAt:"2026-10-05T02:00:00Z"}},receiptToken:crypto.randomUUID()+crypto.randomUUID()});}});
  window.scrollTo=()=>{};
  const {PollResponseForm}=await import("../app/poll/[token]/poll-response-form");
  const renderer=createHookRenderer({expand:[PollResponseForm]});
  const submit=()=>{(renderer.find(n=>n.type==="form").props.onSubmit as (event:unknown)=>void)({preventDefault(){}});renderer.flush();};
  const note=(text:string)=>{(renderer.find(n=>n.type==="textarea").props.onChange as (event:unknown)=>void)({target:{value:text}});renderer.flush();};
  const about=(id:string)=>{(renderer.find(n=>n.type==="select"&&[first,second].includes(String(n.props.value))).props.onChange as (event:unknown)=>void)({target:{value:id}});renderer.flush();};
  try {
    renderer.render(createElement(PollResponseForm,{token:initial.publicId,initialPoll:initial}));await settle(5);renderer.flush();
    assert.equal(renderer.findAll(n=>n.type==="textarea").length,1);
    assert.equal(renderer.findAll(n=>n.type==="select").length,1,"Only the question selector remains; no note classification");
    assert.doesNotMatch(renderer.tree.map(textOf).join(" "),/Notes for the organizer|Only the poll creator|How should they consider/);
    assert.match(renderer.tree.map(textOf).join(" "),/Anything else\? \(optional\)/);
    note("A quiet dinner would help");about(second);note("A short walk is best");about(first);
    assert.equal(renderer.find(n=>n.type==="textarea").props.value,"A quiet dinner would help");
    assert.equal(requests.length,0,"Typing and switching context never saves or sends");
    submit();assert.match(renderer.tree.map(textOf).join(" "),/A quiet dinner would help/);assert.match(renderer.tree.map(textOf).join(" "),/A short walk is best/);
    submit();await settle(5);renderer.flush();
    assert.deepEqual(requests[0].answers.map(a=>[a.questionId,a.context?.text]),[[first,"A quiet dinner would help"],[second,"A short walk is best"]]);
    (renderer.find(n=>n.type==="button"&&textOf(n)==="Edit my response").props.onClick as ()=>void)();renderer.flush();about(second);
    assert.equal(renderer.find(n=>n.type==="textarea").props.value,"A short walk is best");
    const secretRenderer=createHookRenderer({expand:[PollResponseForm]});
    try {
      secretRenderer.render(createElement(PollResponseForm,{token:initial.publicId,initialPoll:{...initial,ballotMode:"secret"}}));
      assert.equal(secretRenderer.findAll(n=>n.props["aria-label"]==="Optional comments").length,0,"Secret ballots never offer private context");
    } finally {secretRenderer.unmount();}
  } finally {renderer.unmount();live.restore();}
});

test("one-question poll has a compact bottom comment and no selectors or privacy copy", async () => {
  const initial = PublicPollSchema.parse({id:crypto.randomUUID(),publicId:"123456abcdef",event:{slug:"qa",name:"QA"},title:"Dinner",intro:null,status:"open",ballotMode:"transparent",questions:[{id:crypto.randomUUID(),kind:"choice",prompt:"Where?",selectionMode:"single",required:false,options:[{id:crypto.randomUUID(),label:"Plaza"}]}],createdByName:"Organizer",createdAt:"2026-10-05T00:00:00Z",responseCount:0,aggregates:[],resultsVisible:true});
  const live = installFakeBrowserEnvironment(); window.scrollTo=()=>{};
  const {PollResponseForm}=await import("../app/poll/[token]/poll-response-form");
  const renderer=createHookRenderer({expand:[PollResponseForm]});
  try {
    renderer.render(createElement(PollResponseForm,{token:initial.publicId,initialPoll:initial}));
    const text=renderer.tree.map(textOf).join(" ");
    assert.equal(renderer.findAll(n=>n.type==="select").length,0);
    assert.equal(renderer.find(n=>n.type==="textarea").props.rows,2);
    assert.ok(text.indexOf("Where?")<text.indexOf("Anything else? (optional)"));
    assert.ok(text.indexOf("Anything else? (optional)")<text.indexOf("Review response"));
    assert.doesNotMatch(text,/Only the poll creator|Optional context|Notes for the organizer|How should they consider/);
  } finally {renderer.unmount();live.restore();}
});
