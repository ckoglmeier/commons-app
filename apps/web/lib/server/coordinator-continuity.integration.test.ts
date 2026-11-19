import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { claimResearchTask, commons, coordinatorTaskEvents, coordinatorTurns, finishResearchTaskDetailed, researchTasks, stays, type TaskLease } from "@commons/database";
import { actAs, and, databaseTestsEnabled, eq, jsonRequest, params, testDatabaseUrl, withCoordinatorScenario, withTestDatabase, type ScenarioContext } from "./coordinator-route-harness";
// Goals are on by default; these cases cover the Coordinator paths without them.
process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "false";

/*
 * Acceptance scenarios for the continuous coordinator, against the real route handlers and a real database. The model is a recording fake, the search
 * provider is a fake, and "workers" claim and commit through the same repository functions the production worker uses. Fictional trip: seven travelers,
 * an airport-transfer task and a wine-van task. Nothing here reaches a real provider, and nothing sends, books or pays.
 */
const skip = !databaseTestsEnabled;
const ON = { COMMONS_COORDINATOR_STEERING_ENABLED: "true", COMMONS_DURABLE_RESEARCH_ENABLED: "true", COMMONS_COORDINATOR_TASK_RUNNER: "active" };
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type Reading = { operation: "none" | "status" | "amend" | "cancel" | "new_task"; taskId?: string | null; candidateTaskIds?: string[]; change?: string | null; missingFact?: string | null; title?: string | null };
/** Answers the follow-up reading call from a script keyed by message text; every other provider call falls through to the scenario's normal fake. */
function scriptReadings(script: (message: string, tasks: Array<{ ref: string; title: string }>) => Reading) {
  const previous = globalThis.fetch;
  const calls: Array<{ message: string; tasks: unknown }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (body?.response_format?.json_schema?.name === "commons_follow_up_reading") {
      const user = JSON.parse(body.messages.at(-1).content) as { message: string; tasks: Array<{ ref: string; title: string }> };
      calls.push({ message: user.message, tasks: user.tasks });
      const reading = script(user.message, user.tasks);
      const content = JSON.stringify({ taskId: null, candidateTaskIds: [], change: null, missingFact: null, title: null, ...reading });
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return previous(input, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
}
const refOf = (tasks: Array<{ ref: string; title: string }>, title: string) => tasks.find(task => task.title === title)?.ref ?? null;

async function withTrip(run: (ctx: ScenarioContext & {
  taskApi: (body: unknown, personId?: string) => Promise<{ status: number; body: Body }>;
  tasksOf: (threadId: string, personId?: string) => Promise<Body[]>;
  main: string; startBoth: () => Promise<{ transfer: Body; van: Body }>; say: (text: string, extra?: Record<string, unknown>, personId?: string) => Promise<{ status: number; body: Body }>;
  state: () => Promise<{ rows: Array<typeof researchTasks.$inferSelect>; stayRows: number; budget: unknown }>;
}) => Promise<void>, environment: Record<string, string> = ON) {
  await withCoordinatorScenario(async ctx => {
    const taskApi = async (body: unknown, personId = ctx.trip.organizerId) => {
      actAs(personId);
      const response = await ctx.routes.tasks.POST(jsonRequest(ctx.trip.eventId, "/tasks", "POST", body), params(ctx.trip.eventId));
      return { status: response.status, body: await response.json() as Body };
    };
    const tasksOf = async (threadId: string, personId = ctx.trip.organizerId) => {
      actAs(personId);
      const response = await ctx.routes.tasks.GET(new Request(`http://localhost/api/v1/commons/${ctx.trip.eventId}/coordinator/tasks?threadId=${threadId}`), params(ctx.trip.eventId));
      return ((await response.json()) as Body).tasks as Body[];
    };
    actAs(ctx.trip.organizerId);
    const entry = await ctx.routes.continuity.GET(new Request(`http://localhost/api/v1/commons/${ctx.trip.eventId}/coordinator/continuity`), params(ctx.trip.eventId));
    const main = environment.COMMONS_COORDINATOR_STEERING_ENABLED === "true" ? ((await entry.json()) as Body).mainThreadId as string : randomUUID();
    const turnVersions = new Map<string, number>();
    const say = async (text: string, extra: Record<string, unknown> = {}, personId = ctx.trip.organizerId) => {
      const version = (await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, main)))).length;
      turnVersions.set(main, version);
      return ctx.post({ commandId: randomUUID(), target: { kind: "existing", threadId: main, expectedTurnVersion: version }, inputMode: "text", text, ...extra }, personId);
    };
    const start = async (title: string, query: string, brief: string) => {
      const started = await taskApi({ op: "start", commandId: randomUUID(), threadId: main, title, brief, query });
      assert.equal(started.status, 202, JSON.stringify(started.body));
      return started.body.task as Body;
    };
    const startBoth = async () => ({
      transfer: await start("Airport transfers", "airport transfer options Sonoma", "Airport transfers for seven travelers."),
      van: await start("Wine van", "wine tasting van Healdsburg", "Wine-tasting van for seven travelers."),
    });
    const state = () => withTestDatabase(async db => ({
      rows: await db.select().from(researchTasks).where(eq(researchTasks.commonsId, ctx.trip.eventId)),
      stayRows: (await db.select().from(stays).where(eq(stays.commonsId, ctx.trip.eventId))).length,
      budget: (await db.select().from(commons).where(eq(commons.id, ctx.trip.eventId)))[0].targetBudgetCents,
    }));
    await run({ ...ctx, taskApi, tasksOf, main, startBoth, say, state });
  }, { environment });
}
const claimFor = async (title: string, tasks: Array<{ taskId: string; title: string }>) => {
  const wanted = tasks.find(task => task.title === title)!.taskId;
  const held: TaskLease[] = [];
  for (let i = 0; i < 4; i++) {
    const lease = await claimResearchTask(testDatabaseUrl());
    if (!lease) break;
    if (lease.taskId === wanted) { for (const other of held) await withTestDatabase(db => db.update(researchTasks).set({ status: "pending", leaseExpiresAt: null }).where(eq(researchTasks.id, other.taskId))); return lease; }
    held.push(lease);
  }
  throw new Error(`could not claim ${title}`);
};
const fixtureResult = (query: string, note: string) => ({ query, status: "partial" as const, sources: [], limitations: [note] });

test("main conversation: concurrent first access gives one conversation to both organizers", { skip }, () => withTrip(async ({ trip, routes, main }) => {
  const read = async (personId: string) => { actAs(personId); const response = await routes.continuity.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/continuity`), params(trip.eventId)); return ((await response.json()) as Body).mainThreadId as string; };
  const ids = await Promise.all([read(trip.organizerId), read(trip.coOrganizerId), read(trip.organizerId), read(trip.coOrganizerId)]);
  assert.deepEqual([...new Set(ids)], [main]);
  actAs(trip.travelerId);
  const traveler = await routes.continuity.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/continuity`), params(trip.eventId));
  assert.notEqual(traveler.status, 200, "a traveler never reaches the organizer conversation");
}));

test("status, correction, and the ambiguous question: only the intended task changes, and nothing in the trip changes", { skip }, () => withTrip(async ({ trip, tasksOf, startBoth, say, state, taskApi, main, post, infoLogs }) => {
  const { transfer, van } = await startBoth();
  const before = await state();
  const script = scriptReadings((message, tasks) => {
    if (/how are/i.test(message)) return { operation: "status" };
    if (/arrive later/i.test(message)) return { operation: "amend", taskId: refOf(tasks, "Airport transfers"), change: "Two travelers arrive later than the rest.", missingFact: "What time do the two later travelers land?" };
    if (/cheaper/i.test(message)) return { operation: "amend", taskId: null, candidateTaskIds: tasks.map(task => task.ref), change: "Make it cheaper." };
    return { operation: "none" };
  });
  try {
    // A transfer attempt is running on a slow worker while the organizer keeps talking.
    const lease = await claimFor("Airport transfers", [transfer as never, van as never]);
    const started = Date.now();
    const status = await say("How are the two tasks going?");
    const statusMs = Date.now() - started;
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.capability, "steer_task");
    assert.match(status.body.durableAnswer, /“Airport transfers”: working/);
    assert.match(status.body.durableAnswer, /“Wine van”: queued/);
    assert.ok(statusMs < 1500, `status answered in ${statusMs}ms without waiting for the running task`);
    assert.equal((await say("Did that work?", {}, trip.organizerId)).status, 200);

    // A correction: the transfer brief changes, the van brief does not, and the unknown arrival time stays unknown.
    const correction = await say("Two people arrive later.");
    assert.match(correction.body.durableAnswer, /Updated “Airport transfers” to revision 2/);
    assert.match(correction.body.durableAnswer, /I need one thing to continue: What time do the two later travelers land\?/);
    assert.match(correction.body.durableAnswer, /I stopped the earlier attempt/);
    const [t, v] = [(await tasksOf(main)).find(task => task.title === "Airport transfers")!, (await tasksOf(main)).find(task => task.title === "Wine van")!];
    assert.equal(t.revision, 2); assert.equal(t.status, "needs_input"); assert.equal(v.revision, 1);
    assert.doesNotMatch(t.brief, /\d{1,2}:\d{2}|PM|AM/, "no arrival time was invented");
    assert.equal(v.brief, "Wine-tasting van for seven travelers.");

    // The old attempt finishes after the correction: it cannot become current, and no run or proposal appears.
    assert.deepEqual(await finishResearchTaskDetailed(lease, { result: fixtureResult(lease.query, "stale") }, testDatabaseUrl()), { committed: false, reason: "superseded" });
    const afterStale = await withTestDatabase(async db => ({ turns: await db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, main)) }));
    assert.ok(afterStale.turns.every(turn => !turn.workspace?.tripProposal && !turn.workspace?.proposal), "no actionable proposal from stale work");
    assert.equal((await tasksOf(main)).find(task => task.title === "Airport transfers")!.hasResult, false);

    // "Make it cheaper" with both tasks active asks which task. Nothing is revised silently.
    const cheaper = await say("Make it cheaper");
    assert.match(cheaper.body.durableAnswer, /Which task do you mean: “Airport transfers” or “Wine van”\? I haven’t changed any of them\./);
    const clarifyTurn = await withTestDatabase(db => db.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commandId, (cheaper.body.commandId as string)))));
    const steering = clarifyTurn[0].workspace?.steering as Body;
    assert.equal(steering.kind, "clarify"); assert.equal(steering.message, "Make it cheaper"); assert.equal(steering.candidates.length, 2);
    const unchanged = await tasksOf(main);
    assert.deepEqual(unchanged.map(task => task.revision).sort(), [1, 2]);

    // Choosing the task in the UI applies the preserved message to that task only.
    const chosen = steering.candidates.find((candidate: Body) => candidate.title === "Wine van");
    const choice = await say("Make it cheaper", { explicitAction: { kind: "task_control", op: "amend", taskId: chosen.taskId, expectedRevision: chosen.revision } });
    assert.match(choice.body.durableAnswer, /Updated “Wine van” to revision 2: Make it cheaper/);
    assert.deepEqual((await tasksOf(main)).map(task => `${task.title}:${task.revision}`).sort(), ["Airport transfers:2", "Wine van:2"]);

    // Saved trip records never changed, and no provider call carried a private brief.
    const after = await state();
    assert.equal(after.stayRows, before.stayRows); assert.equal(after.budget, before.budget);
    // Telemetry carries fixed fields only.
    const steeringLogs = infoLogs.filter(log => log.name === "commons.coordinator.steering" || log.name === "commons.coordinator.task_op");
    assert.ok(steeringLogs.length >= 3);
    const logged = JSON.stringify(steeringLogs);
    for (const secret of ["arrive later", "Airport transfers", "Wine van", "cheaper", "Synthetic"]) assert.ok(!logged.includes(secret), `telemetry must not contain ${secret}`);
    void post; void taskApi; void trip;
  } finally { script.restore(); }
}));

test("only the initiating organizer can change or cancel; another organizer gets a plain refusal and can still read", { skip }, () => withTrip(async ({ trip, tasksOf, startBoth, say, main }) => {
  await startBoth();
  const script = scriptReadings((message, tasks) => /cancel/i.test(message) ? { operation: "cancel", taskId: refOf(tasks, "Wine van") } : { operation: "none" });
  try {
    const refused = await say("Cancel the wine van", {}, trip.coOrganizerId);
    assert.match(refused.body.durableAnswer, /“Wine van” was started by Casey Synthetic\. Only they can change or cancel it\. I haven’t changed anything\./);
    const seen = await tasksOf(main, trip.coOrganizerId);
    assert.equal(seen.length, 2); assert.ok(seen.every(task => task.ownedByMe === false && task.status !== "cancelled"));
    // The initiating organizer can.
    const ok = await say("Cancel the wine van");
    assert.match(ok.body.durableAnswer, /Cancelled “Wine van”/);
    assert.equal((await tasksOf(main)).find(task => task.title === "Wine van")!.status, "cancelled");
  } finally { script.restore(); }
}));

test("cancel during inference and after completion report the real outcome; a late result never commits", { skip }, () => withTrip(async ({ tasksOf, startBoth, say, main }) => {
  const { transfer, van } = await startBoth();
  const script = scriptReadings((message, tasks) => /cancel the transfers/i.test(message) ? { operation: "cancel", taskId: refOf(tasks, "Airport transfers") } : /cancel the van/i.test(message) ? { operation: "cancel", taskId: refOf(tasks, "Wine van") } : { operation: "none" });
  try {
    const leaseT = await claimFor("Airport transfers", [transfer as never, van as never]);
    const cancelled = await say("Cancel the transfers");
    assert.match(cancelled.body.durableAnswer, /Cancelled “Airport transfers”\. Work in progress is discarded/);
    assert.deepEqual(await finishResearchTaskDetailed(leaseT, { result: fixtureResult(leaseT.query, "late") }, testDatabaseUrl()), { committed: false, reason: "cancelled" });
    // The van finishes first; cancelling afterwards says so and keeps the result.
    const leaseV = await claimFor("Wine van", [transfer as never, van as never].filter(task => (task as Body).status !== "cancelled"));
    assert.equal((await finishResearchTaskDetailed(leaseV, { result: fixtureResult(leaseV.query, "van result") }, testDatabaseUrl())).committed, true);
    const late = await say("Cancel the van");
    assert.match(late.body.durableAnswer, /had already finished, so nothing was cancelled\. Its result is saved\./);
    assert.equal((await tasksOf(main)).find(task => task.title === "Wine van")!.hasResult, true);
  } finally { script.restore(); }
}));

test("a correction after completion prepares new work, marks the earlier result outdated, and never touches approved trip facts", { skip }, () => withTrip(async ({ startBoth, say, tasksOf, main, state }) => {
  const { transfer, van } = await startBoth();
  const lease = await claimFor("Wine van", [transfer as never, van as never]);
  await finishResearchTaskDetailed(lease, { result: fixtureResult(lease.query, "van result") }, testDatabaseUrl());
  const before = await state();
  const script = scriptReadings((message, tasks) => /ten seats/i.test(message) ? { operation: "amend", taskId: refOf(tasks, "Wine van"), change: "Needs ten seats." } : { operation: "none" });
  try {
    const turn = await say("Actually the van needs ten seats");
    assert.match(turn.body.durableAnswer, /Updated “Wine van” to revision 2: Needs ten seats\. The earlier result is out of date, and a new one is being prepared\./);
    const task = (await tasksOf(main)).find(item => item.title === "Wine van")!;
    assert.equal(task.resultOutdated, true); assert.equal(task.hasResult, true); assert.equal(task.currentRunId, null); assert.equal(task.status, "queued");
    const after = await state();
    assert.equal(after.stayRows, before.stayRows); assert.equal(after.budget, before.budget);
  } finally { script.restore(); }
}));

test("duplicate commands, reload and two tabs produce one operation per idempotency key", { skip }, () => withTrip(async ({ trip, tasksOf, startBoth, taskApi, say, main, post }) => {
  const { transfer } = await startBoth();
  const amend = { op: "amend", commandId: randomUUID(), threadId: main, taskId: transfer.taskId, expectedRevision: 1, note: "Add a child seat." };
  const [a, b] = await Promise.all([taskApi(amend), taskApi(amend)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((await tasksOf(main)).find(task => task.taskId === transfer.taskId)!.revision, 2, "two tabs, one revision");
  assert.equal([a.body.replayed, b.body.replayed].filter(Boolean).length, 1);
  // A stale tab is refused with the current revision, and nothing changes.
  const stale = await taskApi({ ...amend, commandId: randomUUID(), note: "Late tab" });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "stale_revision"); assert.equal(stale.body.currentRevision, 2);
  // A turn command replayed after a reload does not repeat the correction.
  const script = scriptReadings((message, tasks) => /wheelchair/i.test(message) ? { operation: "amend", taskId: refOf(tasks, "Airport transfers"), change: "One wheelchair-accessible vehicle." } : { operation: "none" });
  try {
    const version = (await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, main)))).length;
    const command = { commandId: randomUUID(), target: { kind: "existing", threadId: main, expectedTurnVersion: version }, inputMode: "text", text: "We need a wheelchair-accessible vehicle." };
    const first = await post(command), replay = await post(command);
    assert.equal(first.body.status, "completed"); assert.equal(replay.body.turnId, first.body.turnId);
    assert.equal((await tasksOf(main)).find(task => task.taskId === transfer.taskId)!.revision, 3);
    const events = await withTestDatabase(db => db.select().from(coordinatorTaskEvents).where(eq(coordinatorTaskEvents.taskId, transfer.taskId as string)));
    assert.equal(events.filter(event => event.kind === "amended").length, 2);
    void trip; void say;
  } finally { script.restore(); }
}));

test("voice: a finalized utterance steers through the same turn path and keeps its task identity", { skip }, () => withTrip(async ({ startBoth, tasksOf, main, post }) => {
  const { transfer } = await startBoth();
  const script = scriptReadings((message, tasks) => /later/i.test(message) ? { operation: "amend", taskId: refOf(tasks, "Airport transfers"), change: "Two travelers arrive later.", missingFact: "What time do they land?" } : { operation: "none" });
  try {
    const version = (await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, main)))).length;
    const spoken = await post({ commandId: randomUUID(), target: { kind: "existing", threadId: main, expectedTurnVersion: version }, inputMode: "voice", text: "Two of them are arriving later.", voice: { sessionId: "live-session-1", delegationId: "delegation-1" } });
    assert.equal(spoken.status, 200, JSON.stringify(spoken.body));
    assert.equal(spoken.body.capability, "steer_task");
    assert.ok(spoken.body.spokenReply.length <= 600);
    assert.equal((await tasksOf(main)).find(task => task.taskId === transfer.taskId)!.revision, 2);
    assert.equal((await tasksOf(main)).find(task => task.taskId === transfer.taskId)!.threadId, main);
  } finally { script.restore(); }
}));

test("a subthread's attributed brief reaches the model for that subthread only", { skip }, () => withTrip(async ({ trip, routes, main, post, say, network }) => {
  actAs(trip.organizerId);
  const created = await routes.continuity.POST(jsonRequest(trip.eventId, "/continuity", "POST", { commandId: randomUUID(), parentThreadId: main, title: "Wine tasting day", brief: "Plan the wine tasting day for the group of seven. Budget is not decided." }), params(trip.eventId));
  assert.equal(created.status, 201);
  const { id: subthread } = (await created.json()) as { id: string };
  const providerText = (from: number) => JSON.stringify(network.providerCalls.slice(from).map(call => call.body));
  const before = network.providerCalls.length;
  const inSub = await post({ commandId: randomUUID(), target: { kind: "existing", threadId: subthread, expectedTurnVersion: 0 }, inputMode: "text", text: "What should we think about for the day?" });
  assert.equal(inSub.status, 200, JSON.stringify(inSub.body));
  assert.match(providerText(before), /subthreadBrief/);
  assert.match(providerText(before), /Plan the wine tasting day for the group of seven\. Budget is not decided\./);
  assert.match(providerText(before), /Casey Synthetic/, "the brief is attributed to the organizer who wrote it");
  // The main conversation and a plain thread never receive it.
  const mark = network.providerCalls.length;
  assert.equal((await say("What should we think about for the trip?")).status, 200);
  assert.doesNotMatch(providerText(mark), /subthreadBrief|Budget is not decided/);
}));

test("voice: multi-turn steering answers a spoken question, and only an explicit cancellation changes durable state", { skip }, () => withTrip(async ({ startBoth, tasksOf, main, post }) => {
  const { transfer } = await startBoth();
  const script = scriptReadings((message, tasks) => /cheaper/i.test(message) ? { operation: "amend", taskId: null, candidateTaskIds: tasks.map(task => task.ref), change: "Keep the cost down." }
    : /stop|cancel/i.test(message) ? { operation: "cancel", taskId: refOf(tasks, "Airport transfers") } : { operation: "none" });
  const speak = async (text: string, id: string) => {
    const version = (await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, main)))).length;
    return post({ commandId: randomUUID(), target: { kind: "existing", threadId: main, expectedTurnVersion: version }, inputMode: "voice", text, voice: { sessionId: "live-session-2", delegationId: id } });
  };
  try {
    const question = await speak("Can we make it cheaper?", "d1");
    assert.match(question.body.durableAnswer, /Which task do you mean/);
    assert.ok(question.body.spokenReply.length <= 600);
    // Nothing is a spoken answer yet, so nothing changed.
    assert.equal((await tasksOf(main)).find(task => task.taskId === transfer.taskId)!.revision, 1);
    // The organizer says which one. The original words are applied to that task only, with no second model reading.
    const readingsBefore = script.calls.length;
    const answered = await speak("The airport transfers one", "d2");
    assert.match(answered.body.durableAnswer, /Updated “Airport transfers” to revision 2: Can we make it cheaper\?/);
    assert.equal(script.calls.length, readingsBefore, "naming the task needs no model call");
    const tasks = await tasksOf(main);
    assert.deepEqual(tasks.map(task => `${task.title}:${task.revision}:${task.status}`).sort(), ["Airport transfers:2:queued", "Wine van:1:queued"]);
    // A phrase that merely sounds like stopping, spoken to the model as ordinary speech, is not a cancellation unless the reading is an explicit cancel of one task.
    const unrelated = await speak("Hmm, let me think about that", "d3");
    assert.notEqual(unrelated.body.capability, "steer_task");
    assert.ok((await tasksOf(main)).every(task => task.status !== "cancelled"));
    const explicit = await speak("Cancel the airport transfers task", "d4");
    assert.match(explicit.body.durableAnswer, /Cancelled “Airport transfers”/);
    assert.equal((await tasksOf(main)).find(task => task.title === "Wine van")!.status, "queued");
  } finally { script.restore(); }
}));

test("turning the flag off keeps merged behavior but never strands accepted tasks", { skip }, () => withTrip(async ({ trip, startBoth, taskApi, tasksOf, post, network, main, routes }) => {
  const { transfer, van } = await startBoth();
  const lease = await claimFor("Airport transfers", [transfer as never, van as never]);
  // Rollback: the flag goes off while two tasks are already accepted and one is running.
  process.env.COMMONS_COORDINATOR_STEERING_ENABLED = "false";
  const calls = network.providerCalls.length;
  const version = (await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, main)))).length;
  const reply = await post({ commandId: randomUUID(), target: { kind: "existing", threadId: main, expectedTurnVersion: version }, inputMode: "text", text: "Cancel the wine van" });
  assert.equal(reply.status, 200);
  assert.notEqual(reply.body.capability, "steer_task", "no steering with the flag off");
  assert.ok(network.providerCalls.slice(calls).every(call => (call as { body: { response_format?: { json_schema?: { name?: string } } } }).body.response_format?.json_schema?.name !== "commons_follow_up_reading"), "no reading call with the flag off");
  // New steering operations are closed, and the status route is quiet...
  assert.equal((await taskApi({ op: "start", commandId: randomUUID(), threadId: main, title: "X", brief: "", query: "wine van" })).status, 404);
  assert.equal((await taskApi({ op: "amend", commandId: randomUUID(), threadId: main, taskId: transfer.taskId, expectedRevision: 1, note: "Late change" })).status, 404);
  assert.deepEqual(await tasksOf(main), []);
  actAs(trip.organizerId);
  assert.equal((await routes.continuity.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/continuity`), params(trip.eventId))).status, 404);
  // ...but the accepted work still reconciles safely: the running attempt commits through the same fence, and cancelling still works.
  assert.deepEqual(await finishResearchTaskDetailed(lease, { result: fixtureResult(lease.query, "finished after rollback") }, testDatabaseUrl()), { committed: true, revision: 1 });
  const cancelled = await taskApi({ op: "cancel", commandId: randomUUID(), threadId: main, taskId: van.taskId });
  assert.equal(cancelled.status, 200); assert.equal(cancelled.body.task.status, "cancelled");
  const rows = await withTestDatabase(db => db.select().from(researchTasks).where(eq(researchTasks.commonsId, trip.eventId)));
  assert.deepEqual(rows.map(row => row.status).sort(), ["cancelled", "succeeded"]);
}));

test("no runner or provider: an honest refusal and the normal conversation path, never a promise", { skip }, () => withTrip(async ({ taskApi, main, post, trip }) => {
  const refused = await taskApi({ op: "start", commandId: randomUUID(), threadId: main, title: "Airport transfers", brief: "", query: "airport transfer options Sonoma" });
  assert.equal(refused.status, 503); assert.equal(refused.body.code, "tasks_unavailable");
  assert.match(refused.body.error, /aren’t running here yet, so nothing was started/);
  assert.ok(!/continues after you leave|keep working after|you can leave/i.test(JSON.stringify(refused.body)));
  const rows = await withTestDatabase(db => db.select().from(researchTasks).where(eq(researchTasks.commonsId, trip.eventId)));
  assert.equal(rows.length, 0, "nothing queued without a runner");
  // A research request still gets the existing inline answer.
  const version = (await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, main)))).length;
  const answered = await post({ commandId: randomUUID(), target: { kind: "existing", threadId: main, expectedTurnVersion: version }, inputMode: "text", text: "Look up family-friendly restaurants" });
  assert.equal(answered.status, 200); assert.notEqual(answered.body.capability, "steer_task");
}, { COMMONS_COORDINATOR_STEERING_ENABLED: "true", COMMONS_DURABLE_RESEARCH_ENABLED: "true" }));
