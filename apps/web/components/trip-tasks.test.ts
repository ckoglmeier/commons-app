import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { TripTaskSchema, type TripTask } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs } from "../lib/test-support/hook-harness";
import { installFakeBrowserEnvironment, settle } from "../lib/test-support/fake-browser-environment";
registerComponentImportStubs();

test("Task snapshots reuse authorized loads and ignore late data after switching trips", async () => {
  const task = TripTaskSchema.parse({ id: crypto.randomUUID(), title: "Arrange airport transfer", ownerPersonId: crypto.randomUUID(), dueOn: null, completed: false, version: 1, itemKind: null, itemId: null, itemTitle: null });
  let releaseOld: (response: Response) => void = () => {};
  let holdOld = false;
  const requests: string[] = [], snapshots: Array<{ trip: string; tasks: TripTask[] }> = [];
  const live = installFakeBrowserEnvironment({ fetch: async url => {
    requests.push(url);
    if (url.includes("old-trip") && holdOld) return new Promise<Response>(resolve => { releaseOld = resolve; });
    return Response.json({ tasks: url.includes("old-trip") ? [task] : [] });
  } });
  const { TripTasks, SuggestionAction } = await import("./trip-tasks");
  const renderer = createHookRenderer({ expand: [TripTasks, SuggestionAction] });
  try {
    renderer.render(createElement(TripTasks, { slug: "old-trip", actorId: task.ownerPersonId, onTasksLoaded: tasks => snapshots.push({ trip: "old", tasks }) }));
    await settle(5); renderer.flush();
    assert.deepEqual(snapshots, [{ trip: "old", tasks: [task] }]);
    holdOld = true; window.dispatchEvent(new Event("commons:trip-tasks-changed")); await settle(5);
    renderer.render(createElement(TripTasks, { slug: "new-trip", actorId: task.ownerPersonId, onTasksLoaded: tasks => snapshots.push({ trip: "new", tasks }) }));
    await settle(5); renderer.flush();
    releaseOld(Response.json({ tasks: [task] })); await settle(5); renderer.flush();
    assert.deepEqual(snapshots, [{ trip: "old", tasks: [task] }, { trip: "new", tasks: [] }]);
    assert.deepEqual(requests, ["/api/v1/commons/old-trip/tasks", "/api/v1/commons/old-trip/tasks", "/api/v1/commons/new-trip/tasks"]);
  } finally { renderer.unmount(); live.restore(); }
});

test("completed to-dos disappear from the active list but remain in loaded history", async () => {
  const task = TripTaskSchema.parse({ id: crypto.randomUUID(), title: "Check the house", ownerPersonId: crypto.randomUUID(), dueOn: null, completed: false, version: 1, itemKind: null, itemId: null, itemTitle: null });
  let completed = false;
  const snapshots: TripTask[][] = [];
  const live = installFakeBrowserEnvironment({ fetch: async () => Response.json({ tasks: [{ ...task, completed }] }) });
  const { TripTasks } = await import("./trip-tasks");
  const renderer = createHookRenderer({ expand: [TripTasks] });
  try {
    renderer.render(createElement(TripTasks, { slug: "trip", onTasksLoaded: value => snapshots.push(value) }));
    await settle(5); renderer.flush();
    assert.equal(renderer.findAll(node => node.type === "summary" && node.children.includes(task.title)).length, 1);
    completed = true;
    window.dispatchEvent(new Event("commons:trip-tasks-changed"));
    await settle(5); renderer.flush();
    assert.equal(renderer.findAll(node => node.type === "summary" && node.children.includes(task.title)).length, 0);
    assert.equal(snapshots.at(-1)?.[0].completed, true);
    assert.equal(renderer.findAll(node => node.type === "p" && node.children.includes("No open to-dos.")).length, 1);
  } finally { renderer.unmount(); live.restore(); }
});
