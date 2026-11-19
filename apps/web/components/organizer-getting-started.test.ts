import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { SaveTripTaskSchema, StaySchema, TripTaskSchema, type TripTask } from "@commons/contracts";
import { organizerEarlyQuestions, organizerEarlyTaskIds } from "../lib/organizer-getting-started";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
import { pilotSnapshot } from "../lib/pilot-fixture";
import type { TripTaskContext } from "./trip-tasks";
registerComponentImportStubs();

const context: TripTaskContext = {
  organizer: true, people: pilotSnapshot.participants,
  commons: { ...pilotSnapshot.commons, startsOn: null, endsOn: null, locationName: null, lodging: null, status: "planning" },
  state: { ...pilotSnapshot.state, stays: [], travelPlans: [], targetBudgetCents: undefined },
};
const actorId = pilotSnapshot.currentActor.id;
const props = { slug: context.commons.slug, actorId, context, autoStart: true };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const saved = (body: unknown) => TripTaskSchema.parse({ ...SaveTripTaskSchema.parse(body), version: 1, itemTitle: null });

test("early decisions reuse saved facts and task identities, without inferring transport coverage or attendance", async () => {
  const ids = await organizerEarlyTaskIds(context.commons.id);
  assert.deepEqual(await organizerEarlyTaskIds(context.commons.id), ids);
  const other = await organizerEarlyTaskIds("91000000-0000-4000-8000-000000000001");
  assert.notEqual(other.dates, ids.dates);
  assert.equal(new Set(Object.values(ids)).size, 6);
  const task = saved({ id: ids.transport, commandId: crypto.randomUUID(), title: "Renamed transport task", ownerPersonId: actorId, completed: true, dueOn: null, expectedVersion: 0 });
  const known = { ...context.commons, startsOn: "2027-05-14", endsOn: "2027-05-17", locationName: "Sonoma" };
  const state = { ...context.state, targetBudgetCents: 200_000, stays: pilotSnapshot.state.stays?.map(stay => ({ ...stay, status: "planned" as const })) };
  // A named legacy lodging location is already found, regardless of booking status.
  assert.deepEqual(organizerEarlyQuestions({ ...known, lodging: { name: "A lodge", address: "Sonoma", sourceLabel: "Organizer" } }, state, [task], ids).map(step => step.key), ["people"]);
  assert.deepEqual(organizerEarlyQuestions(context.commons, context.state, [], ids).map(step => step.key), ["dates", "location", "lodging", "transport", "people", "budget"]);
  const stay = StaySchema.parse({ id: crypto.randomUUID(), name: "A lodge", address: "Sonoma", startsOn: "2027-05-14", endsOn: "2027-05-17", includedPersonIds: [actorId], status: "considering", sourceLabel: "Organizer" });
  assert.ok(organizerEarlyQuestions(known, { ...state, stays: [stay] }, [], ids).some(step => step.key === "lodging"));
  assert.ok(!organizerEarlyQuestions(known, { ...state, stays: [{ ...stay, status: "planned" }] }, [], ids).some(step => step.key === "lodging"));
  assert.ok(organizerEarlyQuestions(known, { ...state, travelPlans: pilotSnapshot.state.travelPlans }, [], ids).some(step => step.key === "transport"));
  assert.deepEqual(organizerEarlyQuestions({ ...known, status: "archived" }, state, [], ids), []);
  assert.deepEqual(organizerEarlyQuestions(known, state, [], ids, "2027-05-18"), []);
});

test("answers require a verified save; opening creates nothing, failures retry the identical command after reload", async () => {
  const requests: unknown[] = [];
  const tasks: TripTask[] = [];
  let fail = true;
  const live = installFakeLiveEnvironment({ liveFetch: async (_url, init) => {
    if (init?.method !== "POST") return json({ tasks });
    const body = JSON.parse(String(init.body)); requests.push(body);
    if (fail) return json({ error: "Temporary save failure" }, 503);
    const task = saved(body); tasks.push(task); return json({ task });
  } });
  const { OrganizerGettingStarted } = await import("./organizer-getting-started");
  let renderer = createHookRenderer({ expand: [OrganizerGettingStarted] });
  const text = () => renderer.tree.map(textOf).join(" ");
  const click = (label: string) => (renderer.find(node => node.type === "button" && textOf(node) === label).props.onClick as () => void)();
  try {
    renderer.render(createElement(OrganizerGettingStarted, props)); await settle(20); renderer.flush();
    assert.match(text(), /Have you picked dates\?/); assert.equal(requests.length, 0);
    click("Not yet, add task"); renderer.flush(); await settle(20); renderer.flush();
    assert.match(text(), /Temporary save failure/); assert.match(text(), /Have you picked dates\?/); assert.doesNotMatch(text(), /Added to your Tasks/);
    renderer.unmount();
    renderer = createHookRenderer({ expand: [OrganizerGettingStarted] });
    renderer.render(createElement(OrganizerGettingStarted, props)); await settle(20); renderer.flush();
    assert.match(text(), /Retry this answer/);
    fail = false; click("Retry this answer"); await settle(20); renderer.flush();
    assert.deepEqual(requests[1], requests[0]);
    assert.equal(tasks.length, 1); assert.equal(tasks[0].ownerPersonId, actorId); assert.equal(tasks[0].completed, false); assert.equal(tasks[0].itemKind, null);
    assert.match(text(), /Added to your Tasks: Decide trip dates/); assert.match(text(), /Have you picked a location\?/);
    click("Yes, mark done"); await settle(20); renderer.flush();
    assert.equal(tasks[1].completed, true); assert.match(text(), /Saved a completed task: Choose a trip location/); assert.equal(context.commons.locationName, null);
    click("Not needed"); await settle(20); renderer.flush();
    assert.equal(tasks[2].completed, true); assert.equal(tasks[2].title, "Review lodging needs (not needed)"); assert.equal(context.state.stays?.length, 0);
    click("Not now"); renderer.flush(); assert.doesNotMatch(text(), /Check where we are|Have you/);
    renderer.unmount(); renderer = createHookRenderer({ expand: [OrganizerGettingStarted] });
    renderer.render(createElement(OrganizerGettingStarted, props)); await settle(20); renderer.flush();
    assert.doesNotMatch(text(), /Have you figured out transportation\?/);
    renderer.unmount(); renderer = createHookRenderer({ expand: [OrganizerGettingStarted] });
    renderer.render(createElement(OrganizerGettingStarted, {...props,reopen:true})); await settle(20); renderer.flush(); assert.match(text(), /Have you figured out transportation\?/);
    click("Not yet, add task"); await settle(20); renderer.flush();
    assert.match(text(), /Have you figured out who’s coming\?/);
    click("Yes, mark done"); await settle(20); renderer.flush();
    assert.match(text(), /Have you agreed on a budget\?/);
    click("Not needed"); await settle(20); renderer.flush();
    assert.match(text(), /early decisions are accounted for/); assert.equal(tasks.length, 6);
    assert.deepEqual(tasks.filter(task => !task.completed).map(task => task.title), ["Decide trip dates", "Figure out transportation"]);
    assert.equal(context.commons.startsOn, null); assert.equal(context.commons.locationName, null); assert.equal(context.state.targetBudgetCents, undefined);
  } finally { renderer.unmount(); live.restore(); }
});

test("co-organizer conflict reuses the saved task without changing its owner or completion state", async () => {
  const ids = await organizerEarlyTaskIds(context.commons.id);
  let tasks: TripTask[] = [];
  const existing = saved({ id: ids.dates, commandId: crypto.randomUUID(), title: "Decide trip dates", ownerPersonId: pilotSnapshot.participants[1].id, completed: true, dueOn: null, expectedVersion: 0 });
  const live = installFakeLiveEnvironment({ liveFetch: async (_url, init) => {
    if (init?.method !== "POST") return json({ tasks });
    tasks = [existing]; return json({ error: "Refresh before changing this task" }, 409);
  } });
  const { OrganizerGettingStarted } = await import("./organizer-getting-started");
  const renderer = createHookRenderer({ expand: [OrganizerGettingStarted] });
  try {
    renderer.render(createElement(OrganizerGettingStarted, props)); await settle(20); renderer.flush();
    (renderer.find(node => node.type === "button" && textOf(node) === "Not yet, add task").props.onClick as () => void)();
    await settle(20); renderer.flush();
    const text = renderer.tree.map(textOf).join(" ");
    assert.match(text, /already has a saved Task/); assert.match(text, /Have you picked a location\?/);
    assert.equal(tasks[0].ownerPersonId, existing.ownerPersonId); assert.equal(tasks[0].completed, true);
  } finally { renderer.unmount(); live.restore(); }
});

test("unavailable task reads and invalid receipts never imply onboarding was completed", async () => {
  let readsFail = true;
  const live = installFakeLiveEnvironment({ liveFetch: async (_url, init) => {
    if (init?.method !== "POST") return readsFail ? json({}, 503) : json({ tasks: [] });
    return json({ task: saved({ ...JSON.parse(String(init.body)), id: crypto.randomUUID() }) });
  } });
  const { OrganizerGettingStarted } = await import("./organizer-getting-started");
  const renderer = createHookRenderer({ expand: [OrganizerGettingStarted] });
  try {
    renderer.render(createElement(OrganizerGettingStarted, props)); await settle(20); renderer.flush();
    const text = () => renderer.tree.map(textOf).join(" ");
    assert.match(text(), /couldn’t load/); assert.doesNotMatch(text(), /accounted for/);
    readsFail = false;
    (renderer.find(node => node.type === "button" && textOf(node) === "Try again").props.onClick as () => void)();
    await settle(20); renderer.flush();
    (renderer.find(node => node.type === "button" && textOf(node) === "Yes, mark done").props.onClick as () => void)();
    await settle(20); renderer.flush();
    assert.match(text(), /couldn’t be verified/); assert.match(text(), /Have you picked dates\?/); assert.doesNotMatch(text(), /Saved a completed task/);
  } finally { renderer.unmount(); live.restore(); }
});
