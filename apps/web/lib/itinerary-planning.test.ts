import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prepareItineraryProposal } from "./itinerary-planning";
import { newItineraryDraft, itineraryQuestion, parseItineraryText } from "./itinerary-workshop";
import { isItineraryEditRequest } from "./server/coordinator-routing";

const fields = (title = "Dinner in Sonoma") => ({ title, time: "7:00", details: "Table for nine", venue: "", kind: "meal" as const });
function fixture() {
  const data = newItineraryDraft("Thursday–Saturday");
  data.itinerarySource = "Private source and preferences";
  const q = itineraryQuestion(data.questions)!;
  q.itinerary.days[0].label = "Thursday";
  q.itinerary.days[0].items = [{ id: randomUUID(), ...fields("Land at SFO"), kind: "transport", status: "confirmed" }, { id: randomUUID(), ...fields(), status: "tentative" }];
  q.itinerary.otherIdeas = [{ id: randomUUID(), title: "Yoga", details: "If it fits" }];
  return { data, q, dayId: q.itinerary.days[0].id, mealId: q.itinerary.days[0].items[1].id };
}
test("targeted meal edit preserves every identity, untouched anchor, private source and poll contract", () => {
  const { data, q, mealId } = fixture(), before = structuredClone(data);
  const proposed = prepareItineraryProposal(data, { reply: "Try the plaza.", operations: [{ kind: "update_item", itemId: mealId, fields: { ...fields(), venue: "Synthetic Plaza Table" } }] }, () => randomUUID())!;
  const after = itineraryQuestion(proposed.data.questions)!;
  assert.deepEqual(data, before, "preparation is not a mutation");
  assert.deepEqual(after.options, q.options); assert.equal(after.id, q.id);
  assert.deepEqual(after.itinerary.days[0].items[0], q.itinerary.days[0].items[0]);
  assert.equal(after.itinerary.days[0].items[1].id, mealId);
  assert.equal(after.itinerary.days[0].items[1].venue, "Synthetic Plaza Table");
  for (const key of ["audience", "itinerarySource", "communication", "ballotMode", "settledFacts"] as const) assert.deepEqual(proposed.data[key], data[key]);
});
test("rough initial itinerary can add complete days in one proposal; optional ideas remain unscheduled", () => {
  const data = newItineraryDraft("Rough plan"), dayId = itineraryQuestion(data.questions)!.itinerary.days[0].id;
  const result = prepareItineraryProposal(data, { reply: "A slower weekend.", operations: [
    { kind: "update_day", dayId, label: "Thursday", description: "" },
    { kind: "add_item", dayId, afterItemId: null, fields: fields() },
    { kind: "add_day", label: "Friday", description: "", items: [fields("Flowers"), fields("Lunch in Healdsburg")] },
    { kind: "add_day", label: "Saturday", description: "", items: [fields("Schramsberg")] },
    { kind: "add_idea", title: "Yoga", details: "If it fits" },
  ] }, () => randomUUID())!;
  const after = itineraryQuestion(result.data.questions)!.itinerary;
  assert.deepEqual(after.days.map(day => day.label), ["Thursday", "Friday", "Saturday"]);
  assert.equal(after.days.flatMap(day => day.items).length, 4);
  assert.ok(after.days.flatMap(day => day.items).every(item => item.status === "tentative"));
  assert.deepEqual(Object.keys(after.otherIdeas[0]).sort(), ["details", "id", "title"]);
});
test("locked flight/confirmed/linked anchors, unknown targets and forged status fail atomically", () => {
  const { data, q, dayId, mealId } = fixture(), before = structuredClone(data), flight = q.itinerary.days[0].items[0];
  for (const operation of [
    { kind: "remove_item", itemId: flight.id },
    { kind: "move_item", itemId: flight.id, dayId, afterItemId: mealId },
    { kind: "update_day", dayId, label: "Friday", description: "" },
    { kind: "update_item", itemId: randomUUID(), fields: fields() },
    { kind: "add_item", dayId, afterItemId: randomUUID(), fields: fields() },
    { kind: "add_item", dayId, afterItemId: null, fields: { ...fields(), status: "confirmed" } },
    { kind: "publish", access: "link" },
  ]) {
    assert.throws(() => prepareItineraryProposal(data, { reply: "Updated.", operations: [{ kind: "add_idea", title: "Hike", details: "" }, operation] }, () => randomUUID()));
    assert.deepEqual(data, before);
  }
  flight.status = "tentative";
  assert.throws(() => prepareItineraryProposal(data, { reply: "Moved.", operations: [{ kind: "remove_item", itemId: flight.id }] }, () => randomUUID()));
  flight.title = "Member winery"; flight.planItemId = randomUUID();
  assert.throws(() => prepareItineraryProposal(data, { reply: "Moved.", operations: [{ kind: "remove_item", itemId: flight.id }] }, () => randomUUID()));
});
test("no-op questions create no proposal; invalid output and overlarge drafts are rejected", () => {
  const { data, q, mealId } = fixture();
  assert.equal(prepareItineraryProposal(data, { reply: "What pace would you like?", operations: [] }, () => randomUUID()), null);
  assert.equal(prepareItineraryProposal(data, { reply: "Same.", operations: [{ kind: "update_item", itemId: mealId, fields: fields() }] }, () => randomUUID()), null);
  assert.throws(() => prepareItineraryProposal(data, { reply: "Override.", operations: [], audience: "everyone" }, () => randomUUID()));
  q.itinerary.otherIdeas = Array.from({ length: 20 }, () => ({ id: randomUUID(), title: "Optional", details: "" }));
  assert.throws(() => prepareItineraryProposal(data, { reply: "More.", operations: [{ kind: "add_idea", title: "Yoga", details: "" }] }, () => randomUUID()));
});
test("itinerary edit intent is explicit; ordinary advice and canonical trip changes stay separate", () => {
  for (const text of ["Build a rough itinerary", "Put together a rough plan", "Add yoga as an optional idea", "Move dinner to 7:00", "Make Friday slower"]) assert.equal(isItineraryEditRequest(text), true, text);
  for (const text of ["Should we do yoga?", "What is our flight time?", "Update our trip budget to $10,000", "Change our trip dates", "We might go hiking", "Update the budget to $10,000", "Change the destination to Napa", "Add a hotel stay"]) assert.equal(isItineraryEditRequest(text), false, text);
});

test("imported tentative airport arrivals and departures remain locked in every AI edit", () => {
  for (const title of ["Arrive at SFO", "Depart SFO", "Flight home", "Land at SFO"]) {
    const data = newItineraryDraft("Airport anchors"), q = itineraryQuestion(data.questions)!;
    q.itinerary = parseItineraryText(`# Thursday\n| 2:00 PM | ${title} |\n| 3:00 PM | Shared van to hotel |`, "Airport anchors");
    const day = q.itinerary.days[0], anchor = day.items[0], before = structuredClone(data);
    for (const operation of [
      {kind:"remove_item",itemId:anchor.id}, {kind:"update_item",itemId:anchor.id,fields:fields()},
      {kind:"move_item",itemId:anchor.id,dayId:day.id,afterItemId:day.items[1].id},
      {kind:"update_day",dayId:day.id,label:"Friday",description:""},
    ]) { assert.throws(()=>prepareItineraryProposal(data,{reply:"Changed",operations:[operation]},()=>randomUUID())); assert.deepEqual(data,before); }
    assert.ok(prepareItineraryProposal(data,{reply:"Van updated",operations:[{kind:"update_item",itemId:day.items[1].id,fields:{...fields("Shared van to hotel"),kind:"transport"}}]},()=>randomUUID()));
  }
});
