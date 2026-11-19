import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { auditEvents, commons, coordinatorTurns, itineraryItems } from "@commons/database";
import { actAs, databaseTestsEnabled, eq, jsonRequest, params, withCoordinatorScenario, withTestDatabase, type ScenarioContext } from "./coordinator-route-harness";
import { aiEventProperties, observeAiCall, type AiGeneration } from "./ai-observability";
// Goals are on by default; these cases cover the Coordinator paths without them.
process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "false";

// Plan-item updates prepared from chat (design §20): real /turns and PATCH route handlers, the real disposable database, a recording fake model and a
// fake public search. Nothing here reaches a real provider, a voice session, or a remote database. Voice turns are the same command with inputMode "voice".
const skip = !databaseTestsEnabled;
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TRANSCRIPT = "We've confirmed fly fishing for 9 AM on 10/12. The guide (James)'s phone is 505-412-7380";
const PHONE = "505-412-7380";
/** Any spelling of the number. (Not just "505": ids in metrics are random hex and can contain it.) */
const leaks = (value: unknown) => /505\D{0,3}412\D{0,3}7380|4127380/.test(JSON.stringify(value));
const NO_SUGGESTION = { operations: [], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: null, stayBookingUrl: null, stayStatus: null,
  planId: null, planTitle: null, planStatus: null, planStartsOn: null, planStartsTime: null, planNote: null, planContactLabel: null };
const suggest = (over: Record<string, unknown>) => ({ ...NO_SUGGESTION, operations: ["plan"], ...over });
const inThread = (thread: { id: string; turnVersion: number }, text: string, over: Record<string, unknown> = {}) => ({ commandId: randomUUID(), target: { kind: "existing", threadId: thread.id, expectedTurnVersion: thread.turnVersion }, inputMode: "text", text, ...over });
const voice = () => ({ inputMode: "voice", voice: { sessionId: "session-test", delegationId: randomUUID() } });

/** Oct 12 9:00 AM Denver (MDT) is 15:00 UTC; the lesson runs three hours. */
async function seedFixture(s: ScenarioContext, extra: Array<{ title: string; startsAt: string; status?: "idea" | "planned" | "confirmed" | "cancelled"; note?: string }> = []) {
  return withTestDatabase(async db => {
    await db.update(commons).set({ startsOn: "2027-10-10", endsOn: "2027-10-14" }).where(eq(commons.id, s.trip.eventId));
    const base = { commonsId: s.trip.eventId, timezone: "America/Denver", audience: "everyone" as const, provenanceLabel: "Added by Casey Synthetic" };
    const [fly] = await db.insert(itineraryItems).values({ ...base, title: "Fly-fishing lesson", startsAt: new Date("2027-10-12T15:00:00.000Z"), endsAt: new Date("2027-10-12T18:00:00.000Z"), status: "planned" }).returning();
    const [sleigh] = await db.insert(itineraryItems).values({ ...base, title: "Sunset sleigh ride", startsAt: new Date("2027-10-13T00:00:00.000Z"), status: "planned", note: "Meet at the barn" }).returning();
    const more = extra.length ? await db.insert(itineraryItems).values(extra.map(item => ({ ...base, title: item.title, startsAt: new Date(item.startsAt), status: item.status ?? "planned", note: item.note ?? null }))).returning() : [];
    return { fly, sleigh, more };
  });
}
const item = (id: string) => withTestDatabase(async db => (await db.select().from(itineraryItems).where(eq(itineraryItems.id, id)))[0]);
const turnRow = (id: string) => withTestDatabase(async db => (await db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, id)))[0]);
const proposalOf = async (turnId: string) => (await turnRow(turnId)).workspace!.tripProposal!;

async function report(s: ScenarioContext, text: string, suggestion: Record<string, unknown> | null, reply = "I can prepare that plan update for review.", over: Record<string, unknown> = {}) {
  Object.assign(s.next, { reply, extra: { tripSuggestion: suggestion } });
  const result = await s.post(s.command({ text, ...over }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
}
async function act(s: ScenarioContext, body: Record<string, unknown>, personId = s.trip.coOrganizerId) {
  actAs(personId);
  const response = await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", { commandId: randomUUID(), ...body }), params(s.trip.eventId));
  return { status: response.status, body: (await response.json()) as Body };
}
const flySuggestion = (id: string, over: Record<string, unknown> = {}) => suggest({ planId: id, planStatus: "confirmed", planStartsOn: "2027-10-12", planStartsTime: "09:00", planContactLabel: "Guide James", ...over });

test("Production transcript, fly fishing: a review for the right item, confirmed as reported, time unchanged, the contact an unchecked option, nothing applied before review", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const before = await item(fly.id), calls = s.network.providerCalls.length;
  const result = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  assert.equal(result.body.capability, "propose_trip_change");
  assert.equal(s.network.providerCalls[calls].body.model, "test-mini-model", "structured extraction uses the cheap tier");
  assert.equal(result.body.reviewRequired, true);
  assert.equal(result.body.artifacts[0].kind, "trip_change_proposal");
  const proposal = await proposalOf(result.body.turnId);
  assert.deepEqual([proposal.state, proposal.operations, proposal.version], ["pending", ["plan"], 1]);
  assert.deepEqual([proposal.base.plan?.id, proposal.base.plan?.status, proposal.base.plan?.startsOn, proposal.base.plan?.startsTime], [fly.id, "planned", "2027-10-12", "09:00"]);
  assert.deepEqual([proposal.changes.plan?.status, proposal.changes.plan?.startsOn, proposal.changes.plan?.startsTime, proposal.changes.plan?.note], ["confirmed", "2027-10-12", "09:00", null], "status changes; the time and note do not");
  assert.deepEqual(proposal.changes.plan?.contact, { text: `Guide James, ${PHONE}`, include: false }, "an unchecked option, labelled");
  assert.equal(proposal.source.includes(PHONE), false, "the number is not stored beside the proposal");
  const after = await item(fly.id);
  assert.deepEqual([after.status, after.note, after.startsAt!.toISOString(), after.updatedAt.toISOString()], [before.status, before.note, before.startsAt!.toISOString(), before.updatedAt.toISOString()], "nothing is applied before review");
  const answer = result.body.durableAnswer as string;
  assert.equal(answer, "Ready to mark “Fly-fishing lesson” confirmed — check the card below. James’s number stays in this conversation unless you add it to the plan note.");
  assert.equal(answer.includes(PHONE), false, "the durable answer never repeats the number");
}));

test("Apply with the contact unchecked: status confirmed, note unchanged, time unchanged, recorded as reported by the organizer", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  const applied = await act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "apply_trip", expectedVersion: 1 });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const saved = await item(fly.id);
  assert.deepEqual([saved.status, saved.note, saved.startsAt!.toISOString(), saved.endsAt!.toISOString(), saved.title], ["confirmed", null, "2027-10-12T15:00:00.000Z", "2027-10-12T18:00:00.000Z", "Fly-fishing lesson"]);
  assert.equal(saved.provenanceLabel, "Added by Casey Synthetic · Confirmed as reported by Robin Synthetic", "reported, never verified");
  const proposal = await proposalOf(made.body.turnId);
  assert.deepEqual([proposal.state, proposal.receipt?.planId, proposal.receipt?.appliedBy], ["applied", fly.id, "Robin Synthetic"]);
  const audits = await withTestDatabase(db => db.select().from(auditEvents).where(eq(auditEvents.commonsId, s.trip.eventId)));
  assert.match(audits.map(row => row.summary).join("\n"), /Plan “Fly-fishing lesson” set to confirmed as reported by the organizer; not verified/);
  assert.equal(JSON.stringify(audits).includes(PHONE), false, "the audit trail never carries the number");
  // Applying the same reviewed command again changes nothing more.
  const again = await act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "apply_trip", expectedVersion: 1 });
  assert.equal(again.status, 409, "the review is already resolved");
  assert.equal((await item(fly.id)).updatedAt.toISOString(), saved.updatedAt.toISOString());
}));

test("Apply with the contact checked: the note contains the contact, and a review edit can only choose it, never change or swap it", { skip }, () => withCoordinatorScenario(async s => {
  const { fly, sleigh } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  const proposal = await proposalOf(made.body.turnId);
  const revise = (changes: unknown, expectedVersion = 1) => act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "revise_trip", expectedVersion, changes });
  const chosen = { ...proposal.changes, plan: { ...proposal.changes.plan!, contact: { ...proposal.changes.plan!.contact!, include: true } } };
  const forged = await revise({ ...chosen, plan: { ...chosen.plan, contact: { text: "Guide James, 999-999-9999", include: true } } });
  assert.equal(forged.status, 409, "the contact text cannot be rewritten by a review edit");
  const swapped = await revise({ ...chosen, plan: { ...chosen.plan, id: sleigh.id, title: sleigh.title } });
  assert.equal(swapped.status, 409, "a review edit cannot point at another plan item");
  const dropped = await revise({ ...chosen, plan: null });
  assert.equal(dropped.status, 409);
  assert.equal((await item(fly.id)).note, null);
  assert.equal((await revise(chosen)).status, 200);
  const edited = await proposalOf(made.body.turnId);
  assert.deepEqual([edited.version, edited.changes.plan?.contact?.include, edited.changes.plan?.note], [2, true, null]);
  assert.equal((await item(fly.id)).note, null, "choosing it is still not saving it");
  const applied = await act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "apply_trip", expectedVersion: 2 });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const saved = await item(fly.id);
  assert.equal(saved.note, `Guide James, ${PHONE}`);
  assert.equal(saved.status, "confirmed");
  assert.equal((await item(sleigh.id)).status, "planned", "no other plan item changed");
  assert.equal(JSON.stringify(await withTestDatabase(db => db.select().from(auditEvents).where(eq(auditEvents.commonsId, s.trip.eventId)))).includes(PHONE), false);
}));

test("Another organizer edits the item after the review was prepared: stale, nothing overwritten", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  // Robin edits the same plan item (a new title and note) before anyone applies the review.
  await withTestDatabase(db => db.update(itineraryItems).set({ title: "Fly-fishing lesson with Sam", note: "Bring waders", updatedAt: new Date(Date.now() + 5_000) }).where(eq(itineraryItems.id, fly.id)));
  const applied = await act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "apply_trip", expectedVersion: 1 });
  assert.equal(applied.status, 409);
  assert.match(applied.body.error as string, /changed\. Reload and prepare a fresh update; nothing from this attempt was saved/);
  const saved = await item(fly.id);
  assert.deepEqual([saved.status, saved.note, saved.title], ["planned", "Bring waders", "Fly-fishing lesson with Sam"], "Robin's edit stands and nothing was applied");
  assert.equal((await proposalOf(made.body.turnId)).state, "pending");
}));

test("The item changes while the model is working: the turn fails as stale_version and no proposal is saved", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  let interfere = true;
  s.network.restore();
  const { installRouteFetch, fakeProviderResponse } = await import("./coordinator-route-harness");
  const suggesting = installRouteFetch(s.routes, { provider: async body => {
    if (interfere) { interfere = false; await withTestDatabase(db => db.update(itineraryItems).set({ note: "Bring waders", updatedAt: new Date(Date.now() + 5_000) }).where(eq(itineraryItems.id, fly.id))); }
    return fakeProviderResponse(body as never, "I can prepare that plan update for review.", "Fly fishing", { tripSuggestion: flySuggestion(fly.id) });
  } });
  try {
    const stale = await s.post(s.command({ text: TRANSCRIPT }));
    assert.equal(stale.body.status, "failed");
    assert.deepEqual([stale.body.error.code, stale.body.saved.proposal], ["stale_version", false]);
    assert.equal((await item(fly.id)).status, "planned");
  } finally { suggesting.restore(); }
}));

test("Two fishing items: one clarification that names both, no proposal, nothing saved", { skip }, () => withCoordinatorScenario(async s => {
  const { fly, more } = await seedFixture(s, [{ title: "Fly-fishing float trip", startsAt: "2027-10-13T15:00:00.000Z" }]);
  const result = await report(s, TRANSCRIPT, suggest({ planStatus: "confirmed", planStartsOn: "2027-10-12", planStartsTime: "09:00" }), "I can prepare that plan update for review.");
  assert.equal(result.body.capability, "propose_trip_change");
  assert.deepEqual(result.body.artifacts, []);
  assert.equal(result.body.reviewRequired, false);
  const answer = result.body.durableAnswer as string;
  assert.match(answer, /nothing to review and nothing was saved/);
  assert.match(answer, /More than one saved plan could match/);
  assert.match(answer, /“Fly-fishing lesson”/);
  assert.match(answer, /“Fly-fishing float trip”/);
  assert.doesNotMatch(answer, /I can prepare|prepared/);
  assert.match(answer, /kept only in this organizer conversation; I did not add it to any plan/);
  assert.equal(answer.includes(PHONE), false);
  assert.deepEqual([(await item(fly.id)).status, (await item(more[0].id)).status], ["planned", "planned"]);
  assert.equal((await turnRow(result.body.turnId)).workspace?.tripProposal, undefined);
}));

test("No matching item: honest not-found text, no proposal, and a new plan is not created from chat", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const before = await withTestDatabase(db => db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, s.trip.eventId)));
  // The model even claims it did the work; the answer is written by code.
  const result = await report(s, "We confirmed paddleboarding for 9 AM on 10/12. The guide's number is 505-412-7380", suggest({ planStatus: "confirmed", planStartsOn: "2027-10-12", planStartsTime: "09:00" }), "Done, I've marked paddleboarding confirmed for 9 AM.");
  assert.equal(result.body.capability, "propose_trip_change");
  assert.deepEqual(result.body.artifacts, []);
  const answer = result.body.durableAnswer as string;
  assert.match(answer, /nothing to review and nothing was saved/);
  assert.match(answer, /couldn’t find a saved plan that matches/);
  assert.match(answer, /“Fly-fishing lesson”/);
  assert.match(answer, /can’t create a new plan from chat yet; add it in Plan/);
  assert.doesNotMatch(answer, /marked|Done/);
  assert.equal(leaks(answer), false);
  const after = await withTestDatabase(db => db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, s.trip.eventId)));
  assert.equal(after.length, before.length, "no plan item was created");
  assert.equal((await item(fly.id)).status, "planned");
}));

test("Time change: 'fly fishing moved to 10 AM' proposes a start in the trip's timezone, carries the end with it, and applies only after review", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const result = await report(s, "fly fishing moved to 10 AM", suggest({ planId: fly.id, planStartsOn: "2027-10-12", planStartsTime: "10:00" }));
  assert.equal(result.body.reviewRequired, true);
  const proposal = await proposalOf(result.body.turnId);
  assert.deepEqual([proposal.changes.plan?.status, proposal.changes.plan?.startsOn, proposal.changes.plan?.startsTime, proposal.changes.plan?.timezone], ["planned", "2027-10-12", "10:00", "America/Denver"]);
  assert.match(result.body.durableAnswer as string, /move it to Oct 12, 10:00 AM/);
  assert.equal((await item(fly.id)).startsAt!.toISOString(), "2027-10-12T15:00:00.000Z", "not applied by asking");
  const applied = await act(s, { turnId: result.body.turnId, threadId: result.body.thread.id, action: "apply_trip", expectedVersion: 1 });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const saved = await item(fly.id);
  assert.deepEqual([saved.startsAt!.toISOString(), saved.endsAt!.toISOString(), saved.status], ["2027-10-12T16:00:00.000Z", "2027-10-12T19:00:00.000Z", "planned"], "10:00 in Denver is 16:00Z; the three-hour lesson keeps its length");
}));

test("Cancellation report: the sleigh ride is marked cancelled through review, in the provenance too", { skip }, () => withCoordinatorScenario(async s => {
  const { sleigh } = await seedFixture(s);
  const result = await report(s, "we cancelled the sleigh ride", suggest({ planId: sleigh.id, planStatus: "cancelled" }));
  assert.equal(result.body.reviewRequired, true);
  assert.equal(result.body.durableAnswer, "Ready to mark “Sunset sleigh ride” cancelled — check the card below.");
  assert.equal((await item(sleigh.id)).status, "planned");
  const applied = await act(s, { turnId: result.body.turnId, threadId: result.body.thread.id, action: "apply_trip", expectedVersion: 1 });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const saved = await item(sleigh.id);
  assert.deepEqual([saved.status, saved.note, saved.provenanceLabel], ["cancelled", "Meet at the barn", "Added by Casey Synthetic · Cancelled by Robin Synthetic"]);
}));

test("A model that leaves the plan fields out still gets a reviewable confirmation, prepared from the organizer's words", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const result = await report(s, "We've confirmed the fly-fishing lesson", null, "Nice, sounds great.");
  assert.equal(result.body.reviewRequired, true);
  const proposal = await proposalOf(result.body.turnId);
  assert.deepEqual([proposal.base.plan?.id, proposal.changes.plan?.status], [fly.id, "confirmed"]);
}));

test("Hedges, questions and statements that only mention the plan are answered and prepare nothing", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  for (const text of ["Should we confirm fly fishing?", "We'll confirm fly fishing tomorrow", "What time is fly fishing?", "Maybe we should cancel the sleigh ride", "The guide (James)'s phone is 505-412-7380"]) {
    Object.assign(s.next, { reply: "Fly fishing is saved as planned for 9 AM on Oct 12.", extra: { tripSuggestion: null } });
    const result = await s.post(s.command({ text }));
    assert.equal(result.body.capability, "answer", text);
    assert.deepEqual(result.body.artifacts, [], text);
    assert.equal(result.body.reviewRequired, false, text);
  }
  assert.equal((await item(fly.id)).status, "planned");
  // A status lookup uses saved state without asking a model that might invent a confirmation.
  Object.assign(s.next, { reply: "Fly fishing is saved as planned. I've marked it confirmed.", extra: { tripSuggestion: null } });
  const calls = s.network.providerCalls.length;
  const claimed = await s.post(s.command({ text: "Is fly fishing confirmed?" }));
  assert.equal(claimed.body.capability, "answer");
  assert.doesNotMatch(claimed.body.durableAnswer as string, /marked it confirmed/);
  assert.match(claimed.body.durableAnswer as string, /saved in Plan as planned, not confirmed/);
  assert.equal(s.network.providerCalls.length, calls);
}));

test("Voice input prepares the same review, and the spoken text points to approval on screen without repeating the number", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const typed = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  const spoken = await report(s, TRANSCRIPT, flySuggestion(fly.id), "I can prepare that plan update for review.", voice());
  assert.deepEqual([spoken.body.capability, spoken.body.reviewRequired, spoken.body.artifacts[0].kind], ["propose_trip_change", true, "trip_change_proposal"]);
  const [a, b] = await Promise.all([proposalOf(typed.body.turnId), proposalOf(spoken.body.turnId)]);
  assert.deepEqual(b.changes.plan, a.changes.plan, "the same proposal");
  const text = spoken.body.spokenReply as string;
  assert.equal(text, "I’ve prepared that plan update for “Fly-fishing lesson”, and approval happens on screen.", "one sentence, approval on screen");
  assert.equal(text.includes(PHONE), false);
  assert.equal((await item(fly.id)).status, "planned");
  // "Yes, apply it" by voice cannot approve anything.
  const approve = await s.post(inThread(spoken.body.thread, "Yes, apply it", voice()));
  assert.equal(approve.body.capability, "unsupported");
  assert.match(approve.body.durableAnswer as string, /Approval happens on screen/);
  assert.equal((await item(fly.id)).status, "planned");
}));

test("A participant cannot apply or revise a plan review: organizer_required, nothing saved", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  const asParticipant = await act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "apply_trip", expectedVersion: 1 }, s.trip.travelerId);
  assert.equal(asParticipant.status, 403);
  assert.equal(asParticipant.body.code, "organizer_required");
  const revised = await act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "revise_trip", expectedVersion: 1, changes: (await proposalOf(made.body.turnId)).changes }, s.trip.travelerId);
  assert.equal(revised.status, 403);
  const saved = await item(fly.id);
  assert.deepEqual([saved.status, saved.note], ["planned", null]);
  assert.equal((await proposalOf(made.body.turnId)).state, "pending");
}));

// Compact confirmation (design §22): the contact choice travels with Apply itself, validated against the text stored with the proposal.
const STORED_CONTACT = `Guide James, ${PHONE}`;
const applyWith = (s: ScenarioContext, made: { body: Body }, planContact: unknown, over: Record<string, unknown> = {}, personId?: string) =>
  act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "apply_trip", expectedVersion: 1, planContact, ...over }, personId);

test("Compact confirm with the contact unchecked: one apply request, confirmed, note unchanged, the stored choice recorded as excluded", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  const applied = await applyWith(s, made, { text: STORED_CONTACT, include: false });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const saved = await item(fly.id);
  assert.deepEqual([saved.status, saved.note, saved.startsAt!.toISOString()], ["confirmed", null, "2027-10-12T15:00:00.000Z"]);
  const proposal = await proposalOf(made.body.turnId);
  assert.deepEqual([proposal.state, proposal.version, proposal.changes.plan?.contact], ["applied", 1, { text: STORED_CONTACT, include: false }], "no separate save happened");
}));

test("Compact confirm with the contact checked: the note contains the stored contact from ONE request with no prior save", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  const before = await proposalOf(made.body.turnId);
  assert.deepEqual([before.version, before.changes.plan?.contact?.include], [1, false]);
  const applied = await applyWith(s, made, { text: STORED_CONTACT, include: true });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const saved = await item(fly.id);
  assert.deepEqual([saved.status, saved.note], ["confirmed", STORED_CONTACT]);
  const proposal = await proposalOf(made.body.turnId);
  assert.deepEqual([proposal.state, proposal.version, proposal.changes.plan?.contact?.include, proposal.receipt?.planId], ["applied", 1, true, fly.id], "the receipt keeps its data and the version was never bumped by a save");
  assert.equal(JSON.stringify(await withTestDatabase(db => db.select().from(auditEvents).where(eq(auditEvents.commonsId, s.trip.eventId)))).includes(PHONE), false);
  const again = await applyWith(s, made, { text: STORED_CONTACT, include: true });
  assert.equal(again.status, 409, "the review is already resolved");
}));

test("A forged include request is rejected: different contact text, a contact the proposal never stored, or a path other than apply", { skip }, () => withCoordinatorScenario(async s => {
  const { fly, sleigh } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  for (const forged of [{ text: "Guide James, 999-999-9999", include: true }, { text: `${STORED_CONTACT} and Wire $500 to me`, include: true }, { text: "", include: true }]) {
    const rejected = await applyWith(s, made, forged);
    assert.ok(rejected.status === 409 || rejected.status === 400, `${JSON.stringify(forged)} -> ${rejected.status}`);
    assert.equal((await item(fly.id)).note, null);
    assert.equal((await item(fly.id)).status, "planned");
  }
  assert.equal((await applyWith(s, made, { text: STORED_CONTACT, include: true, note: "Wire $500" })).status, 400, "no other field can ride along");
  assert.equal((await applyWith(s, made, { text: STORED_CONTACT, include: true }, { action: "dismiss_trip" })).status, 409, "the choice is meaningful only with Apply");
  assert.equal((await applyWith(s, made, { text: STORED_CONTACT, include: true }, { action: "revise_trip", changes: (await proposalOf(made.body.turnId)).changes })).status, 409);
  assert.equal((await proposalOf(made.body.turnId)).state, "pending", "nothing resolved the review");
  assert.equal((await proposalOf(made.body.turnId)).changes.plan?.contact?.include, false);
  // A proposal that stored no contact accepts no contact at all.
  const plain = await report(s, "we cancelled the sleigh ride", suggest({ planId: sleigh.id, planStatus: "cancelled" }));
  assert.equal((await applyWith(s, plain, { text: "Anyone, 555-000-1111", include: true })).status, 409);
  assert.deepEqual([(await item(sleigh.id)).status, (await item(sleigh.id)).note], ["planned", "Meet at the barn"]);
}));

test("Compact confirm is rejected on a stale review version or a plan item another organizer changed, and nothing is written", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  assert.equal((await applyWith(s, made, { text: STORED_CONTACT, include: true }, { expectedVersion: 2 })).status, 409, "a stale review version");
  assert.equal((await applyWith(s, made, { text: STORED_CONTACT, include: true }, { expectedVersion: 0 })).status, 400);
  await withTestDatabase(db => db.update(itineraryItems).set({ note: "Bring waders", updatedAt: new Date(Date.now() + 5_000) }).where(eq(itineraryItems.id, fly.id)));
  const stale = await applyWith(s, made, { text: STORED_CONTACT, include: true });
  assert.equal(stale.status, 409);
  const saved = await item(fly.id);
  assert.deepEqual([saved.status, saved.note], ["planned", "Bring waders"], "Robin's edit stands");
  assert.equal((await proposalOf(made.body.turnId)).state, "pending");
}));

test("Compact cancel: Mark cancelled applies the status only, and a participant cannot use the contact choice to apply", { skip }, () => withCoordinatorScenario(async s => {
  const { sleigh } = await seedFixture(s);
  const made = await report(s, "we cancelled the sleigh ride. Call Pat at 505-222-3333 about the deposit", suggest({ planId: sleigh.id, planStatus: "cancelled", planContactLabel: "Pat" }));
  const proposal = await proposalOf(made.body.turnId);
  const contact = proposal.changes.plan?.contact;
  assert.ok(contact, "the contact is stored as an unchecked option");
  assert.equal((await applyWith(s, made, { text: contact.text, include: true }, {}, s.trip.travelerId)).status, 403, "organizer_required");
  assert.equal((await item(sleigh.id)).status, "planned");
  const applied = await applyWith(s, made, { text: contact.text, include: false });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  const saved = await item(sleigh.id);
  assert.deepEqual([saved.status, saved.note, saved.provenanceLabel], ["cancelled", "Meet at the barn", "Added by Casey Synthetic · Cancelled by Robin Synthetic"]);
}));

test("With the global trip-changes switch set to false, a trip gets an answer, never a plan review, and the apply route refuses", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
  assert.equal(made.body.capability, "propose_trip_change");
  process.env.COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED = "false";
  const blocked = await s.post(s.command({ text: TRANSCRIPT }));
  assert.equal(blocked.body.capability, "answer");
  assert.deepEqual(blocked.body.artifacts, []);
  const applied = await act(s, { turnId: made.body.turnId, threadId: made.body.thread.id, action: "apply_trip", expectedVersion: 1 });
  assert.notEqual(applied.status, 200);
  assert.equal((await item(fly.id)).status, "planned");
}));

test("The phone number never reaches a research query, a log or metric line, a warning, or the PostHog payload", { skip }, () => withCoordinatorScenario(async s => {
  const { fly } = await seedFixture(s);
  const warnings: unknown[] = [], original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const made = await report(s, TRANSCRIPT, flySuggestion(fly.id));
    assert.equal(made.body.reviewRequired, true);
    // A research request that carries the same number: the public query is built from the public part only.
    Object.assign(s.next, { reply: "Here are options.", extra: { tripSuggestion: null } });
    await s.post(inThread(made.body.thread, `Look up fly fishing guides near Breckenridge. The guide (James)'s phone is ${PHONE}`));
    // A failure path: the provider is down. Its error log is content-free too.
    await s.post(s.command({ text: TRANSCRIPT.replace("9 AM", "10 AM"), ...voice() }));
  } finally { console.warn = original; }
  assert.ok(s.network.tavilyCalls.length >= 1, "the research request did search");
  assert.equal(leaks(s.network.tavilyCalls), false, "no digits of the number reach the public search");
  assert.equal(JSON.stringify(s.network.tavilyCalls).includes("412"), false);
  assert.equal(JSON.stringify(s.network.tavilyCalls).includes("James"), false);
  assert.equal(leaks(s.infoLogs), false, "turn metrics carry no content");
  assert.equal(leaks(warnings), false);
  // The observability payload is metadata only, even when the provider's own response echoes the number.
  let seen: AiGeneration | undefined;
  await observeAiCall("openrouter", "test/mini-model", generation => { seen = generation; },
    async fetcher => (await fetcher("https://openrouter.ai/api/v1/chat/completions", { method: "POST", body: JSON.stringify({ messages: [{ content: TRANSCRIPT }] }) })).json(),
    async () => new Response(JSON.stringify({ choices: [{ message: { content: `${PHONE}` } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.ok(seen);
  const payload = JSON.stringify({ event: "$ai_generation", properties: aiEventProperties(seen, "trace", "session", "workspace", { capability: "propose_trip_change", inputMode: "text" }) });
  assert.equal(leaks(payload), false);
  assert.match(payload, /"content_capture":"disabled"/);
}));

test("Balloon Fiesta thread status ignores another plan and stale assistant claims, then rereads saved changes", {skip},()=>withCoordinatorScenario(async s=>{
  const {fly,more}=await seedFixture(s,[{title:"Balloon Fiesta Kids’ Day",startsAt:"2027-10-09T13:00:00Z",status:"confirmed"}]);
  Object.assign(s.next,{title:"Balloon Fiesta Kids’ Day",reply:"The balloon event is planned, not confirmed.",extra:{tripSuggestion:null}});
  const first=await s.post(s.command({text:"Let's discuss Balloon Fiesta Kids’ Day"}));
  assert.equal(first.status,200);
  const calls=s.network.providerCalls.length;
  Object.assign(s.next,{reply:"The fly-fishing lesson is confirmed.",extra:{tripSuggestion:null}});
  const answer=await s.post(inThread(first.body.thread,"Have we confirmed this event?"));
  assert.equal(answer.status,200,JSON.stringify(answer.body));
  assert.match(answer.body.durableAnswer,/^Balloon Fiesta Kids’ Day.*confirmed, as reported/);
  assert.doesNotMatch(answer.body.durableAnswer,/fly.fishing/i);
  assert.deepEqual(answer.body.artifacts,[]);
  assert.equal(s.network.providerCalls.length,calls,"Current status comes directly from the record");
  await withTestDatabase(db=>db.update(itineraryItems).set({status:"planned",updatedAt:new Date()}).where(eq(itineraryItems.id,more[0].id)));
  const updated=await s.post(inThread(answer.body.thread,"Is this event confirmed?"));
  assert.match(updated.body.durableAnswer,/^Balloon Fiesta Kids’ Day.*planned, not confirmed/);
  assert.equal((await item(fly.id)).status,"planned","The other activity is untouched");
}));
