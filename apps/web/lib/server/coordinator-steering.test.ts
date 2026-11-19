import "../test-support/stub-server-only";
import "../test-support/stub-pilot-goal-access";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RoutedIntent, TripContextSnapshot, TurnCommand } from "@commons/contracts";
import { TaskNotAmendableError, TaskRevisionConflictError, type TaskView } from "@commons/database";
import { namedCandidate, statusText, steerTurn, readFollowUp, type SteerDependencies } from "./coordinator-steering";
import { InferenceTrace } from "./inference-tracing";

// Goals now default on; these cases cover the steering path without them unless a test turns them on.
const ON = { COMMONS_COORDINATOR_GOALS_ENABLED: "false", COMMONS_COORDINATOR_STEERING_ENABLED: "true", COMMONS_DURABLE_RESEARCH_ENABLED: "true", COMMONS_COORDINATOR_TASK_RUNNER: "active", TAVILY_API_KEY: "k" };
const view = (title: string, over: Partial<TaskView> = {}): TaskView => ({ taskId: randomUUID(), threadId: THREAD, title, brief: `${title} brief`, query: `${title} query`, revision: 1, status: "queued", errorCode: null, waitingForSlot: false, needsInput: null,
  resultOutdated: false, hasResult: false, resultRevision: null, currentRunId: null, runIds: [], requestedByPersonId: "me", requestedByName: "Robin (synthetic)", ownedByMe: true, acceptedAt: new Date(Date.now() - 60_000).toISOString(), updatedAt: new Date().toISOString(), lastChange: null, steered: true, ...over });
const THREAD = randomUUID();
const command = (text: string, explicitAction?: TurnCommand["explicitAction"]): TurnCommand => ({ commandId: randomUUID(), target: { kind: "existing", threadId: THREAD, expectedTurnVersion: 0 }, inputMode: "text", text, ...(explicitAction ? { explicitAction } : {}) }) as TurnCommand;
const answer: RoutedIntent = { capability: "answer" };
const snapshot = { trip: { value: { destination: "Sonoma, California" } }, travelers: [], stays: [] } as unknown as TripContextSnapshot;
const input = (text: string, over: Partial<Parameters<typeof steerTurn>[0]> = {}) => ({ slug: "trip", command: command(text), threadId: THREAD, intent: answer, snapshot, inputMode: "text" as const, ...over });
function deps(tasks: TaskView[], extra: Partial<SteerDependencies> = {}): SteerDependencies & { calls: string[] } {
  const calls: string[] = [];
  return { calls, environment: ON, api: {
    list: async () => tasks,
    amend: async (_slug, request) => { calls.push(`amend:${request.taskId}:${request.expectedRevision}`); const task = tasks.find(item => item.taskId === request.taskId)!; return { task: { ...task, revision: task.revision + 1, status: request.missingFact ? "needs_input" : "queued", needsInput: request.missingFact ?? null }, replayed: false, supersededRunning: task.status === "running" }; },
    cancel: async (_slug, request) => { calls.push(`cancel:${request.taskId}`); const task = tasks.find(item => item.taskId === request.taskId)!; return { task: { ...task, status: "cancelled" }, replayed: false, cancelled: true }; },
    start: async () => { throw new Error("not used"); },
    tripContext: async () => snapshot,
  }, ...extra };
}
const reading = (r: Record<string, unknown>) => ({ read: async () => ({ reading: { operation: "none", taskId: null, candidateTaskIds: [], change: null, missingFact: null, title: null, ...r } as never, model: "mini", ms: 5 }) });

test('steering extraction is observed, including invalid readings and transport fallback, without leaking task text', async () => {
  for (const mode of ['valid', 'invalid', 'transport'] as const) {
    const trace = new InferenceTrace({ tripId: randomUUID(), actorId: randomUUID(), commandId: randomUUID(), threadId: THREAD, attempt: 1 }, { synthetic: true });
    const result = await trace.run(() => readFollowUp({ text: 'PRIVATE_PERSON asks for status', tasks: [{ ref: 'T1', task: view('PRIVATE_TASK') }],
      environment: { OPENAI_API_KEY: 'synthetic-key' }, fetcher: async () => {
        if (mode === 'transport') throw new Error('PRIVATE_TRANSPORT');
        return Response.json({ usage: { prompt_tokens: 100, completion_tokens: 20 }, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(mode === 'valid'
          ? { operation: 'status', taskId: 'T1', candidateTaskIds: [], change: null, missingFact: null, title: null }
          : { operation: 'PRIVATE_INVALID' }) } }] });
      } }));
    assert.equal(Boolean(result), mode === 'valid');
    trace.finish('completed'); // A classifier failure still permits the ordinary conversation fallback.
    const events = trace.snapshot(), generation = events.find(event => event.event === '$ai_generation')!;
    assert.equal(events.at(-1)!.properties.generation_count, 1);
    assert.equal(generation.properties.$ai_is_error, mode !== 'valid');
    assert.equal(generation.properties.usage_coverage, mode === 'transport' ? 'unknown' : 'reported');
    assert.ok(!JSON.stringify(events).includes('PRIVATE'));
    if (mode === 'invalid') assert.equal(events.find(event => event.properties.$ai_span_name === 'coordinator.validation')!.properties.span_status, 'failed');
  }
});

test("flag off or no live task: nothing is read and the normal conversation path runs", async () => {
  const d = deps([view("Airport transfers")], { read: async () => { throw new Error("must not be called"); } });
  assert.equal(await steerTurn(input("Two arrive later"), { ...d, environment: { ...ON, COMMONS_COORDINATOR_STEERING_ENABLED: "false" } }), null);
  assert.equal(await steerTurn(input("Two arrive later"), deps([view("Airport transfers", { status: "cancelled" }), view("Old", { status: "failed" })], { read: async () => { throw new Error("must not be called"); } })), null);
  assert.equal(await steerTurn(input("Two arrive later"), deps([], { read: async () => { throw new Error("must not be called"); } })), null);
});

test("a message another capability already claimed is never read against the tasks", async () => {
  const d = deps([view("Airport transfers")], { read: async () => { throw new Error("must not be called"); } });
  for (const intent of [{ capability: "record_attendance" }, { capability: "navigate_thread", action: "open", targetThreadId: null, candidateThreadIds: [], title: null }, { capability: "unsupported", reason: "booking" }, { capability: "answer", limitNotice: "booking" }, { capability: "answer", offer: "poll" }] as RoutedIntent[])
    assert.equal(await steerTurn(input("Book it", { intent }), d), null);
});

test("an amendment with one valid owned target changes that task only and states the unknown", async () => {
  const [transfer, van] = [view("Airport transfers", { status: "running" }), view("Wine van")];
  const d = deps([transfer, van], reading({ operation: "amend", taskId: "T1", change: "Two travelers arrive later.", missingFact: "What time do they land?" }));
  const outcome = await steerTurn(input("two people arrive later"), d);
  assert.deepEqual(d.calls, [`amend:${transfer.taskId}:1`]);
  assert.match(outcome!.assistantText, /Updated “Airport transfers” to revision 2: Two travelers arrive later\. I stopped the earlier attempt, so its result won’t be used\. I need one thing to continue: What time do they land\?/);
  assert.equal(outcome!.steering.kind, "amended");
});

test("a reference the model invents, or another organizer's task, is never applied", async () => {
  const mine = view("Airport transfers"), theirs = view("Wine van", { ownedByMe: false, requestedByName: "Robin (synthetic)" });
  const invented = deps([mine, theirs], reading({ operation: "cancel", taskId: "T9" }));
  assert.equal(await steerTurn(input("cancel it"), invented), null, "an unknown ref is ordinary conversation, never a guess");
  assert.deepEqual(invented.calls, []);
  const notMine = deps([mine, theirs], reading({ operation: "cancel", taskId: "T2" }));
  const refusal = await steerTurn(input("cancel the van"), notMine);
  assert.match(refusal!.assistantText, /“Wine van” was started by Robin \(synthetic\)\. Only they can change or cancel it\. I haven’t changed anything\./);
  assert.deepEqual(notMine.calls, []);
});

test("two plausible tasks ask one focused question with selectable tasks and keep the message", async () => {
  const d = deps([view("Airport transfers"), view("Wine van")], reading({ operation: "amend", taskId: null, candidateTaskIds: ["T1", "T2"], change: "cheaper" }));
  const outcome = await steerTurn(input("make it cheaper"), d);
  assert.deepEqual(d.calls, []);
  assert.equal(outcome!.steering.kind, "clarify");
  if (outcome!.steering.kind === "clarify") { assert.equal(outcome!.steering.message, "make it cheaper"); assert.equal(outcome!.steering.candidates.length, 2); }
  assert.match(outcome!.assistantText, /Which task do you mean: “Airport transfers” or “Wine van”\? I haven’t changed any of them\./);
  // A reading with no clear target and a single task of yours is not guessed either.
  assert.equal(await steerTurn(input("make it cheaper"), deps([view("Airport transfers")], reading({ operation: "amend", taskId: null }))), null);
});

test("stale revisions and finished tasks are reported as what happened, not as success", async () => {
  const task = view("Airport transfers");
  const stale = deps([task], { ...reading({ operation: "amend", taskId: "T1", change: "x" }) });
  stale.api!.amend = async () => { throw new TaskRevisionConflictError(3); };
  assert.match((await steerTurn(input("change it"), stale))!.assistantText, /changed to revision 3 before your message arrived, so I didn’t apply it/);
  const gone = deps([task], { ...reading({ operation: "amend", taskId: "T1", change: "x" }) });
  gone.api!.amend = async () => { throw new TaskNotAmendableError("cancelled"); };
  assert.match((await steerTurn(input("change it"), gone))!.assistantText, /is no longer running, so I didn’t change it\. Nothing changed\./);
  const finished = deps([view("Wine van", { status: "succeeded" })], reading({ operation: "cancel", taskId: "T1" }));
  finished.api!.cancel = async (_slug, request) => ({ task: { ...finished.api!.list ? (await finished.api!.list("trip", THREAD))[0] : task, taskId: request.taskId }, replayed: false, cancelled: false });
  assert.match((await steerTurn(input("cancel the van"), finished))!.assistantText, /had already finished, so nothing was cancelled\. Its result is saved\./);
});

test("an explicit choice of task bypasses any model and is checked for ownership and revision", async () => {
  const [transfer, van] = [view("Airport transfers", { revision: 2 }), view("Wine van", { ownedByMe: false, requestedByName: "Robin (synthetic)" })];
  const d = deps([transfer, van], { read: async () => { throw new Error("explicit choices need no model"); } });
  const ok = await steerTurn(input("Make it cheaper", { command: command("Make it cheaper", { kind: "task_control", op: "amend", taskId: transfer.taskId, expectedRevision: 2 }) }), d);
  assert.match(ok!.assistantText, /Updated “Airport transfers” to revision 3: Make it cheaper/);
  const stale = await steerTurn(input("Make it cheaper", { command: command("Make it cheaper", { kind: "task_control", op: "amend", taskId: transfer.taskId, expectedRevision: 1 }) }), d);
  assert.match(stale!.assistantText, /changed to revision 2 before your choice arrived/);
  const notMine = await steerTurn(input("Cancel", { command: command("Cancel", { kind: "task_control", op: "cancel", taskId: van.taskId, expectedRevision: 1 }) }), d);
  assert.match(notMine!.assistantText, /started by Robin \(synthetic\)\. Only they can change or cancel it/);
  assert.equal(d.calls.length, 1, "only the valid choice reached the database");
});

test("a spoken or typed answer that names one offered task applies the original message, with no model call", async () => {
  const [transfer, van] = [view("Airport transfers"), view("Wine van")];
  const pending = { kind: "clarify" as const, operation: "amend" as const, message: "Make it cheaper", candidates: [{ taskId: transfer.taskId, title: "Airport transfers", revision: 1 }, { taskId: van.taskId, title: "Wine van", revision: 1 }] };
  const d = deps([transfer, van], { read: async () => { throw new Error("naming a task needs no model"); } });
  const outcome = await steerTurn(input("The airport transfers one", { pendingClarification: pending }), d);
  assert.match(outcome!.assistantText, /Updated “Airport transfers” to revision 2: Make it cheaper/);
  assert.deepEqual(d.calls, [`amend:${transfer.taskId}:1`]);
  assert.equal(namedCandidate("both of them", pending.candidates), null);
  assert.equal(namedCandidate("the van", pending.candidates)?.title, "Wine van");
  assert.equal(namedCandidate("transfers and the van", pending.candidates), null, "naming two is not an answer");
});

test("status is written from stored state, including waiting for input and outdated results", () => {
  const text = statusText([view("Airport transfers", { status: "needs_input", needsInput: "What time do they land?", revision: 2 }), view("Wine van", { status: "queued", waitingForSlot: true }), view("Tasting rooms", { status: "succeeded", resultOutdated: true, revision: 3 })]);
  assert.match(text, /“Airport transfers”: waiting for you: What time do they land\?, revision 2/);
  assert.match(text, /“Wine van”: waiting for a free slot \(2 tasks run at a time\)/);
  assert.match(text, /“Tasting rooms”: has an earlier result that is out of date, revision 3/);
  assert.equal(statusText([]), "There are no tasks running in this conversation.");
});


test("live-eval regression: a hedged cancellation never mutates despite a wrong reading", async () => {
  const task = view("Wine van");
  for (const text of ["I might cancel the wine outing later.", "Do not cancel the wine van", "Maybe stop the wine van search", "Maybe we should stop the airport search tomorrow."]) {
    const d = deps([task], reading({ operation: "cancel", taskId: "T1" }));
    assert.equal(await steerTurn(input(text), d), null);
    assert.deepEqual(d.calls, []);
  }
});
test("live-eval regression: a generic correction cannot select the first task", async () => {
  const d = deps([view("Airport transfers"), view("Wine van")], reading({ operation: "amend", taskId: "T1", change: "Cheaper transfers" }));
  const outcome = await steerTurn(input("Make it cheaper."), d);
  assert.equal(outcome?.steering.kind, "clarify");
  assert.deepEqual(d.calls, []);
});

test("goal mode pins an unqualified correction to the selected task but main ambiguity still asks",async()=>{
  const task=view("Airport transfers"),d=deps([task],reading({operation:"amend",taskId:null}));d.environment={...ON,COMMONS_COORDINATOR_GOALS_ENABLED:"true"};
  assert.equal((await steerTurn(input("make it cheaper"),d))?.steering.kind,"amended");
  const main=deps([task],reading({operation:"amend",taskId:null}));main.environment=d.environment;
  assert.equal(await steerTurn(input("make it cheaper",{threadId:randomUUID()}),main),null);
});
test("goal mode starts a research Goal only when a worker can run; otherwise the immediate search answers",async()=>{
  const research={capability:"research" as const,query:"Airport transfer options",querySource:"organizer_typed" as const};
  // No runner declared: nothing is saved, so the ordinary turn searches right away.
  const off=deps([],reading({operation:"none"}));off.environment={...ON,COMMONS_COORDINATOR_GOALS_ENABLED:"true",COMMONS_COORDINATOR_TASK_RUNNER:"none"};
  off.researchWorkerHealthy=async()=>true;
  assert.equal(await steerTurn(input("Research airport transfer options",{intent:research}),off),null);
  assert.deepEqual(off.calls,[]);
  // A runner is declared but no worker has checked in: still the immediate search.
  const stale=deps([],reading({operation:"none"}));stale.environment={...ON,COMMONS_COORDINATOR_GOALS_ENABLED:"true"};
  stale.researchWorkerHealthy=async()=>false;
  assert.equal(await steerTurn(input("Research airport transfer options",{intent:research}),stale),null);
  assert.deepEqual(stale.calls,[]);
  // A healthy worker: an explicit lookup becomes a research Goal; a casual question stays conversation.
  const live=deps([],reading({operation:"none"}));live.environment={...ON,COMMONS_COORDINATOR_GOALS_ENABLED:"true"};
  live.researchWorkerHealthy=async()=>true;
  live.api!.start=async()=>({task:view("Airport transfers",{status:"queued"})}) as never;
  assert.equal(await steerTurn(input("What options are there?",{intent:research}),live),null);
  const started=await steerTurn(input("Research airport transfer options",{intent:research}),live);
  assert.match(started!.assistantText,/^Created/);
  assert.doesNotMatch(started!.assistantText,/no search has started/);
});
