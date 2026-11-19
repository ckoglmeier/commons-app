import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import type { TurnCommand } from "@commons/contracts";
import { eventCreationAccess, coordinatorTurnExecutions, coordinatorTurns, processedCommands, recordCoordinatorTurnRunnerHeartbeat } from "@commons/database";
import { actAs, captureWarnings, databaseTestsEnabled, eq, installRouteFetch, loadCoordinatorRoutes, seedSyntheticTrip, testDatabaseUrl, withTestDatabase, type SyntheticTrip } from "./coordinator-route-harness";

/*
 * Conversation durability A2 (docs/releases/2026-10-19/CONVERSATION-DURABILITY-TEST-PLAN.md A01-A07, A13, A15, A16): real separate OS processes.
 * A short-lived "web" child accepts a turn through the real route and exits; runner children (scripts/coordinator-turn-runner.ts --fixture) claim and
 * execute it as the turn's stored owner, with no pilot actor or cookie in their environment. The fixture provider counts calls across processes in a
 * shared log and can hold a call behind a gate file so a test can kill the runner mid-provider. Every row asserted below is read from the database.
 */
const skip = !databaseTestsEnabled;
const WEB = join(__dirname, "../..");
const DINNER = "We're driving up from Denver on Friday. Where should the family eat dinner around 5 p.m.?";
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: process.env.TMPDIR ?? "/tmp", NODE_ENV: "development", COMMONS_COORDINATOR_ENABLED: "true", COMMONS_RUN_DATABASE_TESTS: "1",
    TEST_DATABASE_URL: testDatabaseUrl(), DATABASE_URL: testDatabaseUrl(), COMMONS_INVITATION_TOKEN_KEY: process.env.COMMONS_INVITATION_TOKEN_KEY ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    COMMONS_EMAIL_SEND_MODE: "disabled", ...extra };
}

function run(script: string, args: string[], env: NodeJS.ProcessEnv): { child: ChildProcess; done: Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string }> } {
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", script, ...args], { cwd: WEB, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk; });
  child.stderr!.on("data", () => undefined);
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stdout: string }>(resolve => child.on("exit", (code, signal) => resolve({ code, signal, stdout })));
  return { child, done };
}

/** One short-lived web process: posts the command and exits. */
async function admitInChild(trip: SyntheticTrip, command: TurnCommand) {
  const { done } = run("lib/test-support/durable-admit-child.ts", [trip.eventId, trip.organizerId, JSON.stringify(command)], baseEnv());
  const exited = await done;
  assert.equal(exited.code, 0, "the admitting process exited normally");
  return JSON.parse(exited.stdout.trim().split("\n").at(-1)!) as { status: number; body: Row; pid: number };
}

function runner(dir: string, args: string[], extra: Record<string, string> = {}) {
  // Deliberately no COMMONS_PILOT_ACTOR_ID and no Supabase settings: identity can only come from the claimed execution row.
  return run("scripts/coordinator-turn-runner.ts", ["--fixture", ...args], baseEnv({ COMMONS_TURN_RUNNER_CALL_LOG: join(dir, "calls.log"), COMMONS_TURN_RUNNER_LEASE_MS: "1500", ...extra }));
}

const calls = (dir: string) => existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as { pid: number }) : [];
const turnRows = (eventId: string) => withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, eventId)));
const executionRows = (eventId: string) => withTestDatabase(db => db.select().from(coordinatorTurnExecutions).where(eq(coordinatorTurnExecutions.commonsId, eventId)));
const reservations = (eventId: string) => withTestDatabase(async db => (await db.select().from(processedCommands).where(eq(processedCommands.commonsId, eventId))).filter(row => (row.result as Row).kind === "poll_inference").length);
const command = (over: Partial<TurnCommand> = {}): TurnCommand => ({ commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text", text: DINNER, ...over } as TurnCommand);
async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 20_000) {
  const until = Date.now() + ms;
  for (;;) { const value = await read(); if (ok(value)) return value; if (Date.now() > until) throw new Error("condition not reached"); await new Promise(resolve => setTimeout(resolve, 100)); }
}

async function withDurable(runTest: (context: { trip: SyntheticTrip; dir: string }) => Promise<void>) {
  const trip = await seedSyntheticTrip();
  const dir = mkdtempSync(join(tmpdir(), "commons-durable-"));
  try { await recordCoordinatorTurnRunnerHeartbeat(testDatabaseUrl()); await runTest({ trip, dir }); }
  finally { await trip.cleanup(); }
}

test("A04 accepted in one process that exits before dispatch, executed by a separate runner process: one result, one provider call, receipts consistent", { skip }, () => withDurable(async ({ trip, dir }) => {
  const sent = command();
  const accepted = await admitInChild(trip, sent);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, "pending", "the web process only accepted it");
  let [execution] = await executionRows(trip.eventId);
  assert.equal(execution.status, "queued"); assert.ok(execution.input, "recoverable execution input saved with the turn");
  assert.equal(JSON.stringify(execution.input).includes("cookie"), false);
  const drained = await runner(dir, ["--drain"]).done;
  assert.equal(drained.code, 0);
  const [turn] = await turnRows(trip.eventId);
  assert.equal((turn.workspace as Row).lifecycle.status, "completed");
  assert.match(turn.assistantText, /early seating/);
  [execution] = await executionRows(trip.eventId);
  assert.equal(execution.status, "completed"); assert.equal(execution.input, null, "execution input is cleared when the attempt ends"); assert.equal(execution.claims, 1);
  assert.ok(execution.providerStartedAt);
  const providerCalls = calls(dir);
  assert.equal(providerCalls.length, 1);
  assert.notEqual(providerCalls[0].pid, accepted.pid, "the provider was called by the runner, not the process that accepted the turn");
  assert.equal(await reservations(trip.eventId), 1);
}));

test("A01/A02 the same command from two web processes is one turn, one execution and one provider call; a reused id with different text is refused before work", { skip }, () => withDurable(async ({ trip, dir }) => {
  const sent = command();
  const [first, second] = await Promise.all([admitInChild(trip, sent), admitInChild(trip, sent)]);
  assert.equal(first.body.turnId, second.body.turnId);
  const mismatch = await admitInChild(trip, { ...sent, text: "Something else entirely" });
  assert.equal(mismatch.status, 409); assert.equal(mismatch.body.error.code, "command_mismatch");
  await runner(dir, ["--drain"]).done;
  assert.equal((await turnRows(trip.eventId)).length, 1);
  assert.equal((await executionRows(trip.eventId)).length, 1);
  assert.equal(calls(dir).length, 1);
  assert.equal(await reservations(trip.eventId), 1);
}));

test("A05 a runner killed after claiming but before any provider work is reclaimed by another runner: still one provider call", { skip }, () => withDurable(async ({ trip, dir }) => {
  const sent = command();
  await admitInChild(trip, sent);
  const crashed = await runner(dir, ["--drain"], { COMMONS_TURN_RUNNER_TEST_CRASH_AT: "claimed" }).done;
  assert.equal(crashed.code, 137, "the first runner died right after its claim committed");
  let [execution] = await executionRows(trip.eventId);
  assert.equal(execution.status, "running"); assert.equal(execution.providerStartedAt, null, "the database proves provider work never started");
  assert.equal(calls(dir).length, 0);
  await new Promise(resolve => setTimeout(resolve, 1700)); // the dead runner's 1.5s lease expires
  await runner(dir, ["--drain"]).done;
  [execution] = await executionRows(trip.eventId);
  assert.equal(execution.status, "completed"); assert.equal(execution.claims, 2);
  const [turn] = await turnRows(trip.eventId);
  assert.equal((turn.workspace as Row).lifecycle.status, "completed");
  assert.equal(calls(dir).length, 1);
  assert.equal(await reservations(trip.eventId), 1, "a reclaim is not a new attempt and reserves nothing more");
}));

test("A06 a runner killed while the provider call is in flight is interrupted, not repurchased; an explicit retry is a new, accounted attempt", { skip }, () => withDurable(async ({ trip, dir }) => {
  const gate = join(dir, "gate");
  const sent = command();
  await admitInChild(trip, sent);
  const held = runner(dir, ["--drain"], { COMMONS_TURN_RUNNER_GATE_FILE: gate });
  await waitFor(async () => calls(dir).length, count => count === 1);
  held.child.kill("SIGKILL");
  await held.done;
  await new Promise(resolve => setTimeout(resolve, 1700));
  const recovered = await runner(dir, ["--drain"]).done;
  assert.match(recovered.stdout, /"disposition":"provider_started"/);
  let [turn] = await turnRows(trip.eventId);
  assert.equal((turn.workspace as Row).lifecycle.status, "failed");
  assert.equal((turn.workspace as Row).interruption.reason, "provider_started");
  assert.equal(calls(dir).length, 1, "the interrupted provider call was not repeated");
  const [execution] = await executionRows(trip.eventId);
  assert.equal(execution.status, "interrupted"); assert.equal(execution.input, null);
  // A person retries explicitly: same command id, a new attempt, a new reservation, one more call.
  writeFileSync(gate, "open");
  const retried = await admitInChild(trip, sent);
  assert.equal(retried.body.status, "pending");
  await runner(dir, ["--drain"]).done;
  [turn] = await turnRows(trip.eventId);
  assert.equal((turn.workspace as Row).lifecycle.status, "completed"); assert.equal((turn.workspace as Row).lifecycle.attempt, 2);
  assert.equal(calls(dir).length, 2);
  assert.equal(await reservations(trip.eventId), 2);
  const executions = await executionRows(trip.eventId);
  assert.deepEqual(executions.map(row => [row.attempt, row.status]).sort(), [[1, "interrupted"], [2, "completed"]]);
}));

test("A07 a runner that lost its lease cannot publish: the next claim settles the attempt and the stale commit is refused", { skip }, () => withDurable(async ({ trip, dir }) => {
  const gate = join(dir, "gate");
  const sent = command();
  await admitInChild(trip, sent);
  const stale = runner(dir, ["--drain"], { COMMONS_TURN_RUNNER_GATE_FILE: gate, COMMONS_TURN_RUNNER_TEST_NO_RENEW: "1" });
  await waitFor(async () => calls(dir).length, count => count === 1);
  await new Promise(resolve => setTimeout(resolve, 1700)); // its lease expires while it still runs
  await runner(dir, ["--drain"]).done; // a second runner finds the expired, provider-started claim
  writeFileSync(gate, "open"); // the stale runner's provider finally answers
  await stale.done;
  const [turn] = await turnRows(trip.eventId);
  assert.equal((turn.workspace as Row).lifecycle.status, "failed");
  assert.equal(turn.assistantText.includes("early seating"), false, "the stale writer's answer was not saved");
  assert.equal(calls(dir).length, 1);
}));

test("A08 Stop from the web while a separate runner is mid-provider: the stop wins, the runner's claim ends, and its late result is refused", { skip }, () => withDurable(async ({ trip, dir }) => {
  const gate = join(dir, "gate");
  const sent = command();
  await admitInChild(trip, sent);
  const held = runner(dir, ["--drain"], { COMMONS_TURN_RUNNER_GATE_FILE: gate });
  await waitFor(async () => calls(dir).length, count => count === 1);
  const routes = await loadCoordinatorRoutes();
  const warnings = captureWarnings();
  try {
    actAs(trip.organizerId);
    const response = await routes.turnStop.POST(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/turns/${sent.commandId}/stop`, { method: "POST" }), { params: Promise.resolve({ slug: trip.eventId, commandId: sent.commandId }) });
    const body = await response.json() as Row;
    assert.equal(body.outcome, "stopped");
  } finally { warnings.restore(); }
  writeFileSync(gate, "open");
  await held.done;
  const [turn] = await turnRows(trip.eventId);
  assert.equal((turn.workspace as Row).lifecycle.status, "failed"); assert.equal((turn.workspace as Row).stop.attempt, 1);
  const [execution] = await executionRows(trip.eventId);
  assert.equal(execution.status, "cancelled"); assert.equal(execution.disposition, "stopped");
  assert.equal(calls(dir).length, 1);
}));

test("A13/A15 without a healthy runner a turn uses the tested in-request path; queued work past its age is interrupted; status reads cost no provider call", { skip }, async () => {
  const trip = await seedSyntheticTrip();
  const dir = mkdtempSync(join(tmpdir(), "commons-durable-"));
  const routes = await loadCoordinatorRoutes();
  const network = installRouteFetch(routes, { reply: "Try the early seating near the lodge." });
  const warnings = captureWarnings(); const info = console.info; console.info = () => undefined;
  try {
    // No heartbeat newer than 30s: admission is not durable; the ordinary path answers in this request and writes no execution row.
    await withTestDatabase(db => db.execute(sql`update coordinator_worker_health set seen_at = now() - interval '10 minutes' where kind = 'coordinator_turns'`));
    actAs(trip.organizerId); process.env.COMMONS_DURABLE_COORDINATOR_TURNS_ENABLED = "true";
    const legacy = await routes.turns.POST(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/turns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command()) }), { params: Promise.resolve({ slug: trip.eventId }) });
    assert.equal((await legacy.json() as Row).status, "completed");
    assert.equal((await executionRows(trip.eventId)).length, 0);
    // A runner checked in, then went away: accepted work waits, lookups say pending and cost nothing, and the next runner reports it interrupted.
    await recordCoordinatorTurnRunnerHeartbeat(testDatabaseUrl());
    const sent = command();
    const accepted = await admitInChild(trip, sent);
    assert.equal(accepted.body.status, "pending");
    const before = network.providerCalls.length;
    for (let read = 0; read < 10; read += 1) {
      actAs(trip.organizerId);
      const found = await routes.turnLookup.GET(new Request(`http://localhost/x`), { params: Promise.resolve({ slug: trip.eventId, commandId: sent.commandId }) });
      assert.equal((await found.json() as Row).status, "pending");
    }
    assert.equal(network.providerCalls.length, before, "status reads make no provider call");
    const late = await runner(dir, ["--drain"], { COMMONS_TURN_RUNNER_MAX_QUEUE_MS: "1" }).done;
    assert.match(late.stdout, /"disposition":"queue_expired"/);
    const row = (await turnRows(trip.eventId)).find(item => item.commandId === sent.commandId)!;
    assert.equal((row.workspace as Row).lifecycle.status, "failed"); assert.equal((row.workspace as Row).interruption.reason, "lease_expired");
    assert.equal(calls(dir).length, 0);
  } finally { delete process.env.COMMONS_DURABLE_COORDINATOR_TURNS_ENABLED; console.info = info; warnings.restore(); network.restore(); await trip.cleanup(); }
});

test("A16 turning admission off leaves accepted work drained by the runner; the emergency stop interrupts queued work truthfully instead of running it", { skip }, () => withDurable(async ({ trip, dir }) => {
  const kept = command(), held = command();
  await admitInChild(trip, kept);
  await admitInChild(trip, held);
  // Admission is now off (no child sets the flag again); the runner is independent of it and drains one, then the emergency stop applies to the rest.
  await runner(dir, ["--once"]).done;
  const stopped = await runner(dir, ["--drain"], { COMMONS_DURABLE_COORDINATOR_TURNS_PROCESSING_STOPPED: "true" }).done;
  assert.match(stopped.stdout, /"disposition":"processing_stopped"/);
  const rows = await turnRows(trip.eventId);
  const statuses = rows.map(row => (row.workspace as Row).lifecycle.status).sort();
  assert.deepEqual(statuses, ["completed", "failed"]);
  const failed = rows.find(row => (row.workspace as Row).lifecycle.status === "failed")!;
  assert.equal((failed.workspace as Row).interruption.reason, "processing_stopped");
  assert.equal(calls(dir).length, 1);
}));

test("A11 a membership removed while the turn waits: the runner refuses to act for that person, writes no answer and calls no provider", { skip }, () => withDurable(async ({ trip, dir }) => {
  // Keep this trip explicitly pilot so the runner must independently reject the removed requester.
  await withTestDatabase(db => db.insert(eventCreationAccess).values({ personId: trip.coOrganizerId, requesterEmail: "robin@example.invalid", status: "approved", decidedAt: new Date() }));
  const sent = command();
  await admitInChild(trip, sent);
  await withTestDatabase(db => db.execute(sql`update memberships set status = 'removed' where commons_id = ${trip.eventId} and person_id = ${trip.organizerId}`));
  await runner(dir, ["--drain"]).done;
  const [turn] = await turnRows(trip.eventId);
  assert.equal((turn.workspace as Row).lifecycle.status, "failed");
  assert.equal((turn.workspace as Row).lifecycle.errorCode, "membership_lost");
  assert.equal(calls(dir).length, 0);
  const [execution] = await executionRows(trip.eventId);
  assert.equal(execution.status, "interrupted"); assert.equal(execution.input, null);
}));

test("A03 durable stream: accepted, real runner phases and guarded text, then the saved result; a reader that leaves early still gets the result by lookup", { skip }, () => withDurable(async ({ trip, dir }) => {
  // Each streamed chunk takes 40ms, so the reply arrives over about a second, as a real one does; phases and text are progress, not guaranteed events.
  const loop = runner(dir, [], { COMMONS_TURN_RUNNER_POLL_MS: "200", COMMONS_TURN_RUNNER_FIXTURE_DELAY_MS: "40" });
  try {
    await waitFor(async () => loop.child.exitCode === null && (await withTestDatabase(db => db.execute(sql`select seen_at from coordinator_worker_health where kind = 'coordinator_turns' and seen_at > now() - interval '5 seconds'`))).length > 0, ok => ok);
    const routes = await loadCoordinatorRoutes();
    const warnings = captureWarnings(); const info = console.info; console.info = () => undefined;
    let restoreFetch = () => undefined as void;
    try {
      actAs(trip.organizerId); process.env.COMMONS_DURABLE_COORDINATOR_TURNS_ENABLED = "true";
      // The web process still checks that conversation is configured before accepting; it never calls a provider itself.
      process.env.OPENROUTER_API_KEY = "fixture-transport-not-a-key"; process.env.OPENAI_API_KEY = "fixture-transport-not-a-key";
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => { throw new TypeError("The observing web process makes no outbound requests."); }) as typeof fetch;
      restoreFetch = () => { globalThis.fetch = originalFetch; delete process.env.OPENROUTER_API_KEY; delete process.env.OPENAI_API_KEY; };
      const { readTurnEvents } = await import("./coordinator-route-harness");
      const stream = (body: TurnCommand) => routes.turns.POST(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/turns`, { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body) }), { params: Promise.resolve({ slug: trip.eventId }) });
      const sent = command(), started = Date.now();
      const events = await readTurnEvents(await stream(sent));
      const elapsed = Date.now() - started;
      assert.equal(events[0].type, "accepted");
      assert.ok(events.some(event => event.type === "phase"), "phases recorded by the runner reach the observer");
      assert.ok(events.some(event => event.type === "text"), "guarded reply text recorded by the runner reaches the observer");
      const final = events.at(-1)!;
      assert.equal(final.type, "completed");
      assert.equal((final.result as Row).status, "completed");
      assert.ok(events.filter(event => event.type === "text").every(event => String((final.result as Row).durableAnswer).startsWith(String(event.text))), "streamed text is a prefix of the saved answer");
      console.error(`durable stream end-to-end ${elapsed}ms`);
      // Leave right after acceptance: the runner still finishes, and lookup returns the saved result.
      const early = command();
      await readTurnEvents(await stream(early), event => event.type === "accepted");
      const settled = await waitFor(async () => { actAs(trip.organizerId); return (await (await routes.turnLookup.GET(new Request("http://localhost/x"), { params: Promise.resolve({ slug: trip.eventId, commandId: early.commandId }) })).json()) as Row; }, body => body.status !== "pending");
      assert.equal(settled.status, "completed");
      assert.equal(calls(dir).length, 2);
    } finally { restoreFetch(); delete process.env.COMMONS_DURABLE_COORDINATOR_TURNS_ENABLED; console.info = info; warnings.restore(); }
  } finally { loop.child.kill("SIGTERM"); await loop.done; }
}));
