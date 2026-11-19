import assert from "node:assert/strict";
import test from "node:test";
import type { CoordinatorThread } from "@commons/contracts";
import { pollPreparationRequest, resolvePollPreparation } from "./coordinator-poll-request";

const turns = (items: object[]) => items.map((item, index) => ({ id: String(index), threadId: "one", authorPersonId: "organizer", status: "completed", ...item })) as CoordinatorThread["turns"];
test("assent uses only the immediately preceding unexpired offer without competing scope", () => {
  const pollOffer = {request:"Prepare a private dinner poll with Garden and Bistro",expiresAt:new Date(Date.now()+60000).toISOString()};
  const offered = {userText:"Should we ask the group about dinner?",assistantText:"Want me to prepare a poll?",workspace:{pollOffer}};
  assert.equal(resolvePollPreparation("Yes",turns([offered,{userText:"Yes",status:"running"}]),"1")?.request,pollOffer.request);
  for (const barrier of [{workspace:{pollOffer:{...pollOffer,expiresAt:new Date(0).toISOString()}}},{workspace:{pollOffer,tripProposal:{}}},{workspace:{pollOffer,proposal:{}}},{threadId:"other"},{authorPersonId:"other"},{status:"failed"}]) {
    assert.equal(resolvePollPreparation("Yes",turns([{...offered,...barrier},{userText:"Yes",status:"running"}]),"1"),null);
  }
  assert.equal(resolvePollPreparation("Yes",turns([offered,{userText:"Unrelated question",assistantText:"Answer"},{userText:"Yes",status:"running"}]),"2"),null);
  assert.equal(resolvePollPreparation("Yes",turns([offered,{userText:"Yes",draftId:"saved",workspace:{capability:"prepare_poll"}},{userText:"Yes",status:"running"}]),"2"),null);
});
test("rediscovery returns a real same-conversation receipt and never an assistant promise", () => {
  for (const text of ["Where's the poll?","Show it to me","Show me the poll"]) {
    assert.equal(resolvePollPreparation(text,turns([{userText:"Create a dinner poll",assistantText:"Prepared",draftId:"saved",workspace:{capability:"prepare_poll"}},{userText:text,status:"running"}]),"1")?.savedDraftId,"saved");
    assert.equal(resolvePollPreparation(text,turns([{userText:"Create a dinner poll",assistantText:"I prepared it"},{userText:text,status:"running"}]),"1"),null);
  }
});
test("bounded poll drafting follow-up retains the human choices, not assistant promises", () => {
  const history = turns([{ userText: "Create a poll for Billy’s Tavern or Becky’s House of Horrors" }, { userText: "Just that one" }, { userText: "Did you make it?" }, { userText: "Prepare it now", status: "running" }]);
  assert.match(pollPreparationRequest("Prepare it now", history, "3")!, /Billy’s Tavern/);
  assert.equal(pollPreparationRequest("Yes", history, "3"), null);
  assert.equal(pollPreparationRequest("Send it", history, "3"), null);
  for (const edit of ["Make the poll shorter", "Can you make this poll more concise?", "Make our poll a little warmer"]) assert.equal(pollPreparationRequest(edit, []), null);
});
test("follow-up cannot cross authors, topics, or an existing artifact receipt", () => {
  for (const barrier of [{ userText: "Let's change the flight" }, { userText: "Just that one", authorPersonId: "other" }, { userText: "Just that one", workspace: { proposal: {} } }, { userText: "Just that one", draftId: "saved", workspace: { capability: "prepare_poll" } }]) {
    assert.equal(pollPreparationRequest("Prepare it now", turns([{ userText: "Create a poll about dinner" }, barrier, { userText: "Prepare it now", status: "running" }]), "2"), null);
  }
  assert.equal(pollPreparationRequest("Prepare it now", turns([{ userText: "Create a poll about dinner", threadId: "other" }, { userText: "Prepare it now", status: "running" }]), "1"), null);
  assert.equal(pollPreparationRequest("Prepare it now", turns([{ userText: "What about dinner?", assistantText: "I can prepare a poll" } ])), null);
});

const exact = "Create a NEW private restaurant poll titled “QA — Restaurant preferences — 2026-10-06 — release”. Ask which dinner option people prefer: Billy’s Tavern or Becky’s House of Horrors. Keep it in this conversation. Do not publish, send invitations, create tasks or change the itinerary or Plan.";
const recovery = "Prepare that new restaurant poll now, using the two options I just provided. Keep it private.";
test("exact live creation and recovery preserve positive private intent", () => {
  assert.equal(pollPreparationRequest(exact, []), exact);
  for (const prompt of [recovery, "Could you please prepare that poll now with those choices. Keep it private.", "Draft it now for my review.", "Make the poll with the same options."]) {
    const history = turns([{userText:exact,status:"failed"},{userText:prompt,status:"running"}]);
    assert.match(pollPreparationRequest(prompt,history,"1")!, /Billy’s Tavern/);
  }
});
test("recovery reuses a saved receipt without assistant authority or crossing barriers", () => {
  const saved = turns([{userText:exact,draftId:"saved",workspace:{capability:"prepare_poll"}},{userText:recovery,status:"running"}]);
  assert.equal(resolvePollPreparation(recovery,saved,"1")?.savedDraftId,"saved");
  for (const barrier of [{userText:"Actually don't prepare that poll."},{userText:"Change my flight"},{userText:"Prepare it now",authorPersonId:"other"},{userText:"Prepare it now",threadId:"other"},{userText:"Prepare it now",status:"running"}]) {
    assert.equal(resolvePollPreparation(recovery,turns([{userText:exact},barrier,{userText:recovery,status:"running"}]),"2"),null);
  }
  for (const prompt of ["Yes", "Yes, do it", "Publish it", "Prepare it after we decide", "Maybe prepare it", "Did you create it?"]) assert.equal(resolvePollPreparation(prompt,turns([{userText:exact}])),null,prompt);
  assert.equal(resolvePollPreparation(recovery,turns([{userText:"What about dinner?",assistantText:"I can create a restaurant poll"}])),null);
  assert.equal(resolvePollPreparation(recovery,turns([{userText:exact},...Array.from({length:6},()=>({userText:"Did you make it?"}))])),null,"recovery stays bounded");
});


test("bounded recovery supports named lodging/date/attendance polls and still leaves existing edits alone", () => {
  for (const name of ["lodging", "dates", "trip attendance", "airport-transfer"]) {
    const request=`Create a new ${name} poll with option A and option B. Do not create tasks.`;
    const recovery=`Prepare that new ${name} poll now with those choices. Keep it private.`;
    const history=turns([{userText:request,status:"failed"},{userText:recovery,status:"running"}]);
    assert.match(pollPreparationRequest(recovery,history,"1")!, /option A and option B/);
  }
  for (const request of ["Make the lodging poll shorter.","Make the existing lodging poll private.","Make the lodging poll introduction shorter."]) assert.equal(pollPreparationRequest(request,[]),null,request);
});


test("recovery cannot substitute another recent poll for a named target or an explicitly selected older poll", () => {
  const request="Create a new dates poll with November 5 and November 12.";
  const history=turns([{userText:request,draftId:"dates-draft",workspace:{capability:"prepare_poll"}}]);
  assert.equal(resolvePollPreparation("Prepare that new lodging poll now with those choices.",history),null);
  assert.equal(resolvePollPreparation("Prepare it now.",history,undefined,"lodging-draft"),null);
  assert.equal(resolvePollPreparation("Prepare it now.",history,undefined,"dates-draft")?.savedDraftId,"dates-draft");
  assert.equal(resolvePollPreparation("Prepare that new dates poll now with those choices.",history,undefined,"lodging-draft")?.savedDraftId,"dates-draft","an explicit human target can open its matching saved receipt");
});


test("repeating a named recovery reuses its validated receipt rather than creating a second poll", () => {
  const request="Create a new lodging poll with Hotel A and Hotel B.", recovery="Prepare that new lodging poll now with those choices. Keep it private.";
  const history=turns([{userText:request,draftId:"lodging",workspace:{capability:"prepare_poll"}},{userText:recovery,workspace:{pollReview:{draftId:"lodging",version:1}}},{userText:recovery,status:"running"}]);
  assert.equal(resolvePollPreparation(recovery,history,"2","lodging")?.savedDraftId,"lodging");
  assert.equal(resolvePollPreparation("Prepare that new dates poll now with those choices.",history,"2","lodging"),null);
});
