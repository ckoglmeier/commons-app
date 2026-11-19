import assert from "node:assert/strict";
import test from "node:test";
import { PollWorkingDataSchema } from "@commons/contracts";
import { pollConstructionMatches, pollConstructionOperations } from "./coordinator-poll-construction";
const choice={id:"00000000-0000-4000-8000-000000000001",kind:"choice",prompt:"Which dinner?",required:true,selectionMode:"single",options:[{id:"00000000-0000-4000-8000-000000000002",label:"A"},{id:"00000000-0000-4000-8000-000000000003",label:"B"}]} as const;
const text={id:"00000000-0000-4000-8000-000000000004",kind:"text",prompt:"Suggestions?",required:false} as const;
const data=(questions: unknown[])=>PollWorkingDataSchema.parse({title:"Private poll",intro:null,ballotMode:"transparent",questions});
test("explicit question counts and optional written answers constrain first construction",()=>{
  const prompt="Include exactly two separate questions: a dinner choice and an optional written suggestions question.";
  assert.equal(pollConstructionMatches(prompt,data([choice,text])),true);
  assert.equal(pollConstructionMatches(prompt,data([choice])),false);
  assert.equal(pollConstructionMatches(prompt,data([choice,{...choice,id:text.id,prompt:'Suggestions?',required:false}])),false,"choice placeholders are not a text input");
  assert.equal(pollConstructionMatches(prompt,data([choice,{...text,required:true}])),false);
  assert.equal(pollConstructionMatches("Use two distinct questions: a dinner choice and an optional free-text suggestions question.",data([choice,text])),true);
  assert.equal(pollConstructionMatches("Create a lodging poll with Hotel A and Hotel B.",data([choice])),true);
});

test("explicit required single and optional multi-choice controls keep actual response behavior",()=>{
  const prompt="Include exactly three questions: required single-choice dinner; optional choose-all-that-work interests; optional written suggestions question.";
  const interest={...choice,id:"00000000-0000-4000-8000-000000000005",prompt:"Interests?",required:false,selectionMode:"multiple"};
  assert.equal(pollConstructionMatches(prompt,data([choice,interest,text])),true);
  assert.equal(pollConstructionMatches(prompt,data([choice,{...interest,required:true},text])),false);
  assert.equal(pollConstructionMatches(prompt,data([choice,{...interest,selectionMode:"single"},text])),false);
  assert.equal(pollConstructionMatches("Ask exactly three separate questions: choose one dinner (required); optionally tick all interests; optionally write suggestions.",data([choice,interest,text])),true);
});

test("typed construction maps to existing operations and preserves provided sources without inventing identities",()=>{
  const choice={kind:"choice" as const,prompt:"Which hotel?",required:true,selectionMode:"single" as const,options:[{label:"A",description:null,exclusive:false,url:"https://example.test/a"},{label:"Neither",description:null,exclusive:true,url:null}]};
  const text={kind:"text" as const,prompt:"Suggestions?",required:false,selectionMode:null,options:[]};
  const operations=pollConstructionOperations([choice,text],[{label:"Source",url:"https://example.test/source"}]);
  assert.deepEqual(operations.map(operation=>operation.kind),["add_workflow_question","add_text_question","add_message_link"]);
  assert.deepEqual(operations[0],{kind:"add_workflow_question",prompt:choice.prompt,selectionMode:"single",options:choice.options});
  assert.deepEqual(operations[1],{kind:"add_text_question",prompt:text.prompt,required:false});
  assert.throws(()=>pollConstructionOperations([{...text,selectionMode:"single",options:choice.options}],[]));
  assert.throws(()=>pollConstructionOperations([{...choice,required:false}],[]),/exclusive/);
});
