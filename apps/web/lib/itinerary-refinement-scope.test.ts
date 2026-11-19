import test from "node:test";
import assert from "node:assert/strict";
import { syntheticDraft } from "../../../packages/contracts/src/fixtures/research-itinerary";
import { scopeItineraryRefinement, preserveResearchSchedule } from "./itinerary-refinement-scope";
test("Saturday refinement preserves human paragraphs, questions and all other days", () => {
  const before = syntheticDraft().content;
  before.items.push({ ...before.items[1], id: "saturday-schram", day: "2026-11-07" });
  before.opening = "A paragraph Robin just saved"; before.questions = [{ id: "dinner", prompt: "Dinner suggestions?" }];
  const model = structuredClone(before); model.opening = "Model drift"; model.questions = [];
  model.items[0].title = "Unexpected Thursday change";
  model.items = model.items.filter(item => item.day !== "2026-11-07" || item.id === "saturday-schram");
  const after = scopeItineraryRefinement(before, model, "Let's simplify Saturday to the Schramsberg option");
  assert.equal(after.opening, before.opening); assert.deepEqual(after.questions, before.questions);
  assert.deepEqual(after.items.filter(item => item.day !== "2026-11-07"), before.items.filter(item => item.day !== "2026-11-07"));
  assert.deepEqual(after.items.filter(item => item.day === "2026-11-07").map(item => item.id), ["saturday-schram"]);
});


test("research cannot drop or reschedule retained stops even when the model omits them", () => {
 const previous = syntheticDraft().content;
 const proposed = { ...previous, items: [{ ...previous.items[0], day: "2030-01-01", time: "01:00", title: "MODEL_DRIFT", note: "New supported policy" }] };
 const after = preserveResearchSchedule(previous, proposed);
 assert.deepEqual(after.items.map(item => item.id), previous.items.map(item => item.id));
 assert.deepEqual(after.items.slice(1), previous.items.slice(1));
 assert.equal(after.items[0].day, previous.items[0].day); assert.equal(after.items[0].time, previous.items[0].time);
 assert.equal(after.items[0].title, previous.items[0].title); assert.equal(after.items[0].note, "New supported policy");
});
