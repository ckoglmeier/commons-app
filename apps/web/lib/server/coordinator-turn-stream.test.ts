import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TurnCommand } from "@commons/contracts";
import { coordinatorTurns, pollDrafts } from "@commons/database";
import { actAs, captureWarnings, databaseTestsEnabled, eq, fakeStreamingProviderResponse, installRouteFetch, loadCoordinatorRoutes, readTurnEvents, seedSyntheticTrip, withTestDatabase, type SyntheticTrip } from "./coordinator-route-harness";

// Streamed turns (docs/COORDINATOR-IMPLEMENTATION-HANDOFF.md §3): real route handlers, real disposable database, a fake provider that streams its
// completion in small chunks split mid-line. No real provider or remote database is involved.
const skip = !databaseTestsEnabled;

type Routes = Awaited<ReturnType<typeof loadCoordinatorRoutes>>;
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Event = { type: string; seq: number; [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const DINNER = "We're driving up from Denver on Friday. Where should the family eat dinner around 5 p.m.?";
const REPLY = "Since you're driving up from Denver, an early seating near Synthetic Peak Lodge will suit tired kids. Alpine Table opens at 4:30 and is a short walk from the stay. Prices and availability are unverified.";

type Provider = Parameters<typeof installRouteFetch>[1];
async function withStream(run: (context: { trip: SyntheticTrip; routes: Routes; network: ReturnType<typeof installRouteFetch>; stream: (body: unknown, personId?: string) => Promise<Response>; post: (body: unknown) => Promise<{ status: number; body: Body }>; lookup: (commandId: string) => Promise<{ status: number; body: Body }>; stop: (commandId: string) => Promise<{ status: number; body: Body }>; command: (over?: Partial<TurnCommand>) => TurnCommand }) => Promise<void>, provider: Provider = {}) {
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  const network = installRouteFetch(routes, provider);
  const warnings = captureWarnings();
  const info = console.info; console.info = () => undefined;
  const url = (path: string) => `http://localhost/api/v1/commons/${trip.eventId}/coordinator${path}`;
  const stream = async (body: unknown, personId = trip.organizerId) => {
    actAs(personId);
    return routes.turns.POST(new Request(url("/turns"), { method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: JSON.stringify(body) }), { params: Promise.resolve({ slug: trip.eventId }) });
  };
  const post = async (body: unknown) => {
    actAs(trip.organizerId);
    const response = await routes.turns.POST(new Request(url("/turns"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ slug: trip.eventId }) });
    return { status: response.status, body: await response.json() };
  };
  const lookup = async (commandId: string) => {
    actAs(trip.organizerId);
    const response = await routes.turnLookup.GET(new Request(url(`/turns/${commandId}`)), { params: Promise.resolve({ slug: trip.eventId, commandId }) });
    return { status: response.status, body: await response.json() };
  };
  const stop = async (commandId: string) => {
    actAs(trip.organizerId);
    const response = await routes.turnStop.POST(new Request(url(`/turns/${commandId}/stop`), { method: "POST" }), { params: Promise.resolve({ slug: trip.eventId, commandId }) });
    return { status: response.status, body: await response.json() };
  };
  const command = (over: Partial<TurnCommand> = {}): TurnCommand => ({ commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text", text: DINNER, ...over } as TurnCommand);
  try { await run({ trip, routes, network, stream, post, lookup, stop, command }); }
  finally { console.info = info; warnings.restore(); network.restore(); await trip.cleanup(); }
}

const turnRows = (eventId: string) => withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, eventId)));
async function settled(lookup: (commandId: string) => Promise<{ body: Body }>, commandId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = await lookup(commandId);
    if (found.body.status && found.body.status !== "pending") return found.body;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("turn never settled");
}

test("a streamed turn reports accepted, real phases and growing guarded text, then the saved result; the text is a prefix of the saved answer", { skip }, () => withStream(async ({ stream, command, trip, network }) => {
  const sent = command();
  const response = await stream(sent);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.match(response.headers.get("cache-control") ?? "", /no-transform/);
  const events = await readTurnEvents(response) as Event[];
  assert.deepEqual(events.map(event => event.seq), events.map((_, index) => index), "seq counts up by one from 0");
  assert.ok(events.every(event => event.commandId === sent.commandId));
  const types = events.map(event => event.type === "phase" ? `phase:${event.phase}` : event.type).filter((type, index, all) => type !== "text" || all[index - 1] !== "text");
  assert.deepEqual(types, ["accepted", "phase:context", "phase:writing", "text", "phase:saving", "completed"]);
  assert.equal(events[0].replayed, false);
  const texts = events.filter(event => event.type === "text").map(event => event.text as string);
  assert.ok(texts.length >= 2, "the reply arrives in more than one piece");
  for (const [index, text] of texts.entries()) if (index) assert.ok(text.startsWith(texts[index - 1]) && text.length > texts[index - 1].length, "each text event extends the last");
  const result = events.at(-1)!.result as Body;
  assert.equal(result.status, "completed");
  assert.equal(result.durableAnswer, REPLY);
  assert.ok(REPLY.startsWith(texts.at(-1)!), "everything streamed is kept in the saved answer");
  assert.equal(events[0].turnId, result.turnId);
  assert.equal(network.providerCalls.length, 1);
  assert.equal((network.providerCalls[0].body as { stream?: boolean }).stream, true);
  const saved = await turnRows(trip.eventId);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].assistantText, REPLY);
}, { provider: body => fakeStreamingProviderResponse(body, REPLY, { chunkChars: 9 }) }));

test("a sentence claiming a booking is never streamed, even briefly, and the saved reply cuts it", { skip }, () => withStream(async ({ stream, command }) => {
  const events = await readTurnEvents(await stream(command())) as Event[];
  const texts = events.filter(event => event.type === "text").map(event => event.text as string);
  assert.ok(texts.length >= 1);
  assert.ok(texts.every(text => !/booked/i.test(text)), JSON.stringify(texts));
  assert.equal(texts.at(-1), "Alpine Table opens at 4:30.", "the stream stops at the first sentence the guard would not keep");
  const result = events.at(-1)!.result as Body;
  assert.equal(result.status, "completed");
  assert.doesNotMatch(result.durableAnswer, /I've booked/);
  assert.match(result.durableAnswer, /^Alpine Table opens at 4:30\. .*Nothing was booked, paid, sent, scheduled, or saved by this reply\./);
}, { provider: body => fakeStreamingProviderResponse(body, "Alpine Table opens at 4:30. I've booked a table for six at 5 p.m. Ridge Grill is a backup.", { chunkChars: 5 }) }));

test("a reader that disconnects mid-reply does not cancel the turn: it is committed once and lookup returns it", { skip }, async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await withStream(async ({ stream, command, lookup, trip, network }) => {
    const sent = command();
    const partial = await readTurnEvents(await stream(sent), event => event.type === "phase" && event.phase === "writing") as Event[];
    assert.equal(partial.at(-1)!.type, "phase");
    release();
    const result = await settled(lookup, sent.commandId);
    assert.equal(result.status, "completed");
    assert.equal(result.durableAnswer, REPLY);
    assert.equal((await turnRows(trip.eventId)).length, 1);
    assert.equal(network.providerCalls.length, 1);
  }, { provider: body => fakeStreamingProviderResponse(body, REPLY, { gate }) });
});

test("Stop ends a reply still being written: nothing is saved as an answer, it is retryable, and Try again reuses the same row", { skip }, async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await withStream(async ({ stream, command, stop, post, trip }) => {
    const sent = command();
    const response = await stream(sent);
    const reading = readTurnEvents(response);
    // Wait until the provider has started, then stop.
    for (let tries = 0; calls === 0 && tries < 200; tries += 1) await new Promise(resolve => setTimeout(resolve, 5));
    const stopped = await stop(sent.commandId);
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.stopped, true);
    assert.equal(stopped.body.outcome, "stopped");
    assert.equal(stopped.body.result.status, "failed");
    release();
    const events = await reading as Event[];
    const result = events.at(-1)!.result as Body;
    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "provider_failed");
    assert.equal(result.error.retryable, true);
    assert.equal(result.durableAnswer, null);
    const [row] = await turnRows(trip.eventId);
    assert.equal(row.assistantText.includes("Alpine"), false, "no part of the stopped reply is saved");
    const retried = await post(sent);
    assert.equal(retried.body.status, "completed");
    assert.equal(retried.body.turnId, result.turnId);
    const rows = await turnRows(trip.eventId);
    assert.equal(rows.length, 1);
    assert.equal((rows[0].workspace as Body).lifecycle.attempt, 2);
  }, { provider: body => { calls += 1; return fakeStreamingProviderResponse(body, REPLY, calls === 1 ? { gate } : {}); } });
});

test("Stop after the reply is committed changes nothing and says it did not stop", { skip }, () => withStream(async ({ stream, command, stop, lookup }) => {
  const sent = command();
  await readTurnEvents(await stream(sent));
  const late = await stop(sent.commandId);
  assert.equal(late.status, 200);
  assert.equal(late.body.stopped, false);
  // A Stop that lost to the commit says so and returns the saved result instead of pretending to undo it.
  assert.equal(late.body.outcome, "already_completed");
  assert.equal(late.body.result.status, "completed");
  assert.equal(late.body.result.durableAnswer, REPLY);
  assert.equal((await lookup(sent.commandId)).body.status, "completed");
  assert.equal((await stop(randomUUID())).status, 404, "an unknown command is not found");
}, { provider: body => fakeStreamingProviderResponse(body, REPLY) }));

test("a provider error mid-stream leaves a failed, retryable turn; the partial text is not saved", { skip }, () => withStream(async ({ stream, command, trip }) => {
  const events = await readTurnEvents(await stream(command())) as Event[];
  const result = events.at(-1)!.result as Body;
  assert.equal(events.at(-1)!.type, "completed");
  assert.equal(result.status, "failed");
  assert.equal(result.error.code, "provider_failed");
  const [row] = await turnRows(trip.eventId);
  assert.doesNotMatch(row.assistantText, /Alpine/);
}, { provider: body => fakeStreamingProviderResponse(body, REPLY, { chunkChars: 20, failAfter: 6 }) }));

test("nothing-saved refusals arrive as one typed rejected event: stale version, participant, and a malformed command is a plain 400", { skip }, () => withStream(async ({ stream, command, trip, network }) => {
  const first = await readTurnEvents(await stream(command())) as Event[];
  const thread = (first.at(-1)!.result as Body).thread;
  const stale = await readTurnEvents(await stream(command({ target: { kind: "existing", threadId: thread.id, expectedTurnVersion: thread.turnVersion - 1 } }))) as Event[];
  assert.deepEqual(stale.map(event => event.type), ["rejected"]);
  assert.equal(stale[0].error.code, "stale_version");
  assert.equal(stale[0].status, 409);
  const participant = await readTurnEvents(await stream(command(), trip.travelerId)) as Event[];
  assert.deepEqual(participant.map(event => [event.type, event.error?.code]), [["rejected", "organizer_required"]]);
  const malformed = await stream({ commandId: "nope" });
  assert.equal(malformed.status, 400);
  assert.match(malformed.headers.get("content-type") ?? "", /json/);
  assert.equal(network.providerCalls.length, 1);
}, { provider: body => fakeStreamingProviderResponse(body, REPLY) }));

test("a replayed command streams its saved result without another provider call", { skip }, () => withStream(async ({ stream, command, network }) => {
  const sent = command();
  const first = await readTurnEvents(await stream(sent)) as Event[];
  const again = await readTurnEvents(await stream(sent)) as Event[];
  assert.deepEqual(again.map(event => event.type), ["accepted", "completed"]);
  assert.equal(again[0].replayed, true);
  assert.deepEqual(again[1].result, first.at(-1)!.result);
  assert.equal(network.providerCalls.length, 1);
}, { provider: body => fakeStreamingProviderResponse(body, REPLY) }));

test("an explicit poll request never streams prose: it reports preparing, and the draft appears only in the completed result", { skip }, () => withStream(async ({ stream, command, trip, network }) => {
  const events = await readTurnEvents(await stream(command({ text: "Ask the group which night works for dinner: Friday or Saturday.", explicitAction: { kind: "ask_group", starterId: null } }))) as Event[];
  assert.equal(events.some(event => event.type === "text"), false);
  assert.ok(events.some(event => event.type === "phase" && event.phase === "preparing"));
  const result = events.at(-1)!.result as Body;
  assert.equal(result.status, "completed");
  assert.ok(result.artifacts.some((artifact: Body) => artifact.kind === "poll_draft"));
  assert.equal((network.providerCalls[0].body as { stream?: boolean }).stream, false, "structured replies are requested whole");
  assert.equal((await withTestDatabase(db => db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, trip.eventId)))).length, 1);
}, { provider: body => fakeStreamingProviderResponse(body, "Here is a question for the group.", { extra: { operations: [{ kind: "add_question", prompt: "Which night works for dinner?", selectionMode: "single", options: [{ label: "Friday", description: null }, { label: "Saturday", description: null }] }] } }) }));

test("the streaming switch: COMMONS_COORDINATOR_STREAMING_ENABLED=false answers the same turn as JSON, and the client reads it the same way", { skip }, () => withStream(async ({ stream, command, trip }) => {
  process.env.COMMONS_COORDINATOR_STREAMING_ENABLED = "false";
  try {
    const response = await stream(command());
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    const body = await response.json();
    assert.equal(body.status, "completed");
    assert.equal(body.durableAnswer, REPLY);
    assert.equal((await turnRows(trip.eventId)).length, 1);
  } finally { delete process.env.COMMONS_COORDINATOR_STREAMING_ENABLED; }
}, { provider: body => fakeStreamingProviderResponse(body, REPLY) }));

test("the openai policy: a streamed turn goes only to OpenAI with an OpenAI model id, never to OpenRouter or the routing classifier", { skip }, () => withStream(async ({ stream, command, network }) => {
  const saved = { policy: process.env.COMMONS_COORDINATOR_INFERENCE_POLICY, key: process.env.OPENAI_API_KEY, routing: process.env.COMMONS_WORKSPACE_ROUTING_MODE, typesafe: process.env.TYPESAFE_API_KEY, model: process.env.COMMONS_WORKSPACE_MODEL };
  Object.assign(process.env, { COMMONS_COORDINATOR_INFERENCE_POLICY: "openai", OPENAI_API_KEY: "test-openai-key", COMMONS_WORKSPACE_ROUTING_MODE: "jev", TYPESAFE_API_KEY: "test-typesafe-key", COMMONS_WORKSPACE_MODEL: "openai/gpt-4.1-mini" });
  // The harness refuses unknown hosts and the router then quietly falls back, so record classifier attempts explicitly.
  const routed = globalThis.fetch, classifierCalls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => { const url = String(input instanceof Request ? input.url : input); if (url.includes("typesafe.ai")) classifierCalls.push(url); return routed(input, init); }) as typeof fetch;
  try {
    const events = await readTurnEvents(await stream(command())) as Event[];
    const result = events.at(-1)!.result as Body;
    assert.equal(result.status, "completed");
    assert.equal(result.durableAnswer, REPLY);
    assert.ok(events.some(event => event.type === "text"), "streams the same way");
    assert.deepEqual(classifierCalls, [], "no routing classifier call even with routing mode jev and a TypeSafe key");
    assert.deepEqual(network.providerCalls.map(call => new URL(call.url).origin), ["https://api.openai.com"]);
    assert.equal(network.providerCalls[0].body.model, "gpt-4.1-mini");
  } finally {
    globalThis.fetch = routed;
    for (const [name, value] of Object.entries({ COMMONS_COORDINATOR_INFERENCE_POLICY: saved.policy, OPENAI_API_KEY: saved.key, COMMONS_WORKSPACE_ROUTING_MODE: saved.routing, TYPESAFE_API_KEY: saved.typesafe, COMMONS_WORKSPACE_MODEL: saved.model })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
}, { provider: body => fakeStreamingProviderResponse(body, REPLY) }));

test("held-out finding: 'which lodge did we book?' keeps the saved lodge's name, streamed and saved, while a new booking claim is still cut", { skip }, async () => {
  let reply = "We booked Synthetic Peak Lodge for February 12–15. Check-in is after 4 p.m.";
  await withStream(async ({ stream, command }) => {
    const events = await readTurnEvents(await stream(command({ text: "Which lodge did we end up booking?" }))) as Event[];
    const result = events.at(-1)!.result as Body;
    assert.equal(result.durableAnswer, "We booked Synthetic Peak Lodge for February 12–15. Check-in is after 4 p.m.");
    assert.ok(events.filter(event => event.type === "text").every(event => result.durableAnswer.startsWith(event.text)));
    reply = "We booked Alpine Table near Synthetic Peak Lodge for 5 p.m. Enjoy dinner.";
    const claim = await readTurnEvents(await stream(command({ text: "Where are we eating Friday?" }))) as Event[];
    assert.doesNotMatch((claim.at(-1)!.result as Body).durableAnswer, /booked Alpine Table/);
  }, { provider: body => fakeStreamingProviderResponse(body, reply) });
});

// ---------------------------------------------------------------------------
// Conversation durability A1 (docs/releases/2026-10-19/CONVERSATION-DURABILITY-TEST-PLAN.md): durable Stop, deadlines and the commit fence.
// ---------------------------------------------------------------------------

/** A provider that never answers and ignores its AbortSignal: the request is recorded, the promise never settles until released. */
function hangingProvider() {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { gate, release, respond: async (body: object, reply: string) => { await gate; return fakeStreamingProviderResponse(body, reply); } };
}

test("A08 a Stop recorded by another instance wins before commit: the running work is refused at commit, the stop is durable and visible on reload", { skip }, async () => {
  const { stopCoordinatorTurn } = await import("@commons/database");
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await withStream(async ({ stream, command, trip, lookup, network }) => {
    const sent = command();
    const reading = readTurnEvents(await stream(sent));
    for (let tries = 0; calls === 0 && tries < 200; tries += 1) await new Promise(resolve => setTimeout(resolve, 5));
    // Another instance: the database stop, without this process's in-memory stop handle.
    const other = await stopCoordinatorTurn(trip.eventId, { commandId: sent.commandId }, { databaseUrl: process.env.DATABASE_URL!, actorPersonId: trip.organizerId });
    assert.equal(other.outcome, "stopped");
    release();
    const events = await reading as Event[];
    const result = events.at(-1)!.result as Body;
    assert.equal(result.status, "failed", "the commit fence refused the reply that finished after the stop");
    assert.equal(result.durableAnswer, null);
    const [row] = await turnRows(trip.eventId);
    assert.deepEqual((row.workspace as Body).stop.attempt, 1, "the stop marker is stored with the attempt it ended");
    assert.equal(row.assistantText.includes("Alpine"), false);
    assert.equal((await lookup(sent.commandId)).body.status, "failed");
    assert.equal(network.providerCalls.length, 1, "no second provider call");
    // Stopping again replays the same outcome.
    assert.equal((await stopCoordinatorTurn(trip.eventId, { commandId: sent.commandId }, { databaseUrl: process.env.DATABASE_URL!, actorPersonId: trip.organizerId })).outcome, "stopped");
  }, { provider: body => { calls += 1; return fakeStreamingProviderResponse(body, REPLY, { gate }); } });
});

test("A08 only the author can stop a turn; another organizer gets not-found and the turn is untouched", { skip }, async () => {
  const { stopCoordinatorTurn } = await import("@commons/database");
  const hang = hangingProvider();
  await withStream(async ({ stream, command, trip }) => {
    const sent = command();
    const reading = readTurnEvents(await stream(sent));
    for (let tries = 0; (await turnRows(trip.eventId)).length === 0 && tries < 200; tries += 1) await new Promise(resolve => setTimeout(resolve, 5));
    await assert.rejects(stopCoordinatorTurn(trip.eventId, { commandId: sent.commandId }, { databaseUrl: process.env.DATABASE_URL!, actorPersonId: trip.coOrganizerId }), /artifact_missing/);
    hang.release();
    const result = (await reading as Event[]).at(-1)!.result as Body;
    assert.equal(result.status, "completed");
  }, { provider: body => hang.respond(body, REPLY) });
});

test("A10 a provider that ignores its AbortSignal and never returns cannot hold the turn open: the hard deadline interrupts it, and late output is not saved", { skip }, async () => {
  const hang = hangingProvider();
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  const network = installRouteFetch(routes, { provider: body => hang.respond(body, REPLY) });
  const warnings = captureWarnings();
  const info = console.info; console.info = () => undefined;
  try {
    actAs(trip.organizerId);
    const { runCoordinatorTurn } = await import("./coordinator-turn-service");
    const sent = { commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text", text: DINNER } as TurnCommand;
    const started = Date.now();
    const result = await runCoordinatorTurn(trip.eventId, sent, { deadlines: { hardMs: 400 } });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5_000, `released promptly (${elapsed}ms)`);
    assert.equal(result.status, "failed");
    assert.equal(result.error?.code, "provider_failed");
    assert.equal(result.error?.retryable, true);
    let [row] = await turnRows(trip.eventId);
    assert.equal((row.workspace as Body).interruption.reason, "deadline");
    // The provider finally answers: nothing the overrun work produces can be saved.
    hang.release();
    await new Promise(resolve => setTimeout(resolve, 300));
    [row] = await turnRows(trip.eventId);
    assert.equal((row.workspace as Body).lifecycle.status, "failed");
    assert.equal(row.assistantText.includes("Alpine"), false);
    assert.equal(network.providerCalls.length, 1, "no automatic retry loop");
  } finally { console.info = info; warnings.restore(); network.restore(); await trip.cleanup(); }
});

test("A10 a stream that stalls after its first chunk is ended by the idle deadline and reported as an unfinished, retryable reply", { skip }, async () => {
  const never = new Promise<void>(() => undefined);
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  // A first chunk large enough to carry a whole guarded sentence, then silence: the idle limit is measured on reply progress (the hard limit covers a stall before any).
  const network = installRouteFetch(routes, { provider: body => fakeStreamingProviderResponse(body, REPLY, { gate: never, chunkChars: 160 }) });
  const warnings = captureWarnings();
  const info = console.info; console.info = () => undefined;
  try {
    actAs(trip.organizerId);
    const { coordinatorTurnStream } = await import("./coordinator-turn-stream");
    const sent = { commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text", text: DINNER } as TurnCommand;
    const started = Date.now();
    const events = await readTurnEvents(coordinatorTurnStream(trip.eventId, sent, new Request("http://localhost/"), { deadlines: { idleMs: 300 } })) as Event[];
    assert.ok(Date.now() - started < 5_000, "the stream closed promptly");
    assert.ok(events.some(event => event.type === "text"), "the first chunk arrived before the stall");
    const result = events.at(-1)!.result as Body;
    assert.equal(events.at(-1)!.type, "completed");
    assert.equal(result.status, "failed");
    assert.equal(result.error.retryable, true);
    const [row] = await turnRows(trip.eventId);
    assert.equal((row.workspace as Body).interruption.reason, "deadline");
    assert.equal(row.assistantText.includes("Alpine"), false, "the streamed prefix is not saved as an answer");
  } finally { console.info = info; warnings.restore(); network.restore(); await trip.cleanup(); }
});
