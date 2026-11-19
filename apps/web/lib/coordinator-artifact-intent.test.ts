import test from "node:test";
import assert from "node:assert/strict";
import { itineraryComposerRequest, itineraryOperation, tripTaskOperation } from "./coordinator-artifact-intent";

test("later no-task constraints do not cancel a requested itinerary edit", () => {
  assert.equal(itineraryOperation("Revise this same itinerary. Do not create tasks or update saved plans.", true), "refine");
  for (const text of ["Please don't revise the itinerary", "Could you perhaps update the itinerary", "Maybe simplify Saturday", "Do not create an itinerary"]) assert.equal(itineraryOperation(text, true), null, text);
});
test("task context does not turn ordinary questions into planning calls", () => {
  assert.equal(itineraryOperation("Build a Thursday to Saturday itinerary from our saved base.", false), "construct");
  assert.equal(itineraryOperation("Less driving, please. Keep the same dates and hotel.", true), "refine");
  for (const text of ["What is the hotel?", "Should we build an itinerary?", "How does the itinerary look?", "Don't build an itinerary", "Maybe create an itinerary", "Build a hotel poll"]) assert.equal(itineraryOperation(text, true), null);
  assert.equal(itineraryOperation("Less driving", false), null);
});
test("task requests are bounded literal proposals, not creative assignments", () => {
  assert.deepEqual(tripTaskOperation("Create a task for me to arrange a shared van. Flight times are unknown."), { kind: "create", title: "arrange a shared van" });
  assert.deepEqual(tripTaskOperation("Make the task include confirming luggage and child seats. Do not book or contact anyone."), { kind: "include", text: "confirming luggage and child seats" });
  for (const text of ["Should we create a task?", "I created a task", "Maybe add a task to book a van", "Don't create a task", `Add a task ${"a".repeat(161)}`]) assert.equal(tripTaskOperation(text), null);
});
test("selected itinerary mode and retained imports never upgrade questions or task requests", () => {
  assert.equal(itineraryComposerRequest("How should we think about this draft?", true, true), false);
  assert.equal(itineraryComposerRequest("Create a task for me to arrange a van", true, true), false);
  assert.equal(itineraryComposerRequest("Keep Schramsberg and remove the second stop", true, true), true);
  assert.equal(itineraryComposerRequest("Thursday to Saturday, relaxed pace", false, true), true);
  assert.equal(itineraryComposerRequest("Make Friday less packed and add a linked task to arrange airport transport.", true, true), true);
  assert.equal(itineraryComposerRequest("Make our weekend more relaxed", true, true), true);
  assert.equal(itineraryComposerRequest("Make Friday less packed", true, false), true);
  assert.equal(itineraryComposerRequest("Should we make Friday less packed?", true, true), false);
  assert.equal(itineraryComposerRequest("Make a task to arrange transport", true, true), false);
  assert.equal(itineraryComposerRequest("Make the hotel poll shorter", true, true), false);
  assert.equal(itineraryComposerRequest("Make Friday poll shorter", true, true), false);
  assert.equal(itineraryComposerRequest("Make our trip poll shorter", true, true), false);
  assert.equal(itineraryComposerRequest("Make Friday ballot clearer", true, true), false);
  assert.equal(itineraryComposerRequest("Make our weekend questions shorter", true, true), false);
});

test("explicit day edits target the current document while questions remain answers", () => {
  for (const text of ["Simplify Saturday", "Let's simplify Saturday to the Schramsberg option", "Please remove Friday's second stop", "Update the opening"]) assert.equal(itineraryOperation(text, true), "refine", text);
  for (const text of ["Should we simplify Saturday?", "Why is Saturday packed?", "Maybe simplify Saturday", "Don't simplify Saturday"]) assert.equal(itineraryOperation(text, true), null, text);
  assert.equal(itineraryOperation("Simplify Saturday", false), null);
});

test("a long explicit outline rewrite edits the selected document and never upgrades a question",()=>{
  const request="Rewrite this as a warm, concise Thursday–Saturday outline like Robin’s email. Keep proposed experiences and a few questions; remove operational detail.";
  assert.equal(itineraryOperation(request,true),"refine"); assert.equal(itineraryComposerRequest(request,true,false),true);
  assert.equal(itineraryOperation(request,false),null);
  assert.equal(itineraryOperation(`Should we ${request.toLowerCase()}`,true),null);
});
