import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, coordinatorResearchRuns, coordinatorTaskEvents, coordinatorThreadLinks, coordinatorThreads, memberships, people, researchAttempts, researchTasks } from "./schema";
import { DELIVERY_LEASE_MS } from "./delivery-lease";
import { claimResearchTask, finishResearchTask, finishResearchTaskDetailed, TASK_MAX_OUTSTANDING, TASK_MAX_RUNNING, type TaskLease } from "./index";
import { amendCoordinatorTask, cancelCoordinatorTask, linkTaskOutcomeToMain, listCoordinatorTasks, listThreadOutcomes, readCoordinatorTask, readCoordinatorTaskHistory, startCoordinatorTask, TaskNotAmendableError, TaskRevisionConflictError } from "./coordinator-task-repository";
import { ensureMainThread, startSubthread } from "./coordinator-thread-link-repository";
import { runResearchTask } from "./research-worker";

/*
 * Real-database tests for the steering invariant: superseded, cancelled, expired or unauthorized work can never commit as a current result.
 * "Two workers" are separate connections, and in two cases separate operating-system processes, so nothing here depends on process-local state.
 * Fixture: a fictional seven-traveler trip with an airport-transfer task and a wine-van task. No provider, model or network is used.
 */
const enabled = process.env.COMMONS_RUN_DATABASE_TESTS === "1";
const databaseUrl = process.env.TEST_DATABASE_URL as string;
const result = (query: string, note = "Fixture source") => ({ query, status: "partial" as const, sources: [], limitations: [note] });

async function fixture(label: string) {
  const db = createDatabase(databaseUrl);
  const [jordan, robin, outsider] = [randomUUID(), randomUUID(), randomUUID()], trip = randomUUID(), thread: string = randomUUID();
  await db.db.insert(people).values([{ id: jordan, displayName: "Jordan (synthetic)" }, { id: robin, displayName: "Robin (synthetic)" }, { id: outsider, displayName: "Outsider (synthetic)" }]);
  await db.db.insert(commons).values({ id: trip, slug: `${label}-${trip}`, name: `Synthetic seven-traveler trip ${label}`, timezone: "UTC", createdByPersonId: jordan });
  await db.db.insert(memberships).values([{ commonsId: trip, personId: jordan, role: "organizer", status: "active" }, { commonsId: trip, personId: robin, role: "organizer", status: "active" }]);
  await db.db.insert(coordinatorThreads).values({ id: thread, commonsId: trip, createdByPersonId: jordan, title: "Main", lastCommandId: randomUUID(), lastCommandFingerprint: "fixture" });
  const as = (actorPersonId: string) => ({ databaseUrl, actorPersonId });
  const request = (query: string, threadId: string = thread, personId: string = jordan) => ({ protocolVersion: 1 as const, commandId: randomUUID(), commonsId: trip, threadId, parentTaskId: null,
    caller: { kind: "human" as const, personId }, capability: "research.public_sources" as const, input: { query }, routing: { kind: "commons_specialist" as const }, returnTo: { kind: "commons_thread" as const, threadId } });
  const start = async (title: string, query: string, threadId: string = thread, personId: string = jordan) => (await startCoordinatorTask(request(query, threadId, personId), { title, brief: `${title}: seven travelers.`, contextVersion: 0 }, as(personId))).task;
  const cleanup = async () => { await db.db.delete(commons).where(eq(commons.id, trip)); for (const id of [jordan, robin, outsider]) await db.db.delete(people).where(eq(people.id, id)); await db.close(); };
  return { db, jordan, robin, outsider, trip, thread, as, request, start, cleanup };
}
const runsFor = (db: ReturnType<typeof createDatabase>, thread: string) => db.db.select().from(coordinatorResearchRuns).where(eq(coordinatorResearchRuns.threadId, thread));
const claim = async (now?: Date) => { const lease = await claimResearchTask(databaseUrl, now); assert.ok(lease, "a task should have been claimable"); return lease as TaskLease; };

test("steering: start, status, outstanding bound and idempotent start", { skip: !enabled }, async () => {
  const f = await fixture("start");
  try {
    const transfer = await f.start("Airport transfers", "Airport transfer options near Sonoma for 7");
    assert.equal(transfer.status, "queued"); assert.equal(transfer.revision, 1); assert.equal(transfer.ownedByMe, true); assert.equal(transfer.steered, true);
    // Same command id and payload: the same task, not a second one.
    const input = f.request("Wine van options in Healdsburg");
    const a = await startCoordinatorTask(input, { title: "Wine van", brief: "Wine van for 7", contextVersion: 1 }, f.as(f.jordan));
    const b = await startCoordinatorTask(input, { title: "Wine van", brief: "Wine van for 7", contextVersion: 1 }, f.as(f.jordan));
    assert.equal(a.taskId, b.taskId);
    await assert.rejects(startCoordinatorTask(input, { title: "Wine van", brief: "Changed brief", contextVersion: 1 }, f.as(f.jordan)));
    // Another organizer can read both, sees they are not theirs, and has their own bound.
    const seen = await listCoordinatorTasks(f.trip, f.thread, f.as(f.robin));
    assert.equal(seen.length, 2); assert.ok(seen.every(task => task.ownedByMe === false));
    await assert.rejects(listCoordinatorTasks(f.trip, f.thread, f.as(f.outsider)));
    // The bounded outstanding limit is visible as a refusal, never silent queueing beyond it.
    for (let i = 2; i < TASK_MAX_OUTSTANDING; i++) await f.start(`Extra ${i}`, `Query ${i}`);
    await assert.rejects(f.start("One too many", "Query overflow"));
    const robinTask = await f.start("Robin's own task", "Robin query", f.thread, f.robin);
    assert.equal(robinTask.ownedByMe, true);
  } finally { await f.cleanup(); }
});

test("steering: a correction while running makes the old attempt unable to commit, in another process too", { skip: !enabled }, async () => {
  const f = await fixture("correction");
  try {
    const transfer = await f.start("Airport transfers", "Airport transfer options near Sonoma for 7");
    // Worker A runs in a separate operating-system process: it claims and exits holding a live lease, like a function instance that is still working.
    const leaseA = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      "import { claimResearchTask } from './packages/database/src/research-task-repository.ts'; console.log(JSON.stringify(await claimResearchTask(process.env.TEST_DATABASE_URL)));",
    ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" })) as TaskLease;
    assert.equal(leaseA.taskId, transfer.taskId); assert.equal(leaseA.revision, 1);
    const amended = await amendCoordinatorTask({ taskId: transfer.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Two travelers arrive later; arrival time unknown." }, f.as(f.jordan));
    assert.equal(amended.task.revision, 2); assert.equal(amended.task.status, "queued"); assert.equal(amended.supersededRunning, true);
    // The old attempt tries to publish from yet another process. The database refuses it.
    const staleCommit = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { finishResearchTaskDetailed } from './packages/database/src/research-task-repository.ts'; const lease = JSON.parse(process.env.LEASE); console.log(JSON.stringify(await finishResearchTaskDetailed(lease, { result: JSON.parse(process.env.RESULT) }, process.env.TEST_DATABASE_URL)));`,
    ], { cwd: new URL("../../../", import.meta.url), encoding: "utf8", env: { ...process.env, LEASE: JSON.stringify(leaseA), RESULT: JSON.stringify(result("Airport transfer options near Sonoma for 7", "stale revision 1")) } }));
    assert.deepEqual(staleCommit, { committed: false, reason: "superseded" });
    assert.equal((await runsFor(f.db, f.thread)).length, 0, "a superseded attempt must not leave a current result");
    const [attemptA] = await f.db.db.select().from(researchAttempts).where(eq(researchAttempts.id, leaseA.attemptId));
    assert.equal(attemptA.status, "superseded");
    // The new revision runs and commits; its lease carries revision 2 and a higher claim counter.
    const leaseB = await claim();
    assert.equal(leaseB.revision, 2); assert.ok(leaseB.attempt > leaseA.attempt);
    assert.equal((await finishResearchTaskDetailed(leaseA, { result: result(leaseA.query) }, databaseUrl)).committed, false);
    assert.deepEqual(await finishResearchTaskDetailed(leaseB, { result: result(leaseB.query, "revision 2") }, databaseUrl), { committed: true, revision: 2 });
    const done = await readCoordinatorTask(transfer.taskId, f.as(f.jordan));
    assert.equal(done.status, "succeeded"); assert.equal(done.revision, 2); assert.equal(done.resultOutdated, false); assert.ok(done.currentRunId);
    const runs = await runsFor(f.db, f.thread);
    assert.equal(runs.length, 1); assert.equal(runs[0].limitations[0], "revision 2");
    const events = await f.db.db.select().from(coordinatorTaskEvents).where(eq(coordinatorTaskEvents.taskId, transfer.taskId));
    assert.deepEqual(events.map(event => `${event.kind}:${event.revision}`).sort(), ["amended:2", "completed:2", "started:1"]);
    // One completion per revision is also a database rule, not only application logic.
    await assert.rejects(f.db.db.insert(coordinatorTaskEvents).values({ commonsId: f.trip, taskId: transfer.taskId, threadId: f.thread, kind: "completed", revision: 2 }));
  } finally { await f.cleanup(); }
});

test("steering: stale revisions, duplicate commands and concurrent corrections", { skip: !enabled }, async () => {
  const f = await fixture("stale");
  try {
    const task = await f.start("Airport transfers", "Airport transfers for 7");
    const first = randomUUID();
    const [one, two] = await Promise.all([
      amendCoordinatorTask({ taskId: task.taskId, commandId: first, expectedRevision: 1, note: "Two arrive later." }, f.as(f.jordan)),
      amendCoordinatorTask({ taskId: task.taskId, commandId: first, expectedRevision: 1, note: "Two arrive later." }, f.as(f.jordan)),
    ]);
    assert.equal(one.task.revision, 2); assert.equal(two.task.revision, 2);
    assert.equal([one, two].filter(item => item.replayed).length, 1, "one command id is one operation");
    await assert.rejects(amendCoordinatorTask({ taskId: task.taskId, commandId: first, expectedRevision: 1, note: "Different words" }, f.as(f.jordan)));
    // A second tab that still shows revision 1 is a conflict that names the current revision, and changes nothing.
    await assert.rejects(amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Late tab" }, f.as(f.jordan)),
      (error: unknown) => error instanceof TaskRevisionConflictError && error.currentRevision === 2);
    // Two different corrections racing from the same revision: exactly one wins.
    const race = await Promise.allSettled([
      amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 2, note: "Add a child seat." }, f.as(f.jordan)),
      amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 2, note: "Add a wheelchair-accessible vehicle." }, f.as(f.jordan)),
    ]);
    assert.equal(race.filter(item => item.status === "fulfilled").length, 1);
    const current = await readCoordinatorTask(task.taskId, f.as(f.jordan));
    assert.equal(current.revision, 3);
    assert.equal((current.brief.match(/Revision/g) ?? []).length, 2, "each accepted correction is recorded once with its revision");
    const history = await readCoordinatorTaskHistory(task.taskId, f.as(f.robin));
    assert.deepEqual(history.map(item => `${item.kind}:${item.revision}`), ["started:1", "amended:2", "amended:3"]);
    assert.equal(history[1].by, "Jordan (synthetic)");
  } finally { await f.cleanup(); }
});

test("steering: only the initiating organizer can amend or cancel; others can read", { skip: !enabled }, async () => {
  const f = await fixture("owner");
  try {
    const task = await f.start("Wine van", "Wine van for 7");
    await assert.rejects(amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Robin tries to change it" }, f.as(f.robin)));
    await assert.rejects(cancelCoordinatorTask({ taskId: task.taskId, commandId: randomUUID() }, f.as(f.robin)));
    await assert.rejects(amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Outsider" }, f.as(f.outsider)));
    assert.equal((await readCoordinatorTask(task.taskId, f.as(f.robin))).ownedByMe, false);
    assert.equal((await readCoordinatorTask(task.taskId, f.as(f.robin))).revision, 1);
    // A task id from another trip is indistinguishable from a missing one.
    const other = await fixture("owner-other");
    try { await assert.rejects(readCoordinatorTask(task.taskId, { ...other.as(other.jordan), commonsId: other.trip })); } finally { await other.cleanup(); }
  } finally { await f.cleanup(); }
});

test("steering: cancellation during inference, and cancelling after the result was committed", { skip: !enabled }, async () => {
  const f = await fixture("cancel");
  try {
    const task = await f.start("Airport transfers", "Airport transfers for 7");
    const lease = await claim();
    const command = randomUUID();
    const cancelled = await cancelCoordinatorTask({ taskId: task.taskId, commandId: command }, f.as(f.jordan));
    assert.equal(cancelled.cancelled, true); assert.equal(cancelled.task.status, "cancelled");
    assert.deepEqual(await finishResearchTaskDetailed(lease, { result: result(lease.query) }, databaseUrl), { committed: false, reason: "cancelled" });
    assert.equal((await runsFor(f.db, f.thread)).length, 0);
    // The retried command reports the same thing and does not multiply events.
    const replay = await cancelCoordinatorTask({ taskId: task.taskId, commandId: command }, f.as(f.jordan));
    assert.equal(replay.replayed, true); assert.equal(replay.cancelled, true);
    // A cancelled task is final: a correction cannot revive it.
    await assert.rejects(amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Revive" }, f.as(f.jordan)), TaskNotAmendableError);
    // A task that finished first stays finished: cancel reports the actual state and keeps the saved result.
    const van = await f.start("Wine van", "Wine van for 7");
    const vanLease = await claim();
    assert.equal((await finishResearchTaskDetailed(vanLease, { result: result(vanLease.query) }, databaseUrl)).committed, true);
    const late = await cancelCoordinatorTask({ taskId: van.taskId, commandId: randomUUID() }, f.as(f.jordan));
    assert.equal(late.cancelled, false); assert.equal(late.task.status, "succeeded"); assert.equal(late.task.hasResult, true);
    assert.equal((await runsFor(f.db, f.thread)).length, 1);
  } finally { await f.cleanup(); }
});

test("steering: lease expiry and takeover; the first worker's late result is refused", { skip: !enabled }, async () => {
  const f = await fixture("takeover");
  try {
    const task = await f.start("Airport transfers", "Airport transfers for 7");
    const first = await claim();
    assert.equal(await claimResearchTask(databaseUrl, new Date()), null, "a live lease is not claimable");
    const later = new Date(Date.now() + DELIVERY_LEASE_MS + 1000);
    const second = await claim(later);
    assert.ok(second.attempt > first.attempt); assert.equal(second.revision, first.revision);
    assert.deepEqual(await finishResearchTaskDetailed(first, { result: result(first.query, "late first worker") }, databaseUrl, later), { committed: false, reason: "lease_lost" });
    assert.equal((await finishResearchTaskDetailed(second, { result: result(second.query, "takeover worker") }, databaseUrl, later)).committed, true);
    assert.equal((await runsFor(f.db, f.thread)).map(run => run.limitations[0]).join(), "takeover worker");
    // The very same lease cannot commit twice.
    assert.equal(await finishResearchTask(second, { result: result(second.query) }, databaseUrl, later), false);
    const attempts = await f.db.db.select().from(researchAttempts).where(eq(researchAttempts.taskId, task.taskId));
    assert.deepEqual(attempts.map(item => item.status).sort(), ["expired", "succeeded"]);
  } finally { await f.cleanup(); }
});

test("steering: revoked permission cannot commit or steer", { skip: !enabled }, async () => {
  const f = await fixture("revoked");
  try {
    const task = await f.start("Airport transfers", "Airport transfers for 7");
    const lease = await claim();
    await f.db.db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, f.trip), eq(memberships.personId, f.jordan)));
    const finished = await finishResearchTaskDetailed(lease, { result: result(lease.query) }, databaseUrl);
    assert.equal(finished.committed, true, "the attempt is recorded as failed, not as a result");
    assert.equal((await runsFor(f.db, f.thread)).length, 0);
    const [row] = await f.db.db.select().from(researchTasks).where(eq(researchTasks.id, task.taskId));
    assert.equal(row.status, "failed"); assert.equal(row.errorCode, "access_revoked"); assert.equal(row.result, null);
    await assert.rejects(amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Too late" }, f.as(f.jordan)));
    await assert.rejects(cancelCoordinatorTask({ taskId: task.taskId, commandId: randomUUID() }, f.as(f.jordan)));
    // Revoked before the claim: the claim itself refuses to start provider work.
    const robinTask = await f.start("Robin's research", "Robin query", f.thread, f.robin);
    await f.db.db.update(memberships).set({ status: "removed" as never }).where(and(eq(memberships.commonsId, f.trip), eq(memberships.personId, f.robin))).catch(() => undefined);
    await f.db.db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, f.trip), eq(memberships.personId, f.robin)));
    assert.equal(await claimResearchTask(databaseUrl), null);
    assert.equal((await f.db.db.select().from(researchTasks).where(eq(researchTasks.id, robinTask.taskId)))[0].errorCode, "access_revoked");
  } finally { await f.cleanup(); }
});

test("steering: a correction after completion keeps the earlier result as outdated and prepares a new one", { skip: !enabled }, async () => {
  const f = await fixture("after");
  try {
    const task = await f.start("Wine van", "Wine van for 7");
    const one = await claim();
    await finishResearchTaskDetailed(one, { result: result(one.query, "revision 1 result") }, databaseUrl);
    const before = await readCoordinatorTask(task.taskId, f.as(f.jordan));
    assert.equal(before.resultOutdated, false); const firstRun = before.currentRunId; assert.ok(firstRun);
    const amended = await amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Make it 10 seats." }, f.as(f.jordan));
    assert.equal(amended.task.status, "queued"); assert.equal(amended.task.resultOutdated, true); assert.equal(amended.task.currentRunId, null);
    assert.equal(amended.task.hasResult, true, "the earlier result is kept, labelled outdated");
    assert.equal((await runsFor(f.db, f.thread)).length, 1);
    const two = await claim();
    await finishResearchTaskDetailed(two, { result: result(two.query, "revision 2 result") }, databaseUrl);
    const after = await readCoordinatorTask(task.taskId, f.as(f.jordan));
    assert.equal(after.resultOutdated, false); assert.notEqual(after.currentRunId, firstRun);
    assert.equal((await runsFor(f.db, f.thread)).length, 2, "history keeps both; only the newer is current");
  } finally { await f.cleanup(); }
});

test("steering: needs input waits for the organizer and is not run", { skip: !enabled }, async () => {
  const f = await fixture("input");
  try {
    const task = await f.start("Airport transfers", "Airport transfers for 7");
    const amended = await amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Two travelers arrive later.", missingFact: "What time do the two later travelers land?" }, f.as(f.jordan));
    assert.equal(amended.task.status, "needs_input"); assert.equal(amended.task.needsInput, "What time do the two later travelers land?");
    assert.equal(await claimResearchTask(databaseUrl), null, "work waiting for input is never claimed");
    const resumed = await amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 2, note: "They land at 6:40 PM." }, f.as(f.jordan));
    assert.equal(resumed.task.status, "queued"); assert.equal(resumed.task.needsInput, null);
    assert.ok(await claimResearchTask(databaseUrl));
  } finally { await f.cleanup(); }
});

test("steering: provider concurrency is bounded per organizer and trip, even with racing workers", { skip: !enabled }, async () => {
  const f = await fixture("bound");
  try {
    for (let i = 0; i < 4; i++) await f.start(`Task ${i}`, `Query ${i}`);
    const leases = (await Promise.all([claimResearchTask(databaseUrl), claimResearchTask(databaseUrl), claimResearchTask(databaseUrl), claimResearchTask(databaseUrl)])).filter(Boolean) as TaskLease[];
    assert.equal(leases.length, TASK_MAX_RUNNING, "racing workers never start more than the bound");
    const queued = await listCoordinatorTasks(f.trip, f.thread, f.as(f.jordan));
    assert.equal(queued.filter(task => task.status === "running").length, TASK_MAX_RUNNING);
    assert.equal(queued.filter(task => task.status === "queued" && task.waitingForSlot).length, 2, "excess queued work is visible as waiting for a free slot");
    // Another organizer's work is not blocked by Jordan's.
    await f.start("Robin task", "Robin query", f.thread, f.robin);
    assert.ok(await claimResearchTask(databaseUrl));
    assert.equal(await claimResearchTask(databaseUrl), null);
    await finishResearchTaskDetailed(leases[0], { result: result(leases[0].query) }, databaseUrl);
    assert.ok(await claimResearchTask(databaseUrl), "a free slot lets queued work start");
  } finally { await f.cleanup(); }
});

test("steering: the worker aborts provider work for a superseded claim and its late result is still refused", { skip: !enabled }, async () => {
  const f = await fixture("worker");
  try {
    const task = await f.start("Airport transfers", "Airport transfers for 7");
    let providerAborted = false, release: () => void = () => undefined;
    const events: string[] = [];
    const running = runResearchTask((query, signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => { providerAborted = true; });
      // A provider that ignores the abort and returns anyway: the database fence is what protects the result.
      release = () => resolve(result(query, "ignored the abort"));
    }), { databaseUrl, checkpointMs: 40, timeoutMs: 20_000, onFinished: event => events.push(event.outcome) });
    await new Promise(resolveWait => setTimeout(resolveWait, 150));
    await amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Two arrive later." }, f.as(f.jordan));
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
    assert.equal(providerAborted, true, "the checkpoint stops provider work for a superseded claim");
    release();
    const outcome = await running;
    assert.equal(outcome.processed, false); assert.deepEqual(events, ["superseded"]);
    assert.equal((await runsFor(f.db, f.thread)).length, 0);
  } finally { await f.cleanup(); }
});

test("main conversation: one per trip under concurrent first access; no private history is merged", { skip: !enabled }, async () => {
  const f = await fixture("main");
  try {
    const results = await Promise.all([...Array(6)].map((_, i) => ensureMainThread(f.trip, f.as(i % 2 ? f.robin : f.jordan))));
    assert.equal(new Set(results.map(item => item.id)).size, 1);
    assert.equal((await f.db.db.select().from(coordinatorThreadLinks).where(and(eq(coordinatorThreadLinks.commonsId, f.trip), eq(coordinatorThreadLinks.kind, "main")))).length, 1);
    // The database, not the application, forbids a second main.
    const extra = randomUUID();
    await f.db.db.insert(coordinatorThreads).values({ id: extra, commonsId: f.trip, createdByPersonId: f.jordan, title: "Rogue", lastCommandId: randomUUID(), lastCommandFingerprint: "x" });
    await assert.rejects(f.db.db.insert(coordinatorThreadLinks).values({ threadId: extra, commonsId: f.trip, kind: "main" }));
    await assert.rejects(ensureMainThread(f.trip, f.as(f.outsider)));
    // The pre-existing thread was not renamed, relabelled or adopted.
    const [old] = await f.db.db.select().from(coordinatorThreads).where(eq(coordinatorThreads.id, f.thread));
    assert.equal(old.title, "Main"); assert.notEqual(old.id, results[0].id);
  } finally { await f.cleanup(); }
});

test("subthreads and linked outcomes: attributed brief, nothing moves, one outcome per revision, no restricted leakage", { skip: !enabled }, async () => {
  const f = await fixture("sub");
  try {
    const main = await ensureMainThread(f.trip, f.as(f.jordan));
    const wine = await f.start("Wine van", "Wine van for 7", main.id);
    const command = randomUUID();
    const sub = await startSubthread(f.trip, { commandId: command, title: "Wine tasting day", brief: "Plan the wine tasting day; see the van task. Budget is unknown.", parentThreadId: main.id, briefTaskIds: [wine.taskId] }, f.as(f.jordan));
    const replay = await startSubthread(f.trip, { commandId: command, title: "Wine tasting day", brief: "Plan the wine tasting day; see the van task. Budget is unknown.", parentThreadId: main.id, briefTaskIds: [wine.taskId] }, f.as(f.jordan));
    assert.equal(replay.id, sub.id); assert.equal(replay.replayed, true);
    await assert.rejects(startSubthread(f.trip, { commandId: command, title: "Different", brief: "x", parentThreadId: main.id }, f.as(f.jordan)));
    await assert.rejects(startSubthread(f.trip, { commandId: randomUUID(), title: "Bad ref", brief: "x", parentThreadId: main.id, briefTaskIds: [randomUUID()] }, f.as(f.jordan)));
    await assert.rejects(startSubthread(f.trip, { commandId: randomUUID(), title: "Outsider", brief: "x", parentThreadId: main.id }, f.as(f.outsider)));
    const [link] = await f.db.db.select().from(coordinatorThreadLinks).where(eq(coordinatorThreadLinks.threadId, sub.id));
    assert.equal(link.kind, "sub"); assert.equal(link.parentThreadId, main.id); assert.deepEqual(link.briefTaskIds, [wine.taskId]);
    // The task did not move or change authority.
    const [row] = await f.db.db.select().from(researchTasks).where(eq(researchTasks.id, wine.taskId));
    assert.equal(row.threadId, main.id); assert.equal(row.requestedByPersonId, f.jordan);

    // A task started in the subthread: its outcome reaches main once per revision and only while current.
    const sensitive = "Private note: Casey's medical van requirement";
    const task = (await startCoordinatorTask(f.request("Wine tasting rooms near Healdsburg", sub.id), { title: "Tasting rooms", brief: sensitive, contextVersion: 0 }, f.as(f.jordan))).task;
    await assert.rejects(linkTaskOutcomeToMain({ taskId: task.taskId, revision: 1 }, f.as(f.jordan)), TaskNotAmendableError); // not finished
    // The older main-thread task is claimed first; finish it, then the subthread task.
    for (let i = 0; i < 2; i++) { const lease = await claim(); await finishResearchTaskDetailed(lease, { result: result(lease.query) }, databaseUrl); }
    await assert.rejects(linkTaskOutcomeToMain({ taskId: task.taskId, revision: 1 }, f.as(f.robin)), "only the owner links an outcome");
    const linked = await linkTaskOutcomeToMain({ taskId: task.taskId, revision: 1 }, f.as(f.jordan));
    const again = await linkTaskOutcomeToMain({ taskId: task.taskId, revision: 1 }, f.as(f.jordan));
    assert.equal(linked.created, true); assert.equal(again.created, false);
    const outcomes = await listThreadOutcomes(f.trip, main.id, f.as(f.robin));
    assert.equal(outcomes.length, 1);
    assert.ok(!JSON.stringify(outcomes).includes("medical"), "the brief never leaks through the outcome");
    // A main-thread task has no parent to report to, and a correction makes the old revision unlinkable.
    await assert.rejects(linkTaskOutcomeToMain({ taskId: wine.taskId, revision: 1 }, f.as(f.jordan)), TaskNotAmendableError);
    await amendCoordinatorTask({ taskId: task.taskId, commandId: randomUUID(), expectedRevision: 1, note: "Only tasting rooms with a shuttle." }, f.as(f.jordan));
    await assert.rejects(linkTaskOutcomeToMain({ taskId: task.taskId, revision: 1 }, f.as(f.jordan)), TaskNotAmendableError);
    // Revoked organizers cannot materialize anything into main.
    await f.db.db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, f.trip), eq(memberships.personId, f.jordan)));
    await assert.rejects(linkTaskOutcomeToMain({ taskId: task.taskId, revision: 2 }, f.as(f.jordan)));
  } finally { await f.cleanup(); }
});
