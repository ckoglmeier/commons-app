import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, like, sql } from "drizzle-orm";
import { eventCreationAccess, auditEvents, commons, coordinatorTurns, memberships, processedCommands, stays, submitTripConstraint } from "@commons/database";
import { actAs, databaseTestsEnabled, jsonRequest, params, seedSyntheticTrip, testDatabaseUrl, withCoordinatorScenario, withTestDatabase, type ScenarioContext } from "./coordinator-route-harness";
// Goals are on by default; these cases cover the Coordinator paths without them.
process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "false";

/*
 * Commons-native lodging journey: the real route handlers, a disposable database, the synthetic Breckenridge trip, the labeled lodging fixture and the
 * recording fake model/search providers. There is no second process: the saved proposal is the wait and the existing apply command is the continuation.
 * The resolver's provider is a scripted fake installed in front of the harness, so its calls are counted separately from the ordinary coordinator's.
 * Everything here is fixture-backed: no real lodging research, supplier, booking or payment exists in this workflow.
 */

const skip = !databaseTestsEnabled;
const CANARY = "PRIVATE-CANARY-do-not-share";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = Record<string, any>;
type Native = {
  s: ScenarioContext; tripId: string; threadId: string;
  say: (text: string, personId?: string, extra?: { threadId?: string; command?: Record<string, unknown> }) => Promise<{ status: number; body: Body }>;
  act: (turnId: string, personId: string, input?: { action?: "apply_trip" | "dismiss_trip" | "revise_trip"; commandId?: string; expectedVersion?: number; changes?: unknown; slug?: string }) => Promise<{ status: number; body: Body }>;
  constraint: (personId: string, input: { kind: "max_nightly_cents" | "min_bedrooms" | "note"; text: string; value?: number | null; audience?: string }, commandId?: string) => Promise<unknown>;
  options: (personId: string) => { databaseUrl: string; actorPersonId: string };
};
const FLAGS = ["COMMONS_NATIVE_LODGING_ENABLED", "COMMONS_NATIVE_LODGING_TRIPS", "COMMONS_NATIVE_LODGING_PERSON_IDS", "COMMONS_NATIVE_LODGING_MODEL_RESOLVE", "COMMONS_NATIVE_LODGING_ALLOW_PRODUCTION", "COMMONS_LODGING_RESEARCH_ADAPTER"];

async function withNative(run: (n: Native) => Promise<void>, extras: { native?: boolean } = {}) {
  const saved = Object.fromEntries(FLAGS.map(key => [key, process.env[key]]));
  try {
    await withCoordinatorScenario(async s => {
      for (const key of FLAGS) delete process.env[key];
      if (extras.native !== false) Object.assign(process.env, { COMMONS_NATIVE_LODGING_ENABLED: "true", COMMONS_NATIVE_LODGING_TRIPS: s.trip.eventId });
      const options = (personId: string) => ({ databaseUrl: testDatabaseUrl(), actorPersonId: personId });
      const versions = new Map<string, number>();
      const n: Native = { s, tripId: s.trip.eventId, threadId: randomUUID(), options,
        say: async (text, personId = s.trip.organizerId, extra = {}) => {
          const threadId = extra.threadId ?? n.threadId, version = versions.get(threadId);
          const target = version === undefined ? { kind: "new", threadId } : { kind: "existing", threadId, expectedTurnVersion: version };
          const response = await s.post({ commandId: randomUUID(), target, inputMode: "text", text, ...extra.command }, personId);
          if (response.body.thread) versions.set(threadId, response.body.thread.turnVersion);
          return response;
        },
        act: async (turnId, personId, input = {}) => {
          actAs(personId);
          const body = { turnId, threadId: n.threadId, commandId: input.commandId ?? randomUUID(), action: input.action ?? "apply_trip", expectedVersion: input.expectedVersion ?? 1, ...(input.changes ? { changes: input.changes } : {}) };
          const response = await s.routes.turn.PATCH(jsonRequest(input.slug ?? n.tripId, "", "PATCH", body), params(input.slug ?? n.tripId));
          return { status: response.status, body: await response.json() };
        },
        constraint: (personId, input, commandId = randomUUID()) => submitTripConstraint(s.trip.eventId, commandId, { value: null, audience: "shared", ...input }, options(personId)),
      };
      await run(n);
    });
  } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

/** Shortlist then choose: the proposal is saved with its intent and nothing else happens until a human reviews it. */
async function prepare(n: Native, option = "Go with option 1", personId?: string) {
  const shortlist = await n.say("Find lodging options for the group", personId);
  assert.equal(shortlist.status, 200, JSON.stringify(shortlist.body).slice(0, 400));
  assert.equal(shortlist.body.capability, "research");
  const choice = await n.say(option, personId);
  assert.equal(choice.body.capability, "propose_trip_change", JSON.stringify(choice.body.durableAnswer));
  return choice.body as { turnId: string; commandId: string };
}
const proposalIn = (thread: Body, turnId: string) => thread.turns.find((turn: Body) => turn.id === turnId)?.workspace?.tripProposal;
const stayNames = (tripId: string) => withTestDatabase(async db => (await db.select({ name: stays.name }).from(stays).where(eq(stays.commonsId, tripId))).map(row => row.name).sort());
const continuations = (tripId: string) => withTestDatabase(db => db.select().from(auditEvents).where(and(eq(auditEvents.commonsId, tripId), like(auditEvents.commandId, "prepare_lodging_brief:%"))));
const shortlists = (tripId: string) => withTestDatabase(db => db.select().from(processedCommands).where(and(eq(processedCommands.commonsId, tripId), like(processedCommands.commandId, "commons:lodging-research:%"))));
const reservations = (tripId: string) => withTestDatabase(async db => (await db.select().from(processedCommands).where(and(eq(processedCommands.commonsId, tripId), sql`${processedCommands.result}->>'kind' = 'poll_inference'`))).length);
const turnCount = (tripId: string) => withTestDatabase(async db => (await db.select({ id: coordinatorTurns.id }).from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, tripId))).length);
const storedProposal = (turnId: string): Promise<Body> => withTestDatabase(async db => (await db.select({ workspace: coordinatorTurns.workspace }).from(coordinatorTurns).where(eq(coordinatorTurns.id, turnId)))[0]?.workspace?.tripProposal as Body);
const setDates = (tripId: string, startsOn: string | null, endsOn: string | null) => withTestDatabase(db => db.update(commons).set({ startsOn, endsOn }).where(eq(commons.id, tripId)));
const hasProposal = (body: Body) => body.artifacts.some((item: Body) => item.kind === "trip_change_proposal");
const intentOf = async (n: Native, turnId: string, threadId = n.threadId) => proposalIn(await n.s.thread(threadId), turnId)?.preparation?.intent;

// --- Scripted resolver provider ---------------------------------------------------------------------------------------------------------------
type ResolverReply = { intent: string; optionId: string | null; needsClarification: boolean } | Record<string, unknown>;
type ResolverScript = (shortlist: Array<{ id: string; name: string; totalUsd: number; bedrooms: number }>) => ResolverReply | Response | Promise<Response>;
async function withResolver(script: ResolverScript, run: (requests: string[]) => Promise<void>) {
  const requests: string[] = [], inner = globalThis.fetch;
  process.env.COMMONS_NATIVE_LODGING_MODEL_RESOLVE = "true";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.response_format?.json_schema?.name !== "lodging_request") return inner(input, init);
    requests.push(String(init?.body));
    const reply = await script(JSON.parse(body.messages[1].content).shortlist);
    if (reply instanceof Response) return reply;
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] }), { status: 200 });
  }) as typeof fetch;
  try { await run(requests); } finally { globalThis.fetch = inner; delete process.env.COMMONS_NATIVE_LODGING_MODEL_RESOLVE; }
}
const cheapest: ResolverScript = shortlist => ({ intent: "choose", optionId: [...shortlist].sort((a, b) => a.totalUsd - b.totalUsd)[0].id, needsClarification: false });

// --- A. Flags and entitlement ----------------------------------------------------------------------------------------------------------------

test("Account pilot: another organizer on the same trip cannot start native lodging or run its continuation", { skip }, () => withNative(async n => {
  process.env.COMMONS_NATIVE_LODGING_PERSON_IDS = n.s.trip.organizerId;
  const ordinary = await n.say("Find lodging options for the group", n.s.trip.coOrganizerId);
  assert.equal(ordinary.body.status, "completed");
  assert.equal((await shortlists(n.tripId)).length, 0);
  const parked = await prepare(n);
  const applied = await n.act(parked.turnId, n.s.trip.coOrganizerId);
  assert.equal(applied.status, 200, "existing shared approval permission is unchanged");
  assert.notEqual(proposalIn(applied.body, parked.turnId).preparation.outcome.status, "prepared", "unlisted approver cannot execute the native continuation");
}));

test("Native lodging off: lodging requests take the ordinary coordinator path and nothing native is written", { skip }, () => withNative(async n => {
  const ordinary = await n.say("Find lodging options for the group");
  assert.equal(ordinary.status, 200);
  assert.equal(n.s.network.providerCalls.length, 1, "the existing coordinator answered with its (fake) model, as before");
  assert.equal((await shortlists(n.tripId)).length, 0);
  assert.ok(!hasProposal(ordinary.body));
  assert.equal(await reservations(n.tripId), 1, "the ordinary model turn still reserves its hourly slot");
}, { native: false }));

test("Native on, resolver off: the deterministic journey works end to end with zero model or search calls", { skip }, () => withNative(async n => {
  const parked = await prepare(n);
  const applied = await n.act(parked.turnId, n.s.trip.organizerId);
  assert.equal(applied.status, 200, JSON.stringify(applied.body).slice(0, 300));
  assert.equal(proposalIn(applied.body, parked.turnId).preparation.outcome.status, "prepared", "the deterministic brief needs no model");
  assert.equal(n.s.network.providerCalls.length, 0);
  assert.equal(n.s.network.tavilyCalls.length, 0);
  assert.equal(await reservations(n.tripId), 0, "deterministic turns neither count against nor wait on the hourly allowance");
}));

test("Unrelated conversation never reaches the resolver, even with it enabled; voice and lodging questions take the ordinary path", { skip }, () => withNative(async n => {
  await withResolver(cheapest, async requests => {
    await n.say("Find lodging options for the group");
    const before = n.s.network.providerCalls.length, reserved = await reservations(n.tripId);
    for (const text of ["What time should we leave on Friday?", "Where should the family eat dinner around 5 p.m.?", "Thanks, that helps."]) {
      const reply = await n.say(text);
      assert.equal(reply.body.status, "completed", text);
      assert.ok(!hasProposal(reply.body), text);
    }
    const voice = await n.s.post({ commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "voice", voice: { sessionId: "session-test", delegationId: randomUUID() }, text: "Take the cheaper one" });
    assert.equal(voice.status, 200);
    assert.equal(requests.length, 0, "no resolver call: unrelated conversation pays only for its own answer, and a resolver failure could not block it");
    assert.equal(n.s.network.providerCalls.length, before + 4, "each was answered once by the ordinary coordinator");
    assert.equal(await reservations(n.tripId), reserved + 4, "one reservation each, as before");
  });
}));

test("The resolver needs only the rollout switches, never an entitlement, and still not organizer authority; one resolver attempt is one reservation", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  await withResolver(cheapest, async requests => {
    const research = await n.say("Find lodging options for the group");
    assert.equal(research.body.capability, "research");
    assert.equal(requests.length, 0, "the phrase rules claimed that request: no model call");
    assert.equal(await reservations(n.tripId), 0);

    const traveler = await n.s.post({ commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text", text: "Take the cheaper one" }, trip.travelerId);
    assert.equal(traveler.status, 403, "a traveler cannot use the organizer coordinator");
    assert.equal(requests.length, 0);

    const paraphrase = await n.say("Take the cheaper one");
    assert.equal(paraphrase.body.capability, "propose_trip_change", JSON.stringify(paraphrase.body.durableAnswer));
    assert.equal(requests.length, 1, "exactly one resolver call");
    assert.equal(await reservations(n.tripId), 1, "reserved once, right before the resolver");

    const fallback = await n.say("Go with the cozy cabin");
    assert.equal(requests.length, 2, "a choice the phrase rules cannot resolve gets one resolver call");
    assert.equal(await reservations(n.tripId), 2, "and that attempt reserves exactly one slot");
    assert.equal(fallback.status, 200);
    assert.equal(n.s.network.providerCalls.length, 0, "no ordinary coordinator call on these turns");
  });
}));

test("Only an actual request is claimed: questions, negations, hedges, reports, quotations and mixed requests are ordinary conversation, and the resolver never sees them", { skip }, () => withNative(async n => {
  await withResolver(cheapest, async requests => {
    const polite = await n.say("Can you find us a place to stay?");
    assert.equal(polite.body.capability, "research", "a polite request is a request");
    for (const text of ["Don't choose option 2", "Why did you choose option 2?", "Should we go with option 2?", "Robin said \"go with option 2\"", "Taylor suggested we go with option 2",
      "Maybe go with option 2 later", "Find lodging and tell me who hasn't confirmed", "Go with option 1. Also, who is driving?", "Which cabin is cheapest?", "Not option 2, go with option 3"]) {
      const before = n.s.network.providerCalls.length;
      const reply = await n.say(text);
      assert.equal(reply.body.status, "completed", text);
      assert.ok(!hasProposal(reply.body), `${text}: no proposal`);
      assert.equal((await shortlists(n.tripId)).length, 1, `${text}: no lodging shortlist`);
      assert.equal(n.s.network.providerCalls.length, before + 1, `${text}: the ordinary coordinator answered`);
    }
    assert.equal(requests.length, 0, "none of them reached the resolver");
    assert.equal((await shortlists(n.tripId)).length, 1);
    const second = await n.say("Let's go with the second one");
    assert.equal(second.body.capability, "propose_trip_change");
    assert.equal((await intentOf(n, second.body.turnId)).optionId, "harbor-house", "the second option of the shortlist shown here");
  });
}));

test("An open artifact does not block lodging help: research and a choice work while a draft is selected in the conversation", { skip }, () => withNative(async n => {
  n.s.next.reply = "I've drafted a question for review.";
  n.s.next.extra = { operations: [{ kind: "add_question", prompt: "Which restaurant?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const poll = await n.say("Make a poll asking the group where to eat on Saturday");
  const draft = poll.body.artifacts.find((item: Body) => item.kind === "poll_draft");
  assert.ok(draft, JSON.stringify(poll.body).slice(0, 300));
  n.s.next.extra = {};
  const artifact = { artifact: { kind: "draft", id: draft.id, version: 1, selection: "selected" } };
  const research = await n.say("Find us somewhere to stay", undefined, { command: artifact });
  assert.equal(research.status, 200, JSON.stringify(research.body).slice(0, 300));
  assert.equal(research.body.capability, "research");
  const choice = await n.say("Go with option 1", undefined, { command: artifact });
  assert.equal(choice.body.capability, "propose_trip_change", JSON.stringify(choice.body.durableAnswer));
  const drafts = (await n.s.thread(n.threadId)).drafts;
  assert.equal(drafts.find((item: Body) => item.id === draft.id).version, 1, "the open draft was not edited");
}));

test("A choice binds to the shortlist this conversation shows, never another conversation's; a newer list from someone else is clarified before a number is used", { skip }, () => withNative(async n => {
  const { trip } = n.s, threadB = randomUUID(), threadC = randomUUID();
  const here = await n.say("Find lodging options for the group");
  await n.say("Find lodging options for the group", trip.coOrganizerId, { threadId: threadB });
  const bound = await n.say("Go with option 2");
  assert.equal(bound.body.capability, "propose_trip_change");
  assert.equal((await intentOf(n, bound.body.turnId)).researchCommandId, here.body.commandId, "bound to this conversation's shortlist, not Robin's newer one elsewhere");
  const elsewhere = await n.say("Go with option 2", undefined, { threadId: threadC });
  assert.match(elsewhere.body.durableAnswer, /don’t have a lodging shortlist in this conversation/);
  assert.ok(!hasProposal(elsewhere.body));

  const robin = await n.say("Find lodging options for the group", trip.coOrganizerId);
  const ambiguous = await n.say("Go with option 2");
  assert.match(ambiguous.body.durableAnswer, /newer shortlist from Robin Synthetic/);
  assert.ok(!hasProposal(ambiguous.body), "a number is not guessed between lists");
  const named = await n.say("Go with the Harbor House");
  assert.equal(named.body.capability, "propose_trip_change");
  assert.equal((await intentOf(n, named.body.turnId)).researchCommandId, robin.body.commandId, "a name binds to the newest list shown here");
  const again = await n.say("Go with option 3");
  assert.equal(again.body.capability, "propose_trip_change", "once the organizer has spoken after it, the newest list is the one they saw");
}));

// --- B. Authority, privacy and transaction boundaries -------------------------------------------------------------------------------------------

test("Journey: the intent is saved with the proposal, no brief exists before the receipt, and apply returns the brief attributed to the real approver", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  await n.constraint(trip.travelerId, { kind: "max_nightly_cents", text: "Under $450 a night", value: 45_000 });
  await n.constraint(trip.organizerId, { kind: "min_bedrooms", text: "At least three bedrooms", value: 3 });
  await n.constraint(trip.travelerId, { kind: "note", text: CANARY, audience: `private:${trip.travelerId}` });
  const parked = await prepare(n);

  const pending = proposalIn(await n.s.thread(n.threadId), parked.turnId);
  assert.equal(pending.state, "pending");
  assert.equal(pending.preparation.intent.nextAction, "prepare_lodging_brief");
  assert.equal(pending.preparation.intent.schemaVersion, 1);
  assert.equal(pending.preparation.intent.stay.name, "Synthetic Dune Lodge", "the first option within $450 a night and three bedrooms");
  assert.equal(pending.preparation.outcome, null, "no brief before the canonical receipt");
  assert.equal((await continuations(n.tripId)).length, 0);
  assert.deepEqual(await stayNames(n.tripId), ["Synthetic Peak Lodge"], "preparing saved no stay");
  await n.constraint(trip.travelerId, { kind: "note", text: `${CANARY} again`, audience: `private:${trip.travelerId}` });

  const before = await turnCount(n.tripId);
  const applied = await n.act(parked.turnId, trip.coOrganizerId);
  assert.equal(applied.status, 200, JSON.stringify(applied.body).slice(0, 400));
  const proposal = proposalIn(applied.body, parked.turnId);
  assert.equal(proposal.state, "applied");
  const outcome = proposal.preparation.outcome;
  assert.equal(outcome.status, "prepared", "the apply response itself carries the brief; no reload is needed");
  assert.equal(outcome.brief.preparationOnly, true);
  assert.match(outcome.brief.statement, /Nothing has been booked/);
  assert.equal(outcome.brief.selectedOption.synthetic, true, "fixture provenance is carried into the brief");
  assert.ok(outcome.brief.missingInformation.some((line: string) => /synthetic fixture evidence/.test(line)));
  assert.equal(outcome.brief.approvalBasis.approvedByName, "Robin Synthetic", "the person who applied, not the person who asked");
  assert.equal(outcome.brief.approvalBasis.approvedByPersonId, trip.coOrganizerId);
  assert.equal(outcome.brief.approvalBasis.approvedAt, proposal.receipt.at, "bound to the canonical receipt");
  assert.equal(outcome.brief.approvalBasis.proposalTurnId, parked.turnId);
  assert.deepEqual(outcome.brief.constraintsApplied, ["Under $450 a night", "At least three bedrooms"]);
  assert.equal(outcome.approvedSnapshot.stay.id, proposal.receipt.stayId);
  assert.equal(await turnCount(n.tripId), before, "no turn was added: there is no invented human message and no follow-up turn");
  assert.deepEqual(await stayNames(n.tripId), ["Synthetic Dune Lodge", "Synthetic Peak Lodge"]);
  const audit = await continuations(n.tripId);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actorType, "commons", "the follow-up is recorded as Commons activity");

  const reloaded = proposalIn(await n.s.thread(n.threadId, trip.organizerId), parked.turnId);
  assert.deepEqual(reloaded.preparation.outcome, outcome, "a later read by the other organizer returns the same saved brief and is not a new approval");
  for (const payload of [applied.body, await n.s.thread(n.threadId)]) assert.ok(!JSON.stringify(payload).includes(CANARY), "no private canary in anything shared");
  assert.equal(n.s.network.providerCalls.length, 0, "no model call anywhere on this path");
}));

test("A shared proposal stays appliable by a current organizer after the requester is demoted; the requester's private material never becomes shared", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  // This current organizer is explicitly pilot; the demoted requester must still fail organizer authorization.
  await withTestDatabase(db => db.insert(eventCreationAccess).values({ personId: trip.coOrganizerId, requesterEmail: "robin@example.invalid", status: "approved", decidedAt: new Date() }));
  await n.constraint(trip.organizerId, { kind: "note", text: CANARY, audience: `private:${trip.organizerId}` });
  const parked = await prepare(n);
  await withTestDatabase(db => db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, n.tripId), eq(memberships.personId, trip.organizerId))));
  assert.equal((await n.act(parked.turnId, trip.organizerId)).status, 403, "the demoted requester cannot apply");
  const applied = await n.act(parked.turnId, trip.coOrganizerId);
  assert.equal(applied.status, 200, JSON.stringify(applied.body).slice(0, 300));
  const outcome = proposalIn(applied.body, parked.turnId).preparation.outcome;
  assert.equal(outcome.status, "prepared");
  assert.equal(outcome.brief.approvalBasis.approvedByPersonId, trip.coOrganizerId, "approval is the current organizer's, revalidated now");
  assert.ok(!JSON.stringify(applied.body).includes(CANARY), "the requester's private constraint is not in the proposal, brief or conversation");
  const traveler = await n.s.thread(n.threadId, trip.travelerId);
  assert.ok(!JSON.stringify(traveler).includes("preparation") && !JSON.stringify(traveler).includes(CANARY), "a participant cannot read the organizer thread or its brief");
}));

test("Duplicate and concurrent apply: one stay, one receipt and one brief; a lost response is recovered by repeating the same command", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  const first = await prepare(n);
  const commandId = randomUUID();
  const [a, b] = await Promise.all([n.act(first.turnId, trip.organizerId, { commandId }), n.act(first.turnId, trip.organizerId, { commandId })]);
  assert.deepEqual([a.status, b.status], [200, 200], "the same command twice at once is one apply");
  const again = await n.act(first.turnId, trip.organizerId, { commandId });
  assert.equal(again.status, 200, "repeating after a lost response is answered from the command ledger");
  assert.deepEqual(proposalIn(again.body, first.turnId).preparation.outcome, proposalIn(a.body, first.turnId).preparation.outcome, "the same artifact, not a new one");
  assert.equal((await continuations(n.tripId)).length, 1);
  assert.equal((await n.act(first.turnId, trip.organizerId, { commandId, action: "dismiss_trip" })).status, 409, "the same command id with different content conflicts");

  const second = await prepare(n, "Go with option 2");
  const results = await Promise.all([n.act(second.turnId, trip.organizerId), n.act(second.turnId, trip.coOrganizerId)]);
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409], "two different commands: exactly one applies");
  const winner = results.find(item => item.status === 200)!;
  assert.equal(proposalIn(winner.body, second.turnId).preparation.outcome.brief.approvalBasis.approvedByName, proposalIn(winner.body, second.turnId).receipt.appliedBy, "attributed to whichever apply committed");
  assert.equal((await continuations(n.tripId)).length, 2, "one outcome per applied proposal version");
  assert.equal((await stayNames(n.tripId)).length, 3);
}));

test("Wrong trip, a traveler and a revoked organizer cannot apply; nothing is saved and no brief exists", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  const parked = await prepare(n);
  const other = await seedSyntheticTrip();
  try {
    assert.ok([403, 404].includes((await n.act(parked.turnId, other.organizerId)).status), "another trip's organizer, on this trip");
    assert.ok([403, 404, 409].includes((await n.act(parked.turnId, other.organizerId, { slug: other.eventId })).status), "this turn, on another trip");
  } finally { await other.cleanup(); }
  assert.equal((await n.act(parked.turnId, trip.travelerId)).status, 403, "a traveler is not an organizer");
  await withTestDatabase(db => db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, n.tripId), eq(memberships.personId, trip.coOrganizerId))));
  assert.equal((await n.act(parked.turnId, trip.coOrganizerId)).status, 403, "a revoked organizer");
  assert.deepEqual(await stayNames(n.tripId), ["Synthetic Peak Lodge"]);
  assert.equal((await continuations(n.tripId)).length, 0);
  assert.equal((await storedProposal(parked.turnId)).state, "pending");
  const control = await n.act(parked.turnId, trip.organizerId);
  assert.equal(proposalIn(control.body, parked.turnId).preparation.outcome.status, "prepared", "the remaining organizer still can");
}));

test("A shared constraint change before apply is a typed refusal with nothing saved; a stale version is refused; a fresh shortlist then applies", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  await n.constraint(trip.travelerId, { kind: "max_nightly_cents", text: "Under $450 a night", value: 45_000 });
  const parked = await prepare(n);
  await n.constraint(trip.travelerId, { kind: "max_nightly_cents", text: "Our budget dropped: $300 a night at most", value: 30_000 });
  const refused = await n.act(parked.turnId, trip.organizerId);
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "lodging_review_stale");
  assert.match(refused.body.error, /Nothing was saved/);
  assert.deepEqual(await stayNames(n.tripId), ["Synthetic Peak Lodge"]);
  assert.equal((await storedProposal(parked.turnId)).state, "pending", "still visible, never silently applied with substituted inputs");
  assert.equal((await continuations(n.tripId)).length, 0);

  const stale = await n.say("Go with option 1");
  assert.match(stale.body.durableAnswer, /researched again and did not prepare anything/, "choosing from the old shortlist re-researches and prepares nothing");
  assert.equal(stale.body.capability, "research");
  const fresh = await n.say("Go with option 1");
  assert.equal(fresh.body.capability, "propose_trip_change");
  const wrongVersion = await n.act(fresh.body.turnId, trip.organizerId, { expectedVersion: 2 });
  assert.equal(wrongVersion.status, 409, "a version the review never had is refused");
  const applied = await n.act(fresh.body.turnId, trip.organizerId);
  const outcome = proposalIn(applied.body, fresh.body.turnId).preparation.outcome;
  assert.equal(outcome.brief.selectedOption.name, "Synthetic Pine Cabin", "the option within the new $300 cap");
}));

test("Review edits: a superseded version cannot be applied; an option edit keeps the applied stay with an honest unavailable outcome; a traveler-only edit still prepares one", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  const edited = await prepare(n);
  const proposal = proposalIn(await n.s.thread(n.threadId), edited.turnId);
  const revised = await n.act(edited.turnId, trip.organizerId, { action: "revise_trip", changes: { ...proposal.changes, stay: { ...proposal.changes.stay, name: "A different cabin" } } });
  assert.equal(revised.status, 200);
  assert.equal((await n.act(edited.turnId, trip.organizerId, { expectedVersion: 1 })).status, 409, "the superseded version 1 cannot be applied");
  assert.equal((await continuations(n.tripId)).length, 0, "and it produced no brief");
  const applied = await n.act(edited.turnId, trip.organizerId, { expectedVersion: 2 });
  const outcome = proposalIn(applied.body, edited.turnId).preparation.outcome;
  assert.deepEqual([outcome.status, outcome.reason], ["unavailable", "edited_in_review"]);
  assert.ok((await stayNames(n.tripId)).includes("A different cabin"), "the reviewed stay is applied regardless");

  const scoped = await prepare(n, "Go with option 2");
  const second = proposalIn(await n.s.thread(n.threadId), scoped.turnId);
  await n.act(scoped.turnId, trip.organizerId, { action: "revise_trip", changes: { ...second.changes, includedPersonIds: [trip.organizerId, trip.travelerId] } });
  const brief = proposalIn((await n.act(scoped.turnId, trip.organizerId, { expectedVersion: 2 })).body, scoped.turnId).preparation.outcome.brief;
  assert.deepEqual(brief.travelers.map((person: Body) => person.personId).sort(), [trip.organizerId, trip.travelerId].sort(), "the reviewed traveler scope, not the prepared one");
  assert.equal(brief.approvalBasis.version, 2);
}));

test("A stay edited or deleted after approval marks the brief out of date on read; it is never rebuilt, and a repeated apply returns the original", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  const parked = await prepare(n);
  const commandId = randomUUID();
  const applied = proposalIn((await n.act(parked.turnId, trip.organizerId, { commandId })).body, parked.turnId);
  assert.equal(applied.preparation.outcome.staleSinceApproval, undefined);
  await withTestDatabase(db => db.update(stays).set({ totalCents: 1 }).where(eq(stays.id, applied.receipt.stayId)));
  const read = proposalIn(await n.s.thread(n.threadId), parked.turnId).preparation.outcome;
  assert.equal(read.staleSinceApproval, true);
  assert.equal(read.brief.selectedOption.totalCents, applied.preparation.outcome.brief.selectedOption.totalCents, "the brief still shows what was approved");
  assert.equal((await storedProposal(parked.turnId)).preparation.outcome.staleSinceApproval, undefined, "reading never writes");
  const repeated = await n.act(parked.turnId, trip.organizerId, { commandId });
  assert.equal(repeated.status, 200);
  assert.equal((await continuations(n.tripId)).length, 1, "no regeneration under the original approval");
  await withTestDatabase(db => db.delete(stays).where(eq(stays.id, applied.receipt.stayId)));
  assert.equal(proposalIn(await n.s.thread(n.threadId), parked.turnId).preparation.outcome.staleSinceApproval, true, "a deleted stay too");
}));

test("A death before commit rolls back the stay, receipt and brief together; retrying the same command applies once", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  const parked = await prepare(n);
  const commandId = randomUUID();
  const { actOnAuthenticatedCoordinatorWorkspace } = await import("./polls");
  actAs(trip.organizerId);
  await assert.rejects(actOnAuthenticatedCoordinatorWorkspace(n.tripId, { turnId: parked.turnId, threadId: n.threadId, commandId, action: "apply_trip", expectedVersion: 1 },
    { lodgingCrashPoint: () => { throw new Error("simulated death before commit"); } }), /simulated death/);
  assert.deepEqual(await stayNames(n.tripId), ["Synthetic Peak Lodge"], "no stay");
  const stored = await storedProposal(parked.turnId);
  assert.deepEqual([stored.state, stored.receipt, stored.preparation.outcome], ["pending", null, null], "no receipt and no brief");
  assert.equal((await continuations(n.tripId)).length, 0);
  assert.equal((await withTestDatabase(db => db.select().from(processedCommands).where(and(eq(processedCommands.commonsId, n.tripId), eq(processedCommands.commandId, commandId))))).length, 0, "the command id is free to retry");
  const retried = await n.act(parked.turnId, trip.organizerId, { commandId });
  assert.equal(proposalIn(retried.body, parked.turnId).preparation.outcome.status, "prepared");
  assert.equal((await continuations(n.tripId)).length, 1);
}));

test("Dismissal closes the review with no outcome and no brief; it cannot be applied afterwards", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  const parked = await prepare(n);
  const dismissed = await n.act(parked.turnId, trip.organizerId, { action: "dismiss_trip" });
  const proposal = proposalIn(dismissed.body, parked.turnId);
  assert.deepEqual([proposal.state, proposal.preparation.outcome], ["dismissed", null]);
  assert.equal((await n.act(parked.turnId, trip.coOrganizerId)).status, 409);
  assert.deepEqual(await stayNames(n.tripId), ["Synthetic Peak Lodge"]);
  assert.equal((await continuations(n.tripId)).length, 0);
}));

test("Flag off after preparation: the proposal still applies and records that the follow-up was unavailable; new lodging requests use the ordinary coordinator", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  const parked = await prepare(n);
  process.env.COMMONS_NATIVE_LODGING_ENABLED = "false";
  const applied = await n.act(parked.turnId, trip.organizerId);
  const proposal = proposalIn(applied.body, parked.turnId);
  assert.equal(proposal.state, "applied", "the human decision is kept");
  assert.deepEqual([proposal.preparation.outcome.status, proposal.preparation.outcome.reason], ["unavailable", "not_enabled"]);
  assert.equal((await continuations(n.tripId)).length, 1, "the unavailable outcome is recorded once too");
  const ordinary = await n.say("Find lodging options for the group");
  assert.equal(ordinary.status, 200);
  assert.ok(n.s.network.providerCalls.length > 0, "routed to the existing coordinator");
  assert.equal((await shortlists(n.tripId)).length, 1, "only the shortlist made while enrolled");
}));

test("Trip constraints: reusing a command id with different content conflicts; another person's private audience is refused", { skip }, () => withNative(async n => {
  const { trip } = n.s, commandId = randomUUID();
  await n.constraint(trip.travelerId, { kind: "note", text: "Quiet street" }, commandId);
  await n.constraint(trip.travelerId, { kind: "note", text: "Quiet street" }, commandId);
  await assert.rejects(n.constraint(trip.travelerId, { kind: "note", text: "Near the lifts" }, commandId), /conflict/);
  await assert.rejects(n.constraint(trip.travelerId, { kind: "note", text: CANARY, audience: `private:${trip.organizerId}` }), /audience_forbidden/);
}));

// --- C. Bounded resolver --------------------------------------------------------------------------------------------------------------------

test("Resolver: the cheapest saved option becomes the usual pending proposal; only public shortlist fields reach the model", { skip }, () => withNative(async n => {
  const { trip } = n.s;
  await n.constraint(trip.travelerId, { kind: "note", text: CANARY, audience: `private:${trip.travelerId}` });
  await n.constraint(trip.organizerId, { kind: "note", text: `${CANARY}-organizer`, audience: `private:${trip.organizerId}` });
  await withResolver(cheapest, async requests => {
    await n.say("Find lodging options for the group");
    const choice = await n.say("Take the cheaper one");
    assert.equal(choice.body.capability, "propose_trip_change", JSON.stringify(choice.body.durableAnswer));
    assert.equal(requests.length, 1);
    assert.ok(!requests[0].includes(CANARY) && !requests[0].includes("private") && !requests[0].includes("Taylor") && !requests[0].includes("Casey"), "no private constraint or person in the prompt");
    const sent = JSON.parse(JSON.parse(requests[0]).messages[1].content);
    assert.deepEqual(Object.keys(sent).sort(), ["message", "shortlist"]);
    assert.deepEqual(Object.keys(sent.shortlist[0]).sort(), ["bedrooms", "id", "name", "nightlyUsd", "totalUsd"]);
    const name = [...sent.shortlist].sort((a: Body, b: Body) => a.totalUsd - b.totalUsd)[0].name;
    const proposal = proposalIn(await n.s.thread(n.threadId), choice.body.turnId);
    assert.deepEqual([proposal.state, proposal.preparation.intent.stay.name, proposal.changes.stay.name], ["pending", name, name]);
    assert.deepEqual(await stayNames(n.tripId), ["Synthetic Peak Lodge"], "nothing saved before a human applies");
  });
}));

test("Resolver: invented ids, ambiguity, unsupported output, timeouts and failures are truthful answers with no proposal, no fallback call and no trip change", { skip }, () => withNative(async n => {
  await n.say("Find lodging options for the group");
  const cases: Array<[string, ResolverScript, RegExp]> = [
    ["invented id", () => ({ intent: "choose", optionId: "not-in-the-shortlist", needsClarification: false }), /Which option would you like\? I don’t have an option/],
    ["ambiguity", () => ({ intent: "choose", optionId: null, needsClarification: true }), /Which option would you like\? 1\. Synthetic/],
    ["approve attempt", () => ({ intent: "choose", optionId: "dune-lodge", needsClarification: false, approve: true, apply: true }), /couldn’t work out what you meant/],
    ["unsupported intent", () => ({ intent: "book", optionId: "dune-lodge", needsClarification: false }), /couldn’t work out what you meant/],
    ["malformed", () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{not json" } }] }), { status: 200 }), /couldn’t work out what you meant/],
    ["provider error", () => new Response("{}", { status: 500 }), /couldn’t work out what you meant/],
    ["truncated", () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }), { status: 200 }), /couldn’t work out what you meant/],
  ];
  for (const [label, script, answer] of cases) {
    await withResolver(script, async requests => {
      const before = n.s.network.providerCalls.length;
      const reply = await n.say("Let's do the fanciest one");
      assert.equal(reply.body.status, "completed", label);
      assert.match(reply.body.durableAnswer, answer, label);
      assert.ok(!hasProposal(reply.body), `${label}: no proposal`);
      assert.equal(requests.length, 1, `${label}: exactly one resolver call`);
      assert.equal(n.s.network.providerCalls.length, before, `${label}: no hidden fallback to the ordinary coordinator`);
    });
  }
  assert.deepEqual(await stayNames(n.tripId), ["Synthetic Peak Lodge"], "model output never changed a trip record");
  assert.equal((await continuations(n.tripId)).length, 0);
}));

test("Resolver: a timeout is unavailable after one call; a lodging comment the resolver calls `other` reaches the ordinary coordinator once under one reservation", { skip }, async () => {
  const { resolveLodgingRequest } = await import("./lodging/resolve");
  await withNative(async n => {
    await n.say("Find lodging options for the group");
    let calls = 0;
    // A provider that never answers. The interval keeps the event loop alive the way a real open socket would; AbortSignal.timeout alone does not.
    const hanging: typeof fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => { calls += 1; const alive = setInterval(() => {}, 1_000);
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { clearInterval(alive); reject(init.signal!.reason); })); }) as typeof fetch;
    process.env.COMMONS_NATIVE_LODGING_MODEL_RESOLVE = "true";
    try {
      const outcome = await resolveLodgingRequest("Let's do the fanciest one", [], { fetcher: hanging, timeoutMs: 50 });
      assert.deepEqual([outcome, calls], [{ status: "unavailable", reason: "failed" }, 1]);
    } finally { delete process.env.COMMONS_NATIVE_LODGING_MODEL_RESOLVE; }
    await withResolver(() => ({ intent: "other", optionId: null, needsClarification: false }), async requests => {
      const before = n.s.network.providerCalls.length, reserved = await reservations(n.tripId);
      const other = await n.say("The Dune Lodge looks lovely in the photos");
      assert.equal(other.body.status, "completed");
      assert.equal(requests.length, 1);
      assert.equal(n.s.network.providerCalls.length, before + 1, "the ordinary coordinator answered once");
      assert.equal(await reservations(n.tripId), reserved + 1, "resolver and ordinary answer share one reservation");
    });
  });
});

test("Resolver: a stale shortlist is re-researched and nothing is prepared, even when the model resolves an option", { skip }, () => withNative(async n => {
  await n.say("Find lodging options for the group");
  await n.constraint(n.s.trip.travelerId, { kind: "max_nightly_cents", text: "Under $300 a night", value: 30_000 });
  await withResolver(shortlist => ({ intent: "choose", optionId: shortlist[0].id, needsClarification: false }), async () => {
    const choice = await n.say("Let's go for the roomy one");
    assert.ok(!hasProposal(choice.body), "no proposal from a stale shortlist");
    assert.match(choice.body.durableAnswer, /changed since that shortlist/);
  });
}));

test("Missing or incomplete dates: phrase and resolver paths give a completed question with no search, shortlist or intent; saving dates restores the journey", { skip }, () => withNative(async n => {
  // A shortlist made while dates existed, so the choose paths have something to go stale.
  await n.say("Find lodging options for the group");
  assert.equal((await shortlists(n.tripId)).length, 1);
  for (const [startsOn, endsOn] of [[null, null], ["2027-02-12", null], [null, "2027-02-15"]] as const) {
    await setDates(n.tripId, startsOn, endsOn);
    const phrase = await n.say("Find lodging options for the group");
    assert.equal(phrase.body.status, "completed", `${startsOn}/${endsOn}`);
    assert.match(phrase.body.durableAnswer, /^Which dates should I look for\?/);
    assert.ok(!phrase.body.capability || phrase.body.capability === "answer");
    assert.equal(phrase.body.artifacts.length, 0, "no research artifact and no proposal");
    const choose = await n.say("Go with option 1");
    assert.match(choose.body.durableAnswer, /^Which dates should I look for\?/, "a choice from the now-stale shortlist asks for dates instead of researching");
    assert.ok(!hasProposal(choose.body));
    await withResolver(() => ({ intent: "research", optionId: null, needsClarification: false }), async requests => {
      const resolved = await n.say("Could you sort out some lodging for us?");
      assert.equal(requests.length, 1);
      assert.match(resolved.body.durableAnswer, /^Which dates should I look for\?/);
      assert.equal(resolved.body.artifacts.length, 0);
    });
    await withResolver(cheapest, async () => {
      const resolvedChoice = await n.say("Take the cheaper one");
      assert.match(resolvedChoice.body.durableAnswer, /^Which dates should I look for\?/);
      assert.ok(!hasProposal(resolvedChoice.body));
    });
  }
  assert.equal((await shortlists(n.tripId)).length, 1, "no shortlist was researched without dates");
  assert.equal(n.s.network.tavilyCalls.length, 0);
  assert.deepEqual(await stayNames(n.tripId), ["Synthetic Peak Lodge"]);

  await setDates(n.tripId, "2027-02-12", "2027-02-15");
  const retried = await n.say("Find lodging options for the group");
  assert.equal(retried.body.capability, "research", "after dates are saved the normal journey resumes");
  const chosen = await n.say("Go with option 1");
  assert.equal(chosen.body.capability, "propose_trip_change");
}));

test("Missing dates: the phrase path asks for dates with no model call and no reservation", { skip }, () => withNative(async n => {
  await setDates(n.tripId, null, null);
  const asked = await n.say("Find lodging options for the group");
  assert.match(asked.body.durableAnswer, /^Which dates should I look for\?/);
  assert.equal(n.s.network.providerCalls.length, 0);
  assert.equal(await reservations(n.tripId), 0);
  assert.equal((await shortlists(n.tripId)).length, 0);
}));

test("Alternative and mixed requests stay on the ordinary path without selecting lodging", { skip }, () => withNative(async n => {
  await n.say("Find lodging options for the group");
  await withResolver(cheapest, async requests => {
    for (const text of ["Go with option 1 or option 2", "Go with option 1 and find a restaurant", "Go with option 1\nFind a restaurant"]) {
      const before = n.s.network.providerCalls.length;
      const reply = await n.say(text);
      assert.equal(reply.body.status, "completed");
      assert.equal(hasProposal(reply.body), false);
      assert.equal(n.s.network.providerCalls.length, before + 1);
    }
    assert.equal(requests.length, 0);
    assert.equal((await shortlists(n.tripId)).length, 1);
    assert.equal(await reservations(n.tripId), 3);
  });
}));

test("Unrelated comparisons never reach the lodging resolver, even when it would fail", { skip }, () => withNative(async n => {
  await n.say("Find lodging options for the group");
  await withResolver(() => new Response("unavailable", { status: 503 }), async requests => {
    const reply = await n.say("What is the cheapest way to get to the airport?");
    assert.equal(requests.length, 0);
    assert.equal(reply.body.status, "completed");
    assert.doesNotMatch(reply.body.durableAnswer, /name the lodging option/);
    assert.equal(n.s.network.providerCalls.length, 1);
    assert.equal(await reservations(n.tripId), 1);
  });
}));

test("Currency changes invalidate the approved brief without rewriting its saved outcome", { skip }, () => withNative(async n => {
  const parked = await prepare(n);
  const applied = await n.act(parked.turnId, n.s.trip.organizerId);
  const proposal = proposalIn(applied.body, parked.turnId);
  await withTestDatabase(db => db.update(stays).set({ currency: "EUR" }).where(eq(stays.id, proposal.receipt.stayId)));
  const read = proposalIn(await n.s.thread(n.threadId), parked.turnId);
  assert.equal(read.preparation.outcome.staleSinceApproval, true);
  assert.equal(proposal.preparation.outcome.approvedSnapshot.stay.currency, "USD");
  assert.deepEqual((await storedProposal(parked.turnId)).preparation.outcome, proposal.preparation.outcome);
}));
