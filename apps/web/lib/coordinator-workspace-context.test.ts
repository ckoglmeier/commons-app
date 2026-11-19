import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorThread } from "@commons/contracts";
import { defaultWorkspaceContext, validWorkspaceContext, workspaceContextTitle, workspaceContextTurns, workspaceThreadId, workspaceEditableDraft } from "./coordinator-workspace-context";

test("poll title identifies a draft independently from its delivery note", () => {
  const thread = { drafts: [{ id: "email", data: { title: "Where should we stay?", communication: { heading: "Let’s choose our base" } } }], polls: [], turns: [] } as unknown as CoordinatorThread;
  assert.equal(workspaceContextTitle("draft:email", thread), "Where should we stay?");
});

test("restores only context still present and editable in the authenticated thread", () => {
  const thread = { threads: [{ id: "goal-open", status: "active", title: "Choose a stay" }, { id: "goal-closed", status: "archived", title: "Old question" }], drafts: [{ id: "draft-one", publishedPollId: null }, { id: "published", publishedPollId: "poll-one" }], polls: [{ id: "poll-one" }], turns: [] } as unknown as CoordinatorThread;
  assert.equal(validWorkspaceContext("thread:goal-open", thread), "thread:goal-open");
  assert.equal(validWorkspaceContext("thread:goal-closed", thread), "thread:goal-open");
  assert.equal(validWorkspaceContext("draft:draft-one", thread), "draft:draft-one");
  assert.equal(validWorkspaceContext("poll:poll-one", thread), "poll:poll-one");
  for (const value of [null, "draft:published", "draft:another-organizer", "poll:another-trip", "javascript:alert(1)"]) assert.equal(validWorkspaceContext(value, thread), "thread:goal-open");
});

test("stable goal threads keep conversation and title together across artifacts", () => {
  const thread = { threads: [{ id: "goal", status: "active", title: "Find a fly-fishing school" }], drafts: [], polls: [], turns: [
    { id: "a", threadId: "goal", userText: "Find options" }, { id: "b", threadId: "other", userText: "Unrelated" }, { id: "c", threadId: "goal", userText: "Compare those" },
  ] } as unknown as CoordinatorThread;
  assert.equal(workspaceContextTitle("thread:goal", thread), "Find a fly-fishing school");
  assert.deepEqual(workspaceContextTurns("thread:goal", thread).map(turn => turn.id), ["c", "a"]);
});

test("choosing one artifact preserves all messages in its owning conversation", () => {
  const thread = { drafts: [{ id: "itinerary", threadId: "one" }, { id: "dinner", threadId: "one" }], polls: [], turns: [
    { id: "a", threadId: "one", draftId: "itinerary" }, { id: "b", threadId: "one", draftId: "dinner" }, { id: "c", threadId: "two" },
  ] } as unknown as CoordinatorThread;
  for (const key of ["draft:itinerary", "draft:dinner"]) assert.deepEqual(workspaceContextTurns(key, thread).map(turn => turn.id), ["b", "a"]);
});

test("board selection determines title and newest-first conversation without mixing other topics", () => {
  const thread = { drafts: [{ id: "d", data: { title: "Stay" } }], polls: [{ id: "p", title: "Dates" }], turns: [
    { id: "a", draftId: "d", userText: "Compare hotels", workspace: { saved: true } },
    { id: "b", contextPollId: "p" }, { id: "c", draftId: "d" }, { id: "e", contextTurnId: "a" },
  ] } as unknown as CoordinatorThread;
  assert.equal(workspaceContextTitle("draft:d", thread), "Stay");
  assert.equal(workspaceContextTitle("poll:p", thread), "Dates");
  assert.equal(workspaceContextTitle("note:a", thread), "Compare hotels");
  assert.equal(validWorkspaceContext("note:a", thread), "note:a");
  assert.equal(validWorkspaceContext("note:b", thread), "draft:d");
  assert.deepEqual(workspaceContextTurns("draft:d", thread).map(t => t.id), ["c", "a"]);
  assert.deepEqual(workspaceContextTurns("note:a", thread).map(t => t.id), ["e", "a"]);
  assert.deepEqual(workspaceContextTurns("new", thread), []);
});

test("defaults to a purposeful item and uses the new-topic guide when none exists", () => {
  const focused = { activeThreadId: null, threads: [], drafts: [], polls: [{ id: "poll-one", threadId: null, archivedAt: null }], turns: [] } as unknown as CoordinatorThread;
  const empty = { activeThreadId: null, threads: [], drafts: [], polls: [], turns: [{ id: "loose", threadId: null }] } as unknown as CoordinatorThread;
  assert.equal(defaultWorkspaceContext(focused), "poll:poll-one");
  assert.equal(defaultWorkspaceContext(empty), "new");
  assert.equal(validWorkspaceContext("trip", empty), "new");
  assert.equal(workspaceContextTitle("new", empty), "Start something new");
});

test("native itinerary identity restores the exact document independently of a neighboring poll", () => {
 const thread = {activeThreadId:"one",threads:[{id:"one",title:"Coordinator",status:"active"}],drafts:[{id:"dinner",threadId:"one",publishedPollId:null}],polls:[],turns:[{id:"i1",threadId:"one",workspace:{itineraryDraft:{id:"doc1",version:1}}},{id:"i2",threadId:"one",workspace:{itineraryDraft:{id:"doc2",version:1}}},{id:"poll",threadId:"one",draftId:"dinner"}]} as unknown as CoordinatorThread;
 assert.equal(defaultWorkspaceContext(thread,"dinner",undefined,"doc1"),"itinerary:doc1");
 assert.equal(validWorkspaceContext("itinerary:doc1",thread),"itinerary:doc1");
 assert.equal(workspaceContextTitle("itinerary:doc1",thread),"Coordinator");
 assert.deepEqual(workspaceContextTurns("itinerary:doc1",thread).map(turn=>turn.id),["poll","i2","i1"]);
 assert.equal(validWorkspaceContext("itinerary:foreign-trip",thread),"thread:one");
});


test("research selection retains exact older identity and conversation, excluding editable neighbors",()=>{
 const thread={activeThreadId:"one",threads:[{id:"one",status:"active",title:"Coordinator"}],drafts:[{id:"d",threadId:"one"}],polls:[],turns:[{id:"it",threadId:"one",workspace:{itineraryDraft:{id:"doc"}}},{id:"r1",threadId:"one",workspace:{research:{query:"First hotel"}}},{id:"r2",threadId:"one",workspace:{research:{query:"Second hotel"}}}]} as unknown as CoordinatorThread;
 for(const id of ["r1","r2"]){assert.equal(validWorkspaceContext(`research:${id}`,thread),`research:${id}`);assert.equal(workspaceThreadId(`research:${id}`,thread),"one");assert.equal(workspaceEditableDraft(`research:${id}`,thread),undefined);assert.equal(workspaceContextTitle(`research:${id}`,thread),"Coordinator");assert.deepEqual(workspaceContextTurns(`research:${id}`,thread).map(t=>t.id),["r2","r1","it"]);}
 assert.equal(validWorkspaceContext("research:foreign",thread),"thread:one");
});
