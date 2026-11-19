import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commons, coordinatorTurns, itineraryItems } from "@commons/database";
import { actAs, databaseTestsEnabled, eq, jsonRequest, params, withCoordinatorScenario, withTestDatabase, type ScenarioContext } from "./coordinator-route-harness";

// Production transcript, thread "Fly-fishing confirmation", replayed through the real /turns and PATCH route handlers, the real disposable database and a recording
// fake model. Message 1 was sent before the plan feature shipped, so it is answered with trip changes off; messages 2 and 3 are follow-ups that name no plan.
// The fake model replies with the phantom review-card text the real model produced. Nothing reaches a real provider, a voice session, or a remote database.
const skip = !databaseTestsEnabled;
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MESSAGE_1 = "We've confirmed fly fishing for 9 AM on 10/12. The guide (James)'s phone is 505-412-7380";
const MESSAGE_2 = "I want to change the activity status to confirmed";
const MESSAGE_3 = "Where is the card?";
const PHONE = "505-412-7380";
const PHANTOM_2 = "I can prepare that status change for review—my earlier statement was incorrect. Review and apply the suggested update to mark the Fly-fishing lesson confirmed based on your report; October 12 at 9 AM stays unchanged. Nothing is saved until you apply it.";
const PHANTOM_3 = "The current snapshot shows no pending review card—my earlier reply described an update, but there isn't one saved for review. I'm including the suggestion again here: review and apply it to mark the Fly-fishing lesson confirmed. October 12 at 9 AM stays unchanged.";
const PHANTOM = /Review and apply|suggested update|prepare that status change|including the suggestion|Nothing is saved until you apply it|review and apply it/i;
const OFF_TEXT = "Plan updates from chat are turned off right now. You can mark it confirmed in Plan. Nothing was changed.";
const NO_SUGGESTION = { operations: [], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: null, stayBookingUrl: null, stayStatus: null,
  planId: null, planTitle: null, planStatus: null, planStartsOn: null, planStartsTime: null, planNote: null, planContactLabel: null };
const voice = () => ({ inputMode: "voice", voice: { sessionId: "session-test", delegationId: randomUUID() } });
const inThread = (thread: { id: string; turnVersion: number }, text: string, over: Record<string, unknown> = {}) => ({ commandId: randomUUID(), target: { kind: "existing", threadId: thread.id, expectedTurnVersion: thread.turnVersion }, inputMode: "text", text, ...over });

// The one global switch: unset means trip changes are on for every trip; "false" turns them off. The harness restores the variable after each scenario.
const tripChanges = (on: boolean) => { if (on) delete process.env.COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED; else process.env.COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED = "false"; };

async function seedFixture(s: ScenarioContext, extra: Array<{ title: string; startsAt: string }> = []) {
  return withTestDatabase(async db => {
    await db.update(commons).set({ startsOn: "2027-10-10", endsOn: "2027-10-14" }).where(eq(commons.id, s.trip.eventId));
    const base = { commonsId: s.trip.eventId, timezone: "America/Denver", audience: "everyone" as const, provenanceLabel: "Added by Casey Synthetic" };
    const [fly] = await db.insert(itineraryItems).values({ ...base, title: "Fly-fishing lesson", startsAt: new Date("2027-10-12T15:00:00.000Z"), endsAt: new Date("2027-10-12T18:00:00.000Z"), status: "planned" }).returning();
    const more = extra.length ? await db.insert(itineraryItems).values(extra.map(item => ({ ...base, title: item.title, startsAt: new Date(item.startsAt), status: "planned" as const }))).returning() : [];
    return { fly, more };
  });
}
const item = (id: string) => withTestDatabase(async db => (await db.select().from(itineraryItems).where(eq(itineraryItems.id, id)))[0]);
const turnRow = (id: string) => withTestDatabase(async db => (await db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, id)))[0]);
const proposalOf = async (turnId: string) => (await turnRow(turnId)).workspace!.tripProposal!;
const proposalCount = (s: ScenarioContext) => withTestDatabase(async db => (await db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, s.trip.eventId))).filter(row => row.workspace?.tripProposal).length);
async function act(s: ScenarioContext, body: Record<string, unknown>) {
  actAs(s.trip.coOrganizerId);
  const response = await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", { commandId: randomUUID(), ...body }), params(s.trip.eventId));
  return { status: response.status, body: (await response.json()) as Body };
}

/** Message 1, before the feature: a plain answer on a trip where trip changes are off. Returns the thread. */
async function sendMessage1(s: ScenarioContext, over: Record<string, unknown> = {}) {
  s.next.title = "Fly-fishing confirmation";
  Object.assign(s.next, { reply: "Thanks, I’ve noted that in this conversation. I can’t change the activity status.", extra: { tripSuggestion: null } });
  const first = await s.post(s.command({ text: MESSAGE_1, ...over }));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.capability, "answer");
  assert.deepEqual(first.body.artifacts, []);
  assert.equal(first.body.thread.title, "Fly-fishing confirmation");
  return first;
}
async function send(s: ScenarioContext, thread: { id: string; turnVersion: number }, text: string, reply: string, over: Record<string, unknown> = {}, suggestion: Record<string, unknown> | null = null) {
  Object.assign(s.next, { reply, extra: { tripSuggestion: suggestion } });
  const result = await s.post(inThread(thread, text, over));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
}

for (const mode of ["text", "voice"] as const) {
  const over = () => (mode === "voice" ? voice() : {});

  test(`Fly-fishing transcript (${mode}), trip changes on: message 2 makes a real plan review, message 3 points to it, and no phantom text appears`, { skip }, () => withCoordinatorScenario(async s => {
    const { fly } = await seedFixture(s);
    tripChanges(false);
    const first = await sendMessage1(s, over());
    assert.equal(await proposalCount(s), 0);
    tripChanges(true);

    // Message 2: the plan is in message 1. The model has no suggestion and even repeats the phantom text; the review and the answer are made by code.
    const calls = s.network.providerCalls.length;
    const second = await send(s, first.body.thread, MESSAGE_2, PHANTOM_2, over());
    assert.equal(second.body.capability, "propose_trip_change");
    assert.equal(second.body.reviewRequired, true);
    assert.equal(second.body.artifacts[0].kind, "trip_change_proposal");
    assert.equal(s.network.providerCalls[calls].body.model, "test-mini-model", "structured extraction uses the cheap tier");
    const proposal = await proposalOf(second.body.turnId);
    assert.deepEqual([proposal.state, proposal.operations, proposal.version], ["pending", ["plan"], 1]);
    assert.deepEqual([proposal.base.plan?.id, proposal.base.plan?.status, proposal.base.plan?.startsOn, proposal.base.plan?.startsTime], [fly.id, "planned", "2027-10-12", "09:00"]);
    assert.deepEqual([proposal.changes.plan?.status, proposal.changes.plan?.startsOn, proposal.changes.plan?.startsTime, proposal.changes.plan?.note], ["confirmed", "2027-10-12", "09:00", null], "confirmed; the time and the note are unchanged");
    assert.equal(proposal.changes.plan?.contact?.include, false, "the contact from message 1 is an unchecked option");
    assert.match(proposal.changes.plan?.contact?.text ?? "", new RegExp(PHONE));
    assert.equal(proposal.source.includes(PHONE), false, "the number is not stored beside the proposal");
    const answer = second.body.durableAnswer as string;
    assert.match(answer, /^Ready to mark “Fly-fishing lesson” confirmed — check the card below\. The number you shared stays in this conversation unless you add it to the plan note\.$/);
    assert.doesNotMatch(answer, PHANTOM);
    assert.equal(answer.includes(PHONE), false);
    assert.doesNotMatch(second.body.spokenReply as string, PHANTOM);
    assert.equal((await item(fly.id)).status, "planned", "nothing is applied before review");
    assert.equal(await proposalCount(s), 1);

    // Message 3: a card already exists. It is pointed to and no second one is made, and the model is not asked.
    const before = s.network.providerCalls.length;
    const third = await send(s, second.body.thread, MESSAGE_3, PHANTOM_3, over());
    assert.equal(third.body.capability, "propose_trip_change");
    assert.deepEqual([third.body.artifacts, third.body.reviewRequired], [[], false]);
    assert.equal(third.body.durableAnswer, "A review to mark “Fly-fishing lesson” confirmed is already waiting — check the card on your earlier message.");
    assert.doesNotMatch(third.body.durableAnswer as string, PHANTOM);
    assert.equal(s.network.providerCalls.length, before, "no model call");
    assert.equal(await proposalCount(s), 1, "no duplicate proposal");
    assert.equal((await proposalOf(second.body.turnId)).state, "pending");

    // Apply it: the plan is confirmed as reported, the time and note unchanged.
    const applied = await act(s, { turnId: second.body.turnId, threadId: second.body.thread.id, action: "apply_trip", expectedVersion: 1 });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    const saved = await item(fly.id);
    assert.deepEqual([saved.status, saved.note, saved.startsAt!.toISOString()], ["confirmed", null, "2027-10-12T15:00:00.000Z"]);
  }));

  test(`Fly-fishing transcript (${mode}), no card exists: "Where is the card?" creates it once, and asking again does not duplicate it`, { skip }, () => withCoordinatorScenario(async s => {
    const { fly } = await seedFixture(s);
    tripChanges(false);
    const first = await sendMessage1(s, over());
    tripChanges(true);
    // Message 3 straight after message 1, with a suggestion from the model that names the contact.
    const third = await send(s, first.body.thread, MESSAGE_3, PHANTOM_3, over(), { ...NO_SUGGESTION, operations: ["plan"], planId: fly.id, planStatus: "confirmed", planContactLabel: "Guide James" });
    assert.equal(third.body.reviewRequired, true);
    assert.equal(third.body.artifacts[0].kind, "trip_change_proposal");
    const proposal = await proposalOf(third.body.turnId);
    assert.deepEqual([proposal.state, proposal.changes.plan?.status, proposal.changes.plan?.startsTime, proposal.changes.plan?.contact], ["pending", "confirmed", "09:00", { text: `Guide James, ${PHONE}`, include: false }]);
    assert.doesNotMatch(third.body.durableAnswer as string, PHANTOM);
    assert.match(third.body.durableAnswer as string, /^Ready to mark “Fly-fishing lesson” confirmed — check the card below\./);
    const again = await send(s, third.body.thread, "make the card", PHANTOM_3, over());
    assert.deepEqual(again.body.artifacts, []);
    assert.match(again.body.durableAnswer as string, /is already waiting — check the card on your earlier message\./);
    assert.equal(await proposalCount(s), 1);
    // Dismiss it: the next request makes a fresh one.
    const kept = await act(s, { turnId: third.body.turnId, threadId: third.body.thread.id, action: "dismiss_trip", expectedVersion: 1 });
    assert.equal(kept.status, 200, JSON.stringify(kept.body));
    const fresh = await send(s, again.body.thread, "go ahead and mark that confirmed", PHANTOM_2, over());
    assert.equal(fresh.body.reviewRequired, true, "a dismissed review is not a waiting one");
    assert.equal(await proposalCount(s), 2);
  }));

  test(`Fly-fishing transcript (${mode}), trip changes switched off: honest "turned off right now" text, no claims, no card`, { skip }, () => withCoordinatorScenario(async s => {
    const { fly } = await seedFixture(s);
    tripChanges(false);
    const first = await sendMessage1(s, over());
    const calls = s.network.providerCalls.length;
    const second = await send(s, first.body.thread, MESSAGE_2, PHANTOM_2, over());
    assert.equal(second.body.capability, "unsupported");
    assert.equal(second.body.durableAnswer, OFF_TEXT);
    assert.deepEqual([second.body.artifacts, second.body.reviewRequired], [[], false]);
    assert.doesNotMatch(second.body.durableAnswer as string, PHANTOM);
    assert.equal(s.network.providerCalls.length, calls, "no model call to describe a capability that is off");
    const third = await send(s, second.body.thread, MESSAGE_3, PHANTOM_3, over());
    assert.equal(third.body.durableAnswer, OFF_TEXT);
    assert.deepEqual(third.body.artifacts, []);
    assert.equal(await proposalCount(s), 0, "no card was created");
    assert.equal((await item(fly.id)).status, "planned");
    // The apply route refuses on this trip too.
    const applied = await act(s, { turnId: third.body.turnId, threadId: third.body.thread.id, action: "apply_trip", expectedVersion: 1 });
    assert.notEqual(applied.status, 200);
    // A message the router does not treat as a request still reaches the model, whose phantom text is cut and replaced by the same honest sentence.
    const phantom = await send(s, third.body.thread, "Is there a suggested update ready for fly fishing?", PHANTOM_2, over());
    assert.equal(phantom.body.capability, "answer");
    assert.deepEqual(phantom.body.artifacts, []);
    assert.doesNotMatch(phantom.body.durableAnswer as string, PHANTOM);
    assert.match(phantom.body.durableAnswer as string, /Plan updates from chat are turned off right now\. You can mark it confirmed in Plan\./);
    assert.equal(await proposalCount(s), 0);
  }));
}

test("Fly-fishing transcript, thread title only: with no plan in the recent messages the thread title names it, and the status must come from the request", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  tripChanges(true);
  s.next.title = "Fly-fishing confirmation";
  Object.assign(s.next, { reply: "Sounds good.", extra: { tripSuggestion: null } });
  const opener = await s.post(s.command({ text: "Let's sort out the guide for Saturday" }));
  const thread = opener.body.thread;
  assert.equal(thread.title, "Fly-fishing confirmation");
  // No status anywhere: one honest clarification, no card.
  const missing = await send(s, thread, "yes, update the status", PHANTOM_2);
  assert.equal(missing.body.capability, "propose_trip_change");
  assert.deepEqual(missing.body.artifacts, []);
  assert.match(missing.body.durableAnswer as string, /can’t tell what status you want for “Fly-fishing lesson”/);
  assert.equal(await proposalCount(s), 0);
  const marked = await send(s, missing.body.thread, "mark it confirmed", PHANTOM_2);
  assert.equal(marked.body.reviewRequired, true);
  const proposal = await proposalOf(marked.body.turnId);
  assert.deepEqual([proposal.base.plan?.id, proposal.changes.plan?.status, proposal.changes.plan?.contact], [fly.id, "confirmed", null], "no contact: none was in the thread");
}));

test("Fly-fishing transcript, ambiguity: two fishing plans get one clarification that names both, and no model call, card or change", { skip }, () => withCoordinatorScenario(async s => {
  const { fly, more } = await seedFixture(s, [{ title: "Fly-fishing float trip", startsAt: "2027-10-13T15:00:00.000Z" }]);
  tripChanges(false);
  const first = await sendMessage1(s);
  tripChanges(true);
  const calls = s.network.providerCalls.length;
  const second = await send(s, first.body.thread, MESSAGE_2, PHANTOM_2);
  assert.equal(second.body.capability, "propose_trip_change");
  assert.deepEqual([second.body.artifacts, second.body.reviewRequired], [[], false]);
  const answer = second.body.durableAnswer as string;
  assert.match(answer, /nothing to review and nothing was saved/);
  assert.match(answer, /More than one saved plan could match/);
  assert.match(answer, /“Fly-fishing lesson”/);
  assert.match(answer, /“Fly-fishing float trip”/);
  assert.doesNotMatch(answer, PHANTOM);
  assert.equal(s.network.providerCalls.length, calls);
  assert.equal(await proposalCount(s), 0);
  assert.deepEqual([(await item(fly.id)).status, (await item(more[0].id)).status], ["planned", "planned"]);
}));

test("Fly-fishing transcript, hedges: 'should we confirm it?' and similar wording are answered, never prepared, and a phantom card in the answer is cut", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  tripChanges(false);
  const first = await sendMessage1(s);
  tripChanges(true);
  let thread = first.body.thread;
  for (const text of ["Should we confirm it?", "maybe we should mark it confirmed", "Did we confirm it?", "I'll mark it confirmed tomorrow", "Is it confirmed?"]) {
    const result = await send(s, thread, text, "Fly fishing is saved as planned for 9 AM. Review and apply the suggested update to confirm it.");
    assert.equal(result.body.capability, "answer", text);
    assert.deepEqual([result.body.artifacts, result.body.reviewRequired], [[], false], text);
    assert.doesNotMatch(result.body.durableAnswer as string, PHANTOM, text);
    if (/^(Did|Is)\b/.test(text)) {
      assert.match(result.body.durableAnswer as string, /Fly-fishing lesson.*saved in Plan as planned, not confirmed/, text);
    } else {
      assert.match(result.body.durableAnswer as string, /Fly fishing is saved as planned for 9 AM\./, text);
      assert.match(result.body.durableAnswer as string, /I couldn’t prepare a (?:plan|trip) update from that, so there is no review card and nothing was saved\./, text);
    }
    thread = result.body.thread;
  }
  assert.equal(await proposalCount(s), 0);
  assert.equal((await item(fly.id)).status, "planned");
}));


test("Relative-date regression: null model suggestion still creates review; bare yes cannot save; old offer resumes from user evidence", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  await withTestDatabase(db => db.update(itineraryItems).set({ status: "confirmed", startsAt: new Date("2026-10-12T15:00:00Z"), endsAt: new Date("2026-10-12T18:00:00Z") }).where(eq(itineraryItems.id, fly.id)));
  const before = await item(fly.id);
  const request = "I'd like to move fly fishing up by a day";
  // Reproduce the earlier offer without a review, then enable the feature for the affirmative follow-up.
  tripChanges(false);
  Object.assign(s.next, { reply: "Would you like me to prepare that update for your review?", extra: { tripSuggestion: null } });
  const first = await s.post(s.command({ text: request }));
  assert.equal(first.status, 200);
  tripChanges(true);
  const made = await send(s, first.body.thread, "Yes", "I will prepare the plan update for your review.");
  assert.equal(made.body.capability, "propose_trip_change");
  assert.equal(made.body.reviewRequired, true);
  const proposal = await proposalOf(made.body.turnId);
  assert.deepEqual([proposal.base.plan?.startsOn, proposal.changes.plan?.startsOn, proposal.changes.plan?.startsTime, proposal.changes.plan?.status], ["2026-10-12", "2026-10-11", "09:00", "confirmed"]);
  assert.equal(proposal.source, `${request}\nYes`);
  assert.equal((await item(fly.id)).updatedAt.toISOString(), before.updatedAt.toISOString());
  const yes = await send(s, made.body.thread, "Yes", "Done.");
  assert.equal(yes.body.capability, "unsupported");
  assert.equal(await proposalCount(s), 1);
  assert.equal((await item(fly.id)).startsAt!.toISOString(), before.startsAt!.toISOString());
  const approved = await act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "apply_trip", expectedVersion: 1 });
  assert.equal(approved.status, 200);
  assert.deepEqual([(await item(fly.id)).startsAt!.toISOString(), (await item(fly.id)).endsAt!.toISOString()], ["2026-10-11T15:00:00.000Z", "2026-10-11T18:00:00.000Z"]);
}));
