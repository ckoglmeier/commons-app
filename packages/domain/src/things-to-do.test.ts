import test from "node:test";
import assert from "node:assert/strict";
import type { CommonsState, TripTask } from "@commons/contracts";
import { thingsToDo } from "./things-to-do";

const state = { commonsId: "trip", proposals: [], pollRequests: [{ id: "poll", title: "Choose dates", status: "open", responded: false }] } as unknown as CommonsState;
const todo = { id: "todo", title: "Call shuttle", ownerPersonId: "me", completed: false, dueOn: null } as TripTask;
const input = { tripId: "trip", personId: "me", organizer: true, state, tripTasks: [todo] };

test("one stable projection separates personal completion from poll workflows", () => {
  const before = structuredClone(input);
  const items = thingsToDo(input);
  assert.deepEqual(items.map(item => [item.id, item.state, item.completion, item.source]), [
    ["todo:todo", "actionable", "task_receipt", "personal_task"], ["poll:poll", "actionable", "source_workflow", "poll"],
  ]);
  assert.deepEqual(input, before);
  assert.deepEqual(JSON.parse(JSON.stringify(items)), items);
});

test("traveler projection excludes other people's tasks and other trips", () => {
  const items = thingsToDo({ ...input, organizer: false, tripTasks: [todo, { ...todo, id: "other", ownerPersonId: "other" }] });
  assert.deepEqual(items.map(item => item.id), ["todo:todo", "poll:poll"]);
  assert.ok(items.every(item => item.scope.personId === "me"));
  assert.deepEqual(thingsToDo({ ...input, tripId: "wrong" }), []);
});
