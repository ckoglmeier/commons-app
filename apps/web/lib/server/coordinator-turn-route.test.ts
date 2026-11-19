import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { coordinatorThreads, coordinatorTurns, pollDrafts, processedCommands } from "@commons/database";
import { actAs, and, captureWarnings, databaseTestsEnabled, eq, installRouteFetch, jsonRequest, loadCoordinatorRoutes, params, seedSyntheticTrip, withTestDatabase } from "./coordinator-route-harness";

// Request-level reproductions for docs/COORDINATOR-WORKSPACE-DESIGN.md §1.
// These call the real route handlers against the disposable local database
// with a fake model provider. Repro 1 and repro 4 were `todo` until Stage 3 fixed them.
const skip = !databaseTestsEnabled;

async function inferenceReservations(eventId: string) {
  return withTestDatabase(async db => (await db.select().from(processedCommands).where(eq(processedCommands.commonsId, eventId)))
    .filter(row => (row.result as { kind?: string }).kind === "poll_inference").length);
}

// Observed failure 1: "created a thread, then called the draft endpoint, then
// failed with 403 at the reservation stage".
test("repro 1: an Ask-the-group first turn in a new thread is accepted and its draft is attached to that thread", { skip }, async () => {
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  const network = installRouteFetch(routes);
  const warnings = captureWarnings();
  try {
    actAs(trip.organizerId);
    // Exactly the client sequence in coordinator-workspace.tsx sendMessage() for a new topic.
    const created = await routes.threads.POST(jsonRequest(trip.eventId, "/threads", "POST", { id: randomUUID(), commandId: randomUUID(), title: "Dinner Saturday" }), params(trip.eventId));
    const thread = await created.json();
    assert.equal(created.status, 201, JSON.stringify(thread));
    const draftResponse = await routes.drafts.POST(jsonRequest(trip.eventId, "/drafts", "POST", { id: randomUUID(), prompt: "Where should we eat on Saturday?" }), params(trip.eventId));
    assert.equal(draftResponse.status, 200);
    const { draft } = await draftResponse.json();
    const turn = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", { commandId: randomUUID(), version: thread.version, prompt: "Where should we eat on Saturday?", threadId: thread.activeThreadId, draftId: draft.id, draftVersion: draft.version }), params(trip.eventId));
    const body = await turn.json();
    const [savedDraft] = await withTestDatabase(db => db.select().from(pollDrafts).where(eq(pollDrafts.id, draft.id)));
    const observed = {
      status: turn.status, error: body.error ?? null,
      failedStage: (warnings.events.find(event => event.name === "commons.coordinator.turn_failed")?.detail as { stage?: string } | undefined)?.stage ?? null,
      draftThreadId: savedDraft.threadId === thread.activeThreadId ? "new thread" : savedDraft.threadId,
      inferenceReservationsConsumed: await inferenceReservations(trip.eventId),
      providerCalls: network.providerCalls.length,
    };
    assert.deepEqual({ status: observed.status, draftThreadId: observed.draftThreadId }, { status: 200, draftThreadId: "new thread" },
      `observed on current code: ${JSON.stringify(observed)}`);
  } finally { warnings.restore(); network.restore(); await trip.cleanup(); }
});

// Observed failure 2, server half. This protection is correct and must be
// preserved: a turn built from a superseded thread version is rejected before
// inference and saves nothing. The bug is that voice keeps sending that version.
test("a turn with a superseded thread version is rejected before inference with stale_version and saves nothing", { skip }, async () => {
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  const network = installRouteFetch(routes);
  const warnings = captureWarnings();
  try {
    actAs(trip.organizerId);
    const thread = await (await routes.threads.POST(jsonRequest(trip.eventId, "/threads", "POST", { id: randomUUID(), commandId: randomUUID(), title: "Dinner" }), params(trip.eventId))).json();
    const turn = (prompt: string) => ({ commandId: randomUUID(), version: thread.version, prompt, threadId: thread.activeThreadId, draftId: null, draftVersion: null });
    const first = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", turn("We are driving from Denver.")), params(trip.eventId));
    assert.equal(first.status, 200);
    assert.equal((await first.json()).version, 1);
    const stale = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", turn("Dinner around five?")), params(trip.eventId));
    assert.equal(stale.status, 409);
    const staleBody = await stale.json();
    assert.equal(staleBody.code, "stale_version");
    assert.match(staleBody.error, /This thread changed while you were working/);
    assert.doesNotMatch(staleBody.error, /another tab|Reload before continuing|available to your account/);
    // Stable codes: the failure log now distinguishes a version conflict from every other failure.
    assert.deepEqual(warnings.events.find(event => event.name === "commons.coordinator.turn_failed")?.detail, { stage: "turn", status: 409, reason: "stale_version" });
    const saved = await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, thread.activeThreadId)));
    assert.equal(saved.length, 1, "the stale request saved no turn");
    assert.equal(network.providerCalls.length, 1, "the stale request made no provider call");
  } finally { warnings.restore(); network.restore(); await trip.cleanup(); }
});

// Observed failure 4 / R2: ordinary turns do not receive the saved stay.
test("repro 4: an ordinary dinner turn gives the model the saved stay, dates, and destination", { skip }, async () => {
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  const network = installRouteFetch(routes);
  try {
    actAs(trip.organizerId);
    const thread = await (await routes.threads.POST(jsonRequest(trip.eventId, "/threads", "POST", { id: randomUUID(), commandId: randomUUID(), title: "Dinner" }), params(trip.eventId))).json();
    const response = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", { commandId: randomUUID(), version: thread.version, threadId: thread.activeThreadId, draftId: null, draftVersion: null,
      prompt: "We're driving up from Denver on Friday. Where should the family eat dinner around 5 p.m.?" }), params(trip.eventId));
    assert.equal(response.status, 200);
    const request = network.providerCalls[0].body.messages!.at(-1)!;
    const context = JSON.parse(request.content) as { tripContext?: Record<string, unknown> };
    const serialized = JSON.stringify(context.tripContext ?? null);
    const observed = { tripContextKeys: Object.keys(context.tripContext ?? {}), includesStayName: serialized.includes("Synthetic Peak Lodge"), includesStayAddress: serialized.includes("Synthetic Ridge Rd"), includesDestination: serialized.includes("Breckenridge") };
    assert.deepEqual(observed.includesStayName && observed.includesStayAddress && observed.includesDestination, true, `observed on current code: ${JSON.stringify(observed)}`);
  } finally { network.restore(); await trip.cleanup(); }
});

test("a participant cannot read or write organizer coordinator threads through the routes", { skip }, async () => {
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  const network = installRouteFetch(routes);
  try {
    actAs(trip.organizerId);
    const thread = await (await routes.threads.POST(jsonRequest(trip.eventId, "/threads", "POST", { id: randomUUID(), commandId: randomUUID(), title: "Dinner" }), params(trip.eventId))).json();
    actAs(trip.travelerId);
    const read = await routes.turn.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator?threadId=${thread.activeThreadId}`), params(trip.eventId));
    assert.equal(read.status, 403);
    const write = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", { commandId: randomUUID(), version: 0, prompt: "Hi", threadId: thread.activeThreadId, draftId: null, draftVersion: null }), params(trip.eventId));
    assert.equal(write.status, 403);
    const threads = await withTestDatabase(db => db.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.commonsId, trip.eventId))));
    assert.equal(threads.length, 1);
    assert.equal(network.providerCalls.length, 0);
  } finally { network.restore(); await trip.cleanup(); }
});
