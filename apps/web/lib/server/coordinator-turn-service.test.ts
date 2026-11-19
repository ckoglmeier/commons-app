import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { coordinatorErrorCatalog, type TurnCommand } from "@commons/contracts";
import { coordinatorThreads, coordinatorTurns, memberships, pollDrafts, processedCommands, publicWorkspace, stays, travelerProfiles, travelPlans } from "@commons/database";
import { expireLease, withLifecycleView, withThreadMeta } from "../test-support/coordinator-rows";
import { actAs, and, captureWarnings, databaseTestsEnabled, eq, fakeProviderResponse, installRouteFetch, jsonRequest, loadCoordinatorRoutes, params, seedSyntheticTrip, withTestDatabase, type ProviderCall, type SyntheticTrip } from "./coordinator-route-harness";

// Acceptance-scenario tests for Stage 3 (design §12). Real route handlers, real disposable database,
// recording fake model provider. No real provider, voice session, or remote database is involved.
const skip = !databaseTestsEnabled;

type Routes = Awaited<ReturnType<typeof loadCoordinatorRoutes>>;
type Network = ReturnType<typeof installRouteFetch>;
// Route responses are JSON of several shapes; assertions read fields directly.
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function withEnvironment(run: (context: { trip: SyntheticTrip; routes: Routes; network: Network; post: (body: unknown, personId?: string) => Promise<{ status: number; body: Body }>; lookup: (commandId: string, personId?: string) => Promise<{ status: number; body: Body }>; command: (over?: Partial<TurnCommand>) => TurnCommand }) => Promise<void>, options: Parameters<typeof installRouteFetch>[1] = {}) {
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  const network = installRouteFetch(routes, options);
  const warnings = captureWarnings();
  const info = console.info; console.info = () => undefined;
  const post = async (body: unknown, personId = trip.organizerId) => {
    actAs(personId);
    const response = await routes.turns.POST(jsonRequest(trip.eventId, "/turns", "POST", body), params(trip.eventId));
    return { status: response.status, body: await response.json() };
  };
  const lookup = async (commandId: string, personId = trip.organizerId) => {
    actAs(personId);
    const response = await routes.turnLookup.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/turns/${commandId}`), { params: Promise.resolve({ slug: trip.eventId, commandId }) });
    return { status: response.status, body: await response.json() };
  };
  const command = (over: Partial<TurnCommand> = {}): TurnCommand => ({ commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text",
    text: "We're driving up from Denver on Friday. Where should the family eat dinner around 5 p.m.?", ...over } as TurnCommand);
  try { await run({ trip, routes, network, post, lookup, command }); }
  finally { console.info = info; warnings.restore(); network.restore(); await trip.cleanup(); }
}

const rows = (eventId: string) => withTestDatabase(async db => ({
  threads: await withThreadMeta(db, eventId, await db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, eventId))),
  turns: (await db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, eventId))).map(withLifecycleView),
  drafts: await db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, eventId)),
  reservations: (await db.select().from(processedCommands).where(eq(processedCommands.commonsId, eventId))).filter(row => (row.result as { kind?: string }).kind === "poll_inference"),
}));
const providerText = (calls: ProviderCall[]) => JSON.stringify(calls.map(call => call.body));

test("first turn: one named thread, one durable turn, a relevant answer, and no poll draft", { skip }, () => withEnvironment(async ({ trip, post, command, network }) => {
  const request = command();
  const { status, body } = await post(request);
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.status, "completed");
  assert.equal(body.durableAnswer, "Try the early seating near your stay.");
  assert.equal(body.shared, false);
  assert.deepEqual(body.saved, { request: true, answer: true, proposal: false });
  // A short, generated heading replaces the safe provisional one; the full sentence is never the heading.
  assert.equal(body.thread.title, "Saturday dinner");
  assert.equal(body.thread.turnVersion, 1);
  const saved = await rows(trip.eventId);
  assert.equal(saved.threads.length, 1);
  assert.equal(saved.turns.length, 1);
  assert.equal(saved.drafts.length, 0, "no unsolicited poll draft");
  assert.deepEqual([saved.turns[0].status, saved.turns[0].inputMode, saved.turns[0].threadId, saved.turns[0].organizerShared], ["completed", "text", request.target.threadId, true]);
  assert.equal(saved.threads[0].titleSource, "generated");
  assert.equal(network.providerCalls.length, 1);
}));

test("idempotent retry by command id: no duplicate thread, turn, draft, provider call, or quota row", { skip }, () => withEnvironment(async ({ trip, post, command, network }) => {
  const request = command();
  const first = await post(request);
  const again = await post(request);
  assert.equal(again.status, 200);
  assert.deepEqual({ status: again.body.status, turnId: again.body.turnId, answer: again.body.durableAnswer, thread: again.body.thread.id }, { status: "completed", turnId: first.body.turnId, answer: first.body.durableAnswer, thread: first.body.thread.id });
  const saved = await rows(trip.eventId);
  assert.deepEqual([saved.threads.length, saved.turns.length, saved.drafts.length, saved.reservations.length, network.providerCalls.length], [1, 1, 0, 1, 1]);
  const mismatched = await post({ ...request, text: "A different request under the same id" });
  assert.equal(mismatched.status, 409);
  assert.equal(mismatched.body.error.code, "command_mismatch");
}));

test("timeout after commit then lookup returns the single saved exchange", { skip }, () => withEnvironment(async ({ trip, post, lookup, command, network }) => {
  const request = command();
  // The server commits; the client never sees the response (timeout, reload, or a lost connection).
  await post(request);
  const found = await lookup(request.commandId);
  assert.equal(found.status, 200);
  assert.deepEqual({ status: found.body.status, answer: found.body.durableAnswer, saved: found.body.saved }, { status: "completed", answer: "Try the early seating near your stay.", saved: { request: true, answer: true, proposal: false } });
  const retry = await post(request);
  assert.equal(retry.body.turnId, found.body.turnId);
  const saved = await rows(trip.eventId);
  assert.deepEqual([saved.threads.length, saved.turns.length, saved.reservations.length, network.providerCalls.length], [1, 1, 1, 1], "a single saved exchange");
  assert.equal((await lookup(randomUUID())).status, 404);
  assert.equal((await lookup(request.commandId, trip.coOrganizerId)).status, 404, "another organizer cannot read this author's command");
}));

test("a client that abandons a turn mid-inference leaves it pending; lookup reports it, then the retry completes once", { skip }, () => withEnvironment(async ({ trip, routes, lookup, command, network }) => {
  const request = command();
  const controller = new AbortController();
  let calls = 0;
  network.restore();
  const abortingNetwork = installRouteFetch(routes, { provider: (body) => { calls += 1; if (calls === 1) controller.abort(); return fakeProviderResponse(body as never, "Second try answer.", null); } });
  try {
    actAs(trip.organizerId);
    const first = await routes.turns.POST(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/turns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request), signal: controller.signal }), params(trip.eventId));
    assert.equal((await first.json()).status, "pending");
    assert.equal((await lookup(request.commandId)).body.status, "pending", "in flight, not lost");
    // Lease expires (simulated) -> lookup reports failed/internal_error rather than pretending it is still working.
    await withTestDatabase(db => expireLease(db, request.commandId));
    const expired = await lookup(request.commandId);
    assert.deepEqual([expired.body.status, expired.body.error.code, expired.body.error.retryable], ["failed", "internal_error", true]);
    actAs(trip.organizerId);
    const retry = await (await routes.turns.POST(jsonRequest(trip.eventId, "/turns", "POST", request), params(trip.eventId))).json();
    assert.deepEqual([retry.status, retry.durableAnswer], ["completed", "Second try answer."]);
    const saved = await rows(trip.eventId);
    assert.deepEqual([saved.threads.length, saved.turns.length, saved.turns[0].attempt, saved.reservations.length], [1, 1, 2, 2]);
  } finally { abortingNetwork.restore(); }
}));

test("provider failure leaves a retryable failed turn and retry completes it", { skip }, () => withEnvironment(async ({ trip, post, lookup, command, network }) => {
  let fail = true;
  network.restore();
  const flaky = installRouteFetch((await loadCoordinatorRoutes()), { provider: (body) => fail ? new Response("boom", { status: 500 }) : fakeProviderResponse(body as never, "Recovered answer.") });
  try {
    const request = command();
    const failed = await post(request);
    assert.equal(failed.status, 200, "the request itself was saved");
    assert.deepEqual([failed.body.status, failed.body.error.code, failed.body.error.retryable, failed.body.saved], ["failed", "provider_failed", true, { request: true, answer: false, proposal: false }]);
    assert.equal(failed.body.error.userMessage, coordinatorErrorCatalog.provider_failed.userMessage);
    assert.doesNotMatch(failed.body.error.userMessage, /account|reload|another tab/i);
    assert.equal(failed.body.durableAnswer, null);
    assert.equal((await lookup(request.commandId)).body.status, "failed");
    let saved = await rows(trip.eventId);
    assert.deepEqual([saved.threads.length, saved.turns.length, saved.turns[0].status, saved.turns[0].userText], [1, 1, "failed", request.text], "the human turn stays visible in its thread");
    fail = false;
    const retry = await post(request);
    assert.deepEqual([retry.body.status, retry.body.durableAnswer, retry.body.turnId], ["completed", "Recovered answer.", failed.body.turnId]);
    saved = await rows(trip.eventId);
    assert.deepEqual([saved.threads.length, saved.turns.length, saved.turns[0].attempt, saved.drafts.length], [1, 1, 2, 0]);
  } finally { flaky.restore(); }
}));

test("hourly limit returns rate_limited without saving a turn", { skip }, () => withEnvironment(async ({ trip, post, command }) => {
  await withTestDatabase(db => db.insert(processedCommands).values(Array.from({ length: 100 }, (_, index) => ({ commonsId: trip.eventId, commandId: `seeded-${index}`, result: { kind: "poll_inference", actorPersonId: trip.organizerId } }))));
  const limited = await post(command());
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "rate_limited");
  assert.equal(limited.body.error.retryable, true);
  const saved = await rows(trip.eventId);
  assert.deepEqual([saved.threads.length, saved.turns.length], [0, 0]);
}));

test("expired auth and a misassociated draft return distinct codes and copy", { skip }, () => withEnvironment(async ({ trip, routes, post, command }) => {
  actAs(trip.organizerId);
  // Two threads; a draft adopted by the first cannot be used in the second.
  const one = await post(command({ text: "Ask the group about dinner." }));
  const draftId = randomUUID();
  const drafted = await routes.drafts.POST(jsonRequest(trip.eventId, "/drafts", "POST", { id: draftId, prompt: "Where should we eat?", threadId: one.body.thread.id }), params(trip.eventId));
  const { draft } = await drafted.json();
  const two = await post(command({ text: "Lodging question." }));
  const misassociated = await post(command({ target: { kind: "existing", threadId: two.body.thread.id, expectedTurnVersion: two.body.thread.turnVersion }, artifact: { kind: "draft", id: draft.id, version: draft.version } }));
  assert.equal(misassociated.status, 409);
  assert.equal(misassociated.body.error.code, "artifact_misassociated");
  // Expired session: no actor at all.
  delete process.env.COMMONS_PILOT_ACTOR_ID;
  const expired = await routes.turns.POST(jsonRequest(trip.eventId, "/turns", "POST", command()), params(trip.eventId));
  const expiredBody = await expired.json();
  assert.equal(expired.status, 401);
  assert.equal(expiredBody.error.code, "auth_expired");
  assert.notEqual(expiredBody.error.userMessage, misassociated.body.error.userMessage);
  assert.match(expiredBody.error.userMessage, /Sign in again/);
  assert.doesNotMatch(misassociated.body.error.userMessage, /account|sign in/i, "no invented account diagnosis for an internal mismatch");
  assert.match(misassociated.body.error.userMessage, /belongs to another thread/);
  assert.equal((await rows(trip.eventId)).turns.length, 2, "neither rejected command saved a turn");
}));

test("participant calls organizer APIs: organizer_required and no context leak", { skip }, () => withEnvironment(async ({ trip, routes, post, lookup, command, network }) => {
  const created = await post(command());
  const asParticipant = await post(command(), trip.travelerId);
  assert.equal(asParticipant.status, 403);
  assert.equal(asParticipant.body.error.code, "organizer_required");
  assert.deepEqual(Object.keys(asParticipant.body), ["error"], "nothing but the error");
  const looked = await lookup(created.body.turnId ? (created.body.commandId as string) : randomUUID(), trip.travelerId);
  assert.equal(looked.status, 403);
  assert.equal(looked.body.error.code, "organizer_required");
  actAs(trip.travelerId);
  const legacy = await routes.turn.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator?threadId=${created.body.thread.id}`), params(trip.eventId));
  const legacyBody = await legacy.json();
  assert.deepEqual([legacy.status, legacyBody.code], [403, "organizer_required"]);
  assert.doesNotMatch(JSON.stringify([asParticipant.body, looked.body, legacyBody]), /Synthetic Peak Lodge|Ridge Rd|Saturday dinner|Casey/);
  assert.equal(network.providerCalls.length, 1, "the participant's request never reached the model");
  assert.equal((await rows(trip.eventId)).turns.length, 1);
}));

test("another organizer changes facts mid-turn: stale_version, no overwrite, and a clean retry", { skip }, () => withEnvironment(async ({ trip, post, command, lookup, network }) => {
  let interfere = true;
  network.restore();
  const routes = await loadCoordinatorRoutes();
  const suggesting = installRouteFetch(routes, { provider: async body => {
    if (interfere) {
      interfere = false;
      // Robin edits the same stay while the model is working.
      await withTestDatabase(db => db.update(stays).set({ totalCents: 190_000, updatedAt: new Date(Date.now() + 5_000) }).where(eq(stays.id, trip.stayId)));
    }
    const schema = (body as { response_format?: { json_schema?: { schema?: { properties?: Record<string, unknown> } } } }).response_format?.json_schema?.schema?.properties ?? {};
    const content: Record<string, unknown> = { reply: "I can prepare that lodging update.", topicTitle: "Lodging cost", threadSummary: null, openQuestions: [],
      tripSuggestion: { operations: ["stay"], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: trip.stayId, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: 200_000, stayBookingUrl: null, stayStatus: null } };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(Object.fromEntries(Object.entries(content).filter(([key]) => key in schema))) } }] }), { status: 200 });
  } });
  try {
    const request = command({ text: "Update our stay: total lodging cost is $2,000." });
    const stale = await post(request);
    assert.equal(stale.status, 200, "the request is saved");
    assert.deepEqual([stale.body.status, stale.body.error.code, stale.body.error.retryable, stale.body.saved.proposal], ["failed", "stale_version", true, false]);
    const [stay] = await withTestDatabase(db => db.select().from(stays).where(eq(stays.id, trip.stayId)));
    assert.equal(stay.totalCents, 190_000, "Robin's edit stands; nothing was overwritten");
    assert.equal((await lookup(request.commandId)).body.error.code, "stale_version");
    const retry = await post(request);
    assert.equal(retry.body.status, "completed", JSON.stringify(retry.body));
    assert.equal(retry.body.reviewRequired, true, "proposal, not applied");
    assert.equal(retry.body.turnId, stale.body.turnId, "the same turn, one saved exchange");
    const [after] = await withTestDatabase(db => db.select().from(stays).where(eq(stays.id, trip.stayId)));
    assert.equal(after.totalCents, 190_000, "still not applied before review");
    const saved = await rows(trip.eventId);
    assert.deepEqual([saved.turns.length, saved.threads.length], [1, 1]);
    const workspace = saved.turns[0].workspace;
    assert.equal(workspace?.tripProposal?.state, "pending");
    assert.equal(workspace?.tripProposal?.base.stay?.totalCents, 190_000, "rebuilt on the refreshed facts");
    assert.equal(workspace?.tripProposal?.changes.stay?.totalCents, 200_000);
  } finally { suggesting.restore(); }
}));

test("legacy owner-private conversation and restricted traveler details never reach the model", { skip }, () => withEnvironment(async ({ trip, routes, post, command, network }) => {
  const markers = { turn: "MARKER-LEGACY-PRIVATE-TURN-9931", draft: "MARKER-LEGACY-PRIVATE-DRAFT-9931", profile: "MARKER-DIETARY-PROFILE-9931", flightRoute: "MARKER-PRIVATE-FLIGHT-9931", code: "MARKER-CONFIRMATION-9931", booking: "marker-booking-9931", details: "MARKER-STAY-DETAILS-9931" };
  await withTestDatabase(async db => {
    await db.insert(travelerProfiles).values({ personId: trip.travelerId, dietaryPreferences: markers.profile });
    await db.insert(travelPlans).values({ commonsId: trip.eventId, personId: trip.travelerId, kind: "car_rental", date: "2027-02-12", route: markers.flightRoute, time: "14:30", status: "confirmed", visibility: "private", confirmationCode: markers.code, sourceLabel: "Added by Taylor Synthetic" });
    await db.update(stays).set({ confirmationCode: markers.code, bookingUrl: `https://example.test/${markers.booking}`, details: markers.details }).where(eq(stays.id, trip.stayId));
  });
  // Legacy owner-private conversation through the old unthreaded path.
  actAs(trip.organizerId);
  const privateDraft = await routes.drafts.POST(jsonRequest(trip.eventId, "/drafts", "POST", { id: randomUUID(), prompt: markers.draft }), params(trip.eventId));
  assert.equal(privateDraft.status, 200);
  await withTestDatabase(async db => {
    await db.update(pollDrafts).set({ organizerShared: false }).where(eq(pollDrafts.commonsId, trip.eventId));
    await db.insert(coordinatorTurns).values({ commonsId: trip.eventId, ownerPersonId: trip.organizerId, organizerShared: false, sequence: 1, commandId: randomUUID(), fingerprint: "x", userText: markers.turn, assistantText: `Reply ${markers.turn}` });
  });
  const answer = await post(command({ text: "Where should we eat on Saturday?" }));
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  const request = providerText(network.providerCalls);
  for (const [name, marker] of Object.entries(markers)) assert.equal(request.includes(marker), false, `${name} marker must not appear in the provider request`);
  assert.ok(request.includes("Synthetic Peak Lodge"), "authorized facts are present");
  assert.equal(JSON.stringify(answer.body).includes("MARKER"), false);
}));

test("CK-style dinner turn sends saved stay, dates and destination to the model and no booking claim is stored", { skip }, () => withEnvironment(async ({ trip, post, command, network }) => {
  const request = command();
  const result = await post(request);
  assert.equal(result.status, 200);
  const messages = network.providerCalls[0].body.messages!;
  const user = JSON.parse(messages.at(-1)!.content) as { tripContext: { trip: Record<string, unknown>; stays: Array<Record<string, unknown>>; unknowns: string[]; asOf: string; travelers: Array<{ name: string; attendance: string }> }; request: string; conversation: Array<{ role: string }> };
  assert.equal(user.request, request.text, "the driving statement reaches the model as the current request");
  assert.deepEqual([user.tripContext.trip.destination, user.tripContext.trip.startsOn, user.tripContext.trip.endsOn], ["Breckenridge, Colorado", "2027-02-12", "2027-02-15"]);
  const [stay] = user.tripContext.stays;
  assert.deepEqual([stay.name, stay.address, stay.startsOn, stay.endsOn, stay.status, stay.bookingReportedByOrganizer, stay.availabilityVerified], ["Synthetic Peak Lodge", "100 Synthetic Ridge Rd, Breckenridge, CO", "2027-02-12", "2027-02-15", "confirmed", true, false]);
  assert.deepEqual(user.tripContext.unknowns.sort(), ["attendance", "budget", "plans", "travel_logistics"].sort(), "absence is explicit, not silent");
  assert.ok(user.tripContext.travelers.some(traveler => traveler.name === "Taylor Synthetic"));
  assert.deepEqual(user.conversation, [], "the pending turn is not sent as history");
  const system = messages.filter(message => message.role === "system").map(message => message.content).join("\n");
  assert.match(system, /Precedence, strongest first/);
  assert.match(system, /do not ask again for facts that are already saved/);
  assert.match(system, /reported by an organizer; availability and prices are not verified/);
  assert.doesNotMatch(system, /You do not receive saved stay records/);
  const saved = await rows(trip.eventId);
  assert.equal(saved.drafts.length, 0);
  assert.equal(publicWorkspace(saved.turns[0].workspace), null, "no proposal, no draft, no booking artifact");
  assert.doesNotMatch(saved.turns[0].assistantText, /\b(booked|reserved|reservation confirmed)\b/i);
  const sources = saved.turns[0].sources as Array<{ kind: string; label?: string }>;
  assert.ok(sources.some(source => source.kind === "trip_fact" && source.label === "Trip dates and destination"), "source references saved with the turn");
  assert.ok(sources.some(source => source.label === "Stay: Synthetic Peak Lodge"));
}));

test("every turn gets context regardless of onboarding or personality flags and keywords", { skip }, () => withEnvironment(async ({ post, command, network }) => {
  for (const flag of ["false", "true"]) {
    process.env.COMMONS_COORDINATOR_ONBOARDING_ENABLED = flag;
    try {
      const result = await post(command({ text: "Anything fun for kids?" }));
      assert.equal(result.status, 200, JSON.stringify(result.body));
    } finally { delete process.env.COMMONS_COORDINATOR_ONBOARDING_ENABLED; }
  }
  for (const call of network.providerCalls) assert.match(providerText([call]), /Synthetic Peak Lodge/);
  assert.equal(network.providerCalls.length, 2);
}));

test("a first turn while the model is not configured saves nothing and says so plainly", { skip }, () => withEnvironment(async ({ trip, post, command }) => {
  // The active policy's key (openai by default) and the rollback policy's key are both absent.
  const key = process.env.OPENROUTER_API_KEY, openaiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENROUTER_API_KEY; delete process.env.OPENAI_API_KEY;
  try {
    const result = await post(command());
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, "provider_not_configured");
    assert.deepEqual([(await rows(trip.eventId)).threads.length, (await rows(trip.eventId)).turns.length], [0, 0]);
    // Model-free attendance still works without a provider.
    const attendance = await post(command({ text: "I am attending the trip." }));
    assert.equal(attendance.body.status, "completed");
    assert.match(attendance.body.durableAnswer, /marked as attending/);
    assert.equal(attendance.body.artifacts[0].kind, "attendance_receipt");
    assert.equal(attendance.body.artifacts[0].undoable, true);
    const [member] = await withTestDatabase(db => db.select().from(memberships).where(and(eq(memberships.commonsId, trip.eventId), eq(memberships.personId, trip.organizerId))));
    assert.equal(member.attendanceState, "attending");
  } finally { process.env.OPENROUTER_API_KEY = key; if (openaiKey) process.env.OPENAI_API_KEY = openaiKey; }
}));

test("the legacy route adapter runs thread turns through the turn service and keeps the legacy payload", { skip }, () => withEnvironment(async ({ trip, routes, post, command }) => {
  const first = await post(command({ text: "Where should we eat?" }));
  actAs(trip.organizerId);
  const legacy = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", { commandId: randomUUID(), version: first.body.thread.turnVersion, prompt: "What about lunch?", threadId: first.body.thread.id, draftId: null, draftVersion: null }), params(trip.eventId));
  const payload = await legacy.json();
  assert.equal(legacy.status, 200);
  assert.equal(payload.version, 2);
  assert.deepEqual(payload.turns.map((turn: { userText: string; status: string }) => [turn.userText, turn.status]), [["Where should we eat?", "completed"], ["What about lunch?", "completed"]]);
  const stale = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", { commandId: randomUUID(), version: 0, prompt: "Stale", threadId: first.body.thread.id, draftId: null, draftVersion: null }), params(trip.eventId));
  const staleBody = await stale.json();
  assert.deepEqual([stale.status, staleBody.code], [409, "stale_version"]);
  const missing = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", { commandId: randomUUID(), version: 0, prompt: "Nope", threadId: randomUUID(), draftId: null, draftVersion: null }), params(trip.eventId));
  assert.deepEqual([missing.status, (await missing.json()).code], [404, "thread_unavailable"]);
}));

test("a legacy unthreaded draft turn keeps working and uses the same context and error codes", { skip }, () => withEnvironment(async ({ trip, routes, network }) => {
  actAs(trip.organizerId);
  const created = await routes.drafts.POST(jsonRequest(trip.eventId, "/drafts", "POST", { id: randomUUID(), prompt: "Where should we stay?" }), params(trip.eventId));
  const { draft } = await created.json();
  const turn = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", { commandId: randomUUID(), version: 0, prompt: "Suggest a question", draftId: draft.id, draftVersion: draft.version }), params(trip.eventId));
  assert.equal(turn.status, 200, JSON.stringify(await turn.clone().json()));
  assert.match(providerText(network.providerCalls), /Synthetic Peak Lodge/, "legacy contexts get the assembled snapshot too");
  const stale = await routes.turn.POST(jsonRequest(trip.eventId, "", "POST", { commandId: randomUUID(), version: 0, prompt: "Again", draftId: draft.id, draftVersion: draft.version }), params(trip.eventId));
  const body = await stale.json();
  assert.deepEqual([stale.status, body.code], [409, "stale_version"]);
}));

test("drafts route: creates inside a thread, and reports the real cause of a failure", { skip }, () => withEnvironment(async ({ trip, routes, post, command }) => {
  const started = await post(command({ text: "Ask the group about dinner." }));
  actAs(trip.organizerId);
  const ok = await routes.drafts.POST(jsonRequest(trip.eventId, "/drafts", "POST", { id: randomUUID(), prompt: "Where to eat?", threadId: started.body.thread.id }), params(trip.eventId));
  assert.equal(ok.status, 200);
  const [row] = await withTestDatabase(db => db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, trip.eventId)));
  assert.equal(row.threadId, started.body.thread.id);
  const missingThread = await routes.drafts.POST(jsonRequest(trip.eventId, "/drafts", "POST", { id: randomUUID(), prompt: "x", threadId: randomUUID() }), params(trip.eventId));
  assert.deepEqual([missingThread.status, (await missingThread.json()).code], [404, "thread_unavailable"]);
  const bad = await routes.drafts.POST(jsonRequest(trip.eventId, "/drafts", "POST", { id: "not-a-uuid", prompt: "x" }), params(trip.eventId));
  assert.deepEqual([bad.status, (await bad.json()).code], [400, "invalid_request"]);
  actAs(trip.travelerId);
  const participant = await routes.drafts.POST(jsonRequest(trip.eventId, "/drafts", "POST", { id: randomUUID(), prompt: "x" }), params(trip.eventId));
  assert.deepEqual([participant.status, (await participant.json()).code], [403, "organizer_required"]);
}));
