import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CoordinatorTask, TurnSteering } from "@commons/contracts";
import { clarifyChoice, isLive, lastChangeText, newlyFinished, StableCommands, taskStatusText } from "./coordinator-tasks-client";

const task = (over: Partial<CoordinatorTask> = {}): CoordinatorTask => ({
  taskId: randomUUID(), threadId: randomUUID(), title: "Airport transfers", brief: "Seven travelers.", revision: 1, status: "queued", errorCode: null, waitingForSlot: false, needsInput: null,
  resultOutdated: false, hasResult: false, currentRunId: null, runIds: [], ownedByMe: true, requestedByName: "Robin (synthetic)", acceptedAt: "2026-10-01T05:00:00.000Z", updatedAt: "2026-10-01T05:00:00.000Z", lastChange: null, steered: true, ...over,
});

test("status is always words: queued, waiting for a slot, working, needs an answer, outdated, stopped", () => {
  assert.equal(taskStatusText(task()), "Queued");
  assert.equal(taskStatusText(task({ waitingForSlot: true })), "Waiting for a free slot");
  assert.equal(taskStatusText(task({ status: "running" })), "Working");
  assert.equal(taskStatusText(task({ status: "needs_input" })), "Needs your answer");
  assert.equal(taskStatusText(task({ status: "succeeded" })), "Result ready");
  assert.equal(taskStatusText(task({ status: "succeeded", resultOutdated: true })), "Earlier result is out of date");
  assert.equal(taskStatusText(task({ status: "failed", errorCode: "access_revoked" })), "Stopped: access changed");
  assert.equal(taskStatusText(task({ status: "cancelled" })), "Cancelled");
  assert.deepEqual(["queued", "running", "needs_input", "succeeded", "failed", "cancelled"].map(status => isLive({ status } as never)), [true, true, true, false, false, false]);
});

test("one completion announcement per revision: nothing on load or reload, nothing on later polls, one more for a new revision", () => {
  const seen = new Set<string>();
  const running = task({ status: "running" });
  // First poll after load: no previous list, so nothing is announced even for a finished task.
  assert.deepEqual(newlyFinished(null, [{ ...running, status: "succeeded" }], seen), []);
  // Running, then finished while watching: announced once.
  const done = { ...running, status: "succeeded" as const };
  assert.deepEqual(newlyFinished([running], [done], seen).map(item => item.taskId), [running.taskId]);
  assert.deepEqual(newlyFinished([done], [done], seen), [], "later polls repeat nothing");
  assert.deepEqual(newlyFinished([running], [done], seen), [], "a replayed transition for the same revision repeats nothing");
  // A correction after completion and its new result are a new revision: one more announcement.
  const second = { ...done, revision: 2 };
  assert.deepEqual(newlyFinished([{ ...done, revision: 2, status: "queued", resultOutdated: true }], [second], seen).map(item => item.revision), [2]);
  // A result that is still out of date is not announced as ready.
  assert.deepEqual(newlyFinished([running], [{ ...running, revision: 3, status: "succeeded", resultOutdated: true }], new Set()), []);
});

test("the same task and words keep one command id until the operation settles", () => {
  const commands = new StableCommands();
  const first = commands.idFor("amend:t1:1:Add a child seat.");
  assert.equal(commands.idFor("amend:t1:1:Add a child seat."), first, "a retry, a second click or a reload sends the same command");
  assert.notEqual(commands.idFor("amend:t1:1:Different words"), first);
  commands.settle("amend:t1:1:Add a child seat.");
  assert.notEqual(commands.idFor("amend:t1:1:Add a child seat."), first, "once settled, new words get a new command");
});

test("choosing a task builds an explicit control that preserves the organizer's message and the revision they saw", () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const steering: Extract<TurnSteering, { kind: "clarify" }> = { kind: "clarify", operation: "amend", message: "Make it cheaper", candidates: [{ taskId: a, title: "Airport transfers", revision: 2 }, { taskId: b, title: "Wine van", revision: 1 }] };
  assert.deepEqual(clarifyChoice(steering, b), { text: "Make it cheaper", explicitAction: { kind: "task_control", op: "amend", taskId: b, expectedRevision: 1 } });
  assert.equal(clarifyChoice(steering, randomUUID()), null, "a task that was not offered cannot be chosen");
});

test("the last-change line states what happened without inventing detail", () => {
  assert.equal(lastChangeText(task()), null);
  assert.match(lastChangeText(task({ lastChange: { kind: "amended", revision: 2, at: "2026-10-01T05:07:00.000Z", summary: "Two arrive later." } }))!, /^Correction accepted .*: Two arrive later\.$/);
  assert.match(lastChangeText(task({ lastChange: { kind: "cancelled", revision: 1, at: "2026-10-01T05:07:00.000Z", summary: "no_change" } }))!, /it had already stopped/);
});
