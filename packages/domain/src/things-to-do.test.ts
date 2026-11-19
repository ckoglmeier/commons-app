import test from "node:test";
import assert from "node:assert/strict";
import type { CommonsState, CoordinatorGoal, TripTask } from "@commons/contracts";
import { thingsToDo } from "./things-to-do";

const state = { commonsId: "trip", proposals: [], pollRequests: [{ id: "poll", title: "Choose dates", status: "open", responded: false }] } as unknown as CommonsState;
const todo = { id: "todo", title: "Call shuttle", ownerPersonId: "me", completed: false, dueOn: null } as TripTask;
const goal = { goalId: "goal", threadId: "conversation", title: "Find dates", ownedByMe: true, lifecycle: "waiting_for_event", waitDetail: "Waiting for answers", revision: 1, updatedAt: "2026-10-11T12:00:00Z", executionBlocked: null } as CoordinatorGoal;
const input = { tripId: "trip", personId: "me", organizer: true, state, tripTasks: [todo], goals: [goal] };

test("guided draft, waiting and review presentation follows the saved poll stage without completing its Goal", () => {
  const project = (stage: string) => thingsToDo({ ...input, goals: [{ ...goal, lifecycle: "waiting_for_approval", planning: { runId: "run", stage, label: stage, nextAction: stage } }] }).find(item => item.source === "goal")!;
  assert.equal(project("draft").action, "Continue draft");
  assert.equal(project("collecting").state, "waiting");
  assert.equal(project("decide").action, "Review answers");
  assert.equal(project("decided").action, "Review goal outcome");
});

test("all answers makes closing voting actionable exactly once, without claiming a decision", () => {
  const current = { ...goal, planning: { runId: "run", stage: "collecting", label: "Answers ready to review", nextAction: "Close voting, then review the answers.", action: "close_voting" as const } };
  const items = thingsToDo({ ...input, goals: [current] }).filter(item => item.source === "goal");
  assert.equal(items.length, 1); assert.equal(items[0].state, "actionable");
  assert.equal(items[0].action, "Close voting and review"); assert.equal(items[0].detail, current.planning.nextAction);
  assert.deepEqual(items[0].target, { kind: "task", id: current.threadId });
  assert.equal(current.lifecycle, "waiting_for_event", "a display action does not complete or approve the Goal");
});

test("withdrawn and empty closed rounds offer their round, not a nonexistent outcome or answers", () => {
  for (const stage of ["closed", "decide"]) {
    const current = { ...goal, lifecycle: "waiting_for_approval" as const, planning: { runId: "run", stage, label: "Round closed", nextAction: "View the round", action: "view_round" as const } };
    assert.equal(thingsToDo({ ...input, goals: [current] }).find(item => item.source === "goal")?.action, "View round");
  }
  const legacy = { ...goal, lifecycle: "waiting_for_approval" as const, planning: { runId: "run", stage: "closed", label: "Round closed", nextAction: "View the round" } };
  assert.equal(thingsToDo({ ...input, goals: [legacy] }).find(item => item.source === "goal")?.action, "View round");
});

test("one stable projection separates personal completion from goal and poll workflows", () => {
  const before = structuredClone(input);
  const items = thingsToDo(input);
  assert.deepEqual(items.map(item => [item.id, item.state, item.completion]), [
    ["todo:todo", "actionable", "task_receipt"], ["poll:poll", "actionable", "source_workflow"], ["task:goal", "waiting", "source_workflow"],
  ]);
  assert.deepEqual(items.at(-1)?.target, { kind: "task", id: "conversation" });
  assert.deepEqual(input, before);
  assert.deepEqual(JSON.parse(JSON.stringify(items)), items);
});

test("traveler projection excludes organizer goals and other people's tasks", () => {
  const items = thingsToDo({ ...input, organizer: false, tripTasks: [todo, { ...todo, id: "other", ownerPersonId: "other" }] });
  assert.deepEqual(items.map(item => item.id), ["todo:todo", "poll:poll"]);
  assert.ok(items.every(item => item.scope.personId === "me"));
  assert.deepEqual(thingsToDo({ ...input, tripId: "wrong" }), []);
});

test("resolved source actions disappear without completing a goal or duplicating it", () => {
  const items = thingsToDo({ ...input, tripTasks: [{ ...todo, completed: true }], state: { ...state, pollRequests: state.pollRequests!.map(poll => ({ ...poll, responded: true })) } });
  assert.deepEqual(items.map(item => item.id), ["task:goal"]);
  const approval = thingsToDo({ ...input, goals: [{ ...goal, lifecycle: "waiting_for_approval" }] });
  assert.equal(approval.filter(item => item.id === "task:goal").length, 1);
  assert.equal(approval.find(item => item.id === "task:goal")?.state, "actionable");
});

test("waiting never claims execution without a worker, and retains ownership boundaries", () => {
  const items = thingsToDo({ ...input, goals: [{ ...goal, lifecycle: "ready", executionBlocked: "runner" }, { ...goal, goalId: "other", ownedByMe: false }] });
  assert.equal(items.at(-1)?.detail, "Work is planned; execution is unavailable.");
  assert.equal(items.filter(item => item.source === "goal").length, 1);
  assert.equal(thingsToDo({ ...input, goals: [{ ...goal, lifecycle: "completed" }] }).some(item => item.source === "goal"), false);
});
