import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { coordinatorThreads, coordinatorTurns, pollDrafts, stays } from "@commons/database";
import { databaseTestsEnabled, eq, withCoordinatorScenario, withTestDatabase, type ProviderCall, type ScenarioContext } from "./coordinator-route-harness";
// Goals are on by default; these cases cover the Coordinator paths without them.
process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "false";

// Stage 8: consequential capabilities (poll drafts, public research, navigation, attendance) are conservative when driven through the REAL /turns
// route. Hedged, reported, future, third-person, questioning or ambiguous phrasing becomes an ordinary answer the model may use to OFFER the action.
// Everything is mocked at the provider and search; no real provider, voice session, or remote database is involved.
const skip = !databaseTestsEnabled;

async function startThread(s: ScenarioContext, title: string, text = "Where should we eat on Saturday?", reply = "Try the early seating near your stay.") {
  Object.assign(s.next, { title, reply });
  const result = await s.post(s.command({ text }));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  return { id: result.body.thread.id as string, turnVersion: result.body.thread.turnVersion as number, title: result.body.thread.title as string };
}
const inThread = (thread: { id: string; turnVersion: number }, text: string, over: Record<string, unknown> = {}) => ({ commandId: randomUUID(), target: { kind: "existing", threadId: thread.id, expectedTurnVersion: thread.turnVersion }, inputMode: "text", text, ...over });
const voice = () => ({ inputMode: "voice", voice: { sessionId: "session-test", delegationId: randomUUID() } });
const drafts = (eventId: string) => withTestDatabase(db => db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, eventId)));
const systemText = (call: ProviderCall) => call.body.messages!.filter(message => message.role === "system").map(message => message.content).join("\n");

test("R1 hedged, reported, future and questioning poll wording creates no draft through the real route, by text or voice, and the model is told to offer", { skip }, () => withCoordinatorScenario(async s => {
  let thread = await startThread(s, "Saturday dinner");
  const requests: Array<[string, Record<string, unknown>]> = [
    ["Should we ask the group about dinner?", voice()], ["Should we ask the group about dinner?", {}], ["Robin said she'd ask the group.", {}], ["I'll ask everyone myself later", {}], ["Maybe ask the group about dinner", voice()],
    ["Ask the group where they want to eat", voice()],
  ];
  for (const [text, over] of requests) {
    const before = s.network.providerCalls.length;
    const result = await s.post(inThread(thread, text, over));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.capability, "answer", `${JSON.stringify(over.inputMode ?? "text")}: ${text}`);
    assert.deepEqual(result.body.artifacts, [], text);
    assert.equal(result.body.reviewRequired, false, text);
    assert.match(systemText(s.network.providerCalls[before]), /NO poll or draft was prepared/, `${text} offers rather than creates`);
    thread = { ...thread, turnVersion: result.body.thread.turnVersion };
  }
  assert.equal((await drafts(s.trip.eventId)).length, 0, "not one draft was created");
  // An unambiguous imperative still prepares one, and no offer instruction is sent with it.
  const before = s.network.providerCalls.length;
  s.next.extra = { operations: [{ kind: "add_text_question", prompt: "Where should we eat on Saturday?", required: false }] };
  const explicit = await s.post(inThread(thread, "Make a poll asking where to eat on Saturday"));
  assert.equal(explicit.body.capability, "prepare_poll");
  assert.doesNotMatch(systemText(s.network.providerCalls[before]), /NO poll or draft was prepared/);
  assert.equal((await drafts(s.trip.eventId)).length, 1);
}));

test("R1 the thread's draft attached as context does not steer later turns, and a rebuilt retry without the marker still matches", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Which restaurant?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const asked = await s.post(inThread(dinner, "Where should we eat?", { explicitAction: { kind: "ask_group", starterId: "question" } }));
  assert.equal(asked.body.capability, "prepare_poll", JSON.stringify(asked.body));
  s.next.extra = {};
  const [draft] = await drafts(s.trip.eventId);
  let version = asked.body.thread.turnVersion as number;
  const send = async (text: string, artifact: Record<string, unknown> | null, over: Record<string, unknown> = {}) => {
    const current = (await drafts(s.trip.eventId))[0];
    const result = await s.post(inThread({ id: dinner.id, turnVersion: version }, text, { ...(artifact ? { artifact: { kind: "draft", id: draft.id, version: current.version, ...artifact } } : {}), ...over }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    version = result.body.thread.turnVersion;
    return result.body;
  };
  const context = { selection: "thread_context" };
  // Auto-attached (thread_context): research, lookups and questions route normally, and nothing edits the draft.
  assert.equal((await send("Look up kid-friendly dinner spots", context)).capability, "research");
  assert.equal(s.network.tavilyCalls.length > 0, true);
  assert.equal((await send("What's our lodging address and check-in?", context)).capability, "retrieve_context");
  assert.equal((await send("Make it friendlier", context)).capability, "answer", "an edit-like message that names nothing in the draft is not enough");
  assert.equal((await drafts(s.trip.eventId)).length, 1, "still one draft: no turn created another");
  // A rebuilt retry command (no selection marker) still matches the saved request: the marker is not part of the fingerprint.
  const command = inThread({ id: dinner.id, turnVersion: version }, "Where should the family eat Saturday?", { artifact: { kind: "draft", id: draft.id, version: (await drafts(s.trip.eventId))[0].version, selection: "thread_context" } });
  const first = await s.post(command);
  const { selection: _selection, ...bare } = (command as unknown as { artifact: Record<string, unknown> }).artifact; void _selection;
  const replay = await s.post({ ...command, artifact: bare });
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.turnId, first.body.turnId);
}));

test("R1 a draft the organizer selected is edited only by edit-like requests; research and lookups still route normally", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Which restaurant?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const asked = await s.post(inThread(dinner, "Where should we eat?", { explicitAction: { kind: "ask_group", starterId: "question" } }));
  s.next.extra = {};
  const [draft] = await drafts(s.trip.eventId);
  let version = asked.body.thread.turnVersion as number;
  const selected = async (text: string) => {
    const current = (await drafts(s.trip.eventId))[0];
    const result = await s.post(inThread({ id: dinner.id, turnVersion: version }, text, { artifact: { kind: "draft", id: draft.id, version: current.version } }));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    version = result.body.thread.turnVersion;
    return result.body;
  };
  assert.equal((await selected("Make the intro shorter")).capability, "prepare_poll");
  assert.equal((await selected("What's our lodging address and check-in?")).capability, "retrieve_context");
  assert.equal((await selected("Look up kid-friendly dinner spots")).capability, "research");
  assert.equal((await selected("Is the intro too long?")).capability, "answer");
  assert.equal((await drafts(s.trip.eventId)).length, 1, "no turn created another draft");
}));

test("R2 internal lookups never reach public search; person contact details are refused; a flight number never leaves Commons", { skip }, () => withCoordinatorScenario(async s => {
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "The lodge total is $1,840.00.");
  const dinner = await startThread(s, "Saturday dinner");
  let thread = dinner;
  const ask = async (text: string, over: Record<string, unknown> = {}) => {
    const result = await s.post(inThread(thread, text, over));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    thread = { ...thread, turnVersion: result.body.thread.turnVersion };
    return result.body;
  };
  const model = s.network.providerCalls.length;
  const recall = await ask("Look up what we discussed in the lodging thread");
  assert.equal(recall.capability, "retrieve_context");
  assert.equal(recall.sources.find((source: { kind: string }) => source.kind === "thread")?.threadId, lodging.id, "read from Commons, attributed to the lodging thread");
  assert.equal(s.network.tavilyCalls.length, 0, "not sent to public search");
  assert.equal(JSON.parse(s.network.providerCalls[model].body.messages!.at(-1)!.content).otherConversationExcerpts[0].title, "Lodging costs");
  for (const over of [{}, voice()]) {
    const calls = s.network.providerCalls.length;
    const contact = await ask("look up our Airbnb host Jamie Rivera's phone number", over);
    assert.deepEqual([contact.capability, contact.error], ["unsupported", null]);
    assert.match(contact.durableAnswer, /don’t look up phone numbers, emails, or home addresses for people/);
    assert.equal(s.network.providerCalls.length, calls, "refused without a model call");
  }
  const flight = await ask("Look up Taylor's flight UA 1234 arrival time");
  assert.notEqual(flight.capability, "research");
  assert.equal(s.network.tavilyCalls.length, 0);
  assert.equal(JSON.stringify(s.network.tavilyCalls).includes("1234"), false);
  // A genuine public lookup still searches, with a clean query.
  const public_ = await ask("Look up kid-friendly dinner spots near our host Jamie Rivera's place, flight UA 1234, record locator XK4T9Q");
  assert.equal(public_.capability, "research");
  assert.equal(s.network.tavilyCalls.length > 0, true);
  const sent = JSON.stringify(s.network.tavilyCalls);
  for (const leaked of ["Jamie", "Rivera", "UA 1234", "1234", "XK4T9Q", "locator", "Airbnb"]) assert.equal(sent.includes(leaked), false, `${leaked} left Commons: ${sent}`);
  assert.match(sent, /kid-friendly dinner spots/);
}));

test("R3 'go to' plans are never navigation, with or without a similarly named thread; explicit navigation still opens the matching thread", { skip }, () => withCoordinatorScenario(async s => {
  const pickup = await startThread(s, "Airport pickup", "How do we get from the airport?");
  const dinner = await startThread(s, "Friday dinner", "Friday dinner ideas?");
  const lodging = await startThread(s, "Lodging costs", "Lodging costs?");
  let thread = lodging;
  for (const text of ["I want to go to the airport by 3", "Let's go to dinner at 6", "We should head to dinner around six", "Take me to the airport"]) {
    const calls = s.network.providerCalls.length;
    const result = await s.post(inThread(thread, text));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.capability, "answer", text);
    assert.equal(result.body.navigation, null, text);
    assert.equal(s.network.providerCalls.length, calls + 1, `${text} is ordinary conversation, answered by the model`);
    thread = { ...thread, turnVersion: result.body.thread.turnVersion };
  }
  const explicit = await s.post(inThread(thread, "Go to the airport pickup thread"));
  assert.deepEqual(explicit.body.navigation, { kind: "switched", threadId: pickup.id, title: pickup.title });
  const verb = await s.post(inThread({ id: thread.id, turnVersion: explicit.body.thread.turnVersion }, "Continue this in Friday dinner"));
  assert.deepEqual(verb.body.navigation, { kind: "switched", threadId: dinner.id, title: dinner.title });
  const unknown = await s.post(inThread({ id: thread.id, turnVersion: verb.body.thread.turnVersion }, "Continue this in the spa"));
  assert.equal(unknown.body.capability, "answer", "an explicit verb form with no matching thread is answered, not guessed");
}));

test("R9 a plain answer that claims a booking, payment, message or saved change has the claim removed before it is saved", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  s.next.reply = "Alpine Table has an early family menu. I've booked a table for 5 p.m. and sent the invite to everyone. Ridge Grill opens at 4.";
  const result = await s.post(inThread(dinner, "Where should the family eat Saturday?"));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.capability, "answer");
  const durable = result.body.durableAnswer as string;
  assert.match(durable, /Alpine Table has an early family menu\./);
  assert.match(durable, /Ridge Grill opens at 4\./);
  assert.match(durable, /Nothing was booked, paid, sent, scheduled, or saved by this reply\./);
  assert.doesNotMatch(durable.replace(/Nothing was booked, paid, sent, scheduled, or saved by this reply\./, ""), /booked|sent the invite/);
  assert.doesNotMatch(result.body.spokenReply as string, /I've booked|sent the invite/);
  const stored = await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, result.body.turnId)));
  assert.doesNotMatch(stored[0].assistantText, /I've booked|sent the invite/, "the claim is never persisted");
  // The same guard covers other capabilities: a research summary that says it booked something.
  s.next.reply = "Alpine Table looks family friendly. I've reserved it for you.";
  const research = await s.post(inThread({ id: dinner.id, turnVersion: result.body.thread.turnVersion }, "Look up family friendly dinner spots"));
  assert.equal(research.body.capability, "research");
  assert.doesNotMatch((research.body.durableAnswer as string).replace(/Nothing was booked, paid, sent, scheduled, or saved by this reply\./, ""), /reserved/);
  // A limit notice path and a lookup path never claim either.
  s.next.reply = "Robin has been notified and the stay is now saved.";
  const lookup = await s.post(inThread({ id: dinner.id, turnVersion: research.body.thread.turnVersion }, "What's our lodging address?"));
  assert.equal(lookup.body.capability, "retrieve_context");
  assert.doesNotMatch(lookup.body.durableAnswer as string, /notified|now saved/);
}));

test("F2 a stay update with the amount but no stay id defaults to the single saved stay; when nothing can be prepared the text says so instead of implying a card", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const suggestion = { operations: ["stay"], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: 210_000, stayBookingUrl: null, stayStatus: null };
  Object.assign(s.next, { reply: "I can prepare that lodging update for review.", extra: { tripSuggestion: suggestion } });
  const made = await s.post(inThread(dinner, "Update our stay at Synthetic Peak Lodge: the total is now $2,100."));
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.capability, "propose_trip_change");
  assert.equal(made.body.artifacts[0]?.kind, "trip_change_proposal", "a review card exists");
  assert.match(made.body.durableAnswer, /prepared a trip update below/);
  const proposal = (await withTestDatabase(db => db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, made.body.turnId))))[0].workspace!.tripProposal!;
  assert.deepEqual([proposal.changes.stay?.id, proposal.changes.stay?.totalCents, proposal.base.stay?.totalCents], [s.trip.stayId, 210_000, 184_000]);
  assert.equal((await withTestDatabase(db => db.select().from(stays).where(eq(stays.id, s.trip.stayId))))[0].totalCents, 184_000, "nothing is saved before review");
  // The organizer gave no amount the suggestion can be tied to: no card, and honest text (never the model's "I can prepare").
  Object.assign(s.next, { reply: "I can prepare that lodging update for review.", extra: { tripSuggestion: { ...suggestion, stayTotalCents: 250_000 } } });
  const dropped = await s.post(inThread({ id: dinner.id, turnVersion: made.body.thread.turnVersion }, "Update our stay at Synthetic Peak Lodge: the total is now $2,100."));
  assert.deepEqual(dropped.body.artifacts, []);
  assert.equal(dropped.body.reviewRequired, false);
  assert.match(dropped.body.durableAnswer, /nothing to review and nothing was saved/);
  assert.doesNotMatch(dropped.body.durableAnswer, /I can prepare/);
}));

test("F1 a later turn never retitles an established thread; the generated title lands only on the first turn", { skip }, () => withCoordinatorScenario(async s => {
  s.next.title = "Dinner near the lodge";
  const first = await s.post(s.command({ text: "We need somewhere for Friday dinner." }));
  assert.equal(first.body.thread.title, "Dinner near the lodge", "the first turn's generated title applies");
  s.next.title = "Make a poll asking";
  const second = await s.post(inThread(first.body.thread, "Make a poll asking where to eat"));
  const third = await s.post(inThread({ id: first.body.thread.id, turnVersion: second.body.thread.turnVersion }, "Where should the family eat Friday?"));
  const rows = await withTestDatabase(db => db.select().from(coordinatorThreads).where(eq(coordinatorThreads.id, first.body.thread.id)));
  assert.equal(rows[0].title, "Dinner near the lodge", "later turns never rename it");
  assert.equal(third.body.thread.title, "Dinner near the lodge");
  const call = s.network.providerCalls.at(-1)!;
  assert.doesNotMatch(systemText(call), /topicTitle/, "later turns do not even ask for a title");
  assert.match(systemText(s.network.providerCalls[0]), /topicTitle/, "the first turn does");
}));

test("A hedged poll answer never claims a draft; a real poll request gets a persisted-artifact receipt", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  s.next.reply = "Early seating would suit a family. I drafted a question for your review. Nothing is shared until you publish it.";
  const hedged = await s.post(inThread(dinner, "Should we ask the group about dinner?", voice()));
  assert.equal(hedged.body.capability, "answer");
  assert.deepEqual(hedged.body.artifacts, []);
  const text = hedged.body.durableAnswer as string;
  assert.match(text, /Early seating would suit a family\./);
  assert.doesNotMatch(text, /drafted a question|for your review|nothing is shared/i);
  assert.match(text, /I haven’t drafted, prepared or started anything with this reply\./);
  assert.match(text, /Want me to prepare a poll for the group to review\?/);
  assert.match(hedged.body.spokenReply as string, /Early seating/);
  assert.equal((await drafts(s.trip.eventId)).length, 0);
  // When a draft really is prepared, code reports the persisted artifact, not model promises.
  s.next.reply = "I drafted a question for your review.";
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Which restaurant?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const real = await s.post(inThread({ id: dinner.id, turnVersion: hedged.body.thread.turnVersion }, "Make a poll asking where to eat on Saturday"));
  assert.equal(real.body.capability, "prepare_poll");
  assert.match(real.body.durableAnswer as string, /Your poll draft is ready to review in Work/);
  assert.match(real.body.durableAnswer as string, /Nothing has been shared or sent/);
  assert.equal((await drafts(s.trip.eventId))[0].data.questions.length, 1);
}));

test("C clarify candidates with the same title are told apart, and the current conversation is marked", { skip }, () => withCoordinatorScenario(async s => {
  const first = await startThread(s, "Dinner near the lodge", "Dinner idea one?");
  const second = await startThread(s, "Dinner near the lodge", "Dinner idea two?");
  const lodging = await startThread(s, "Lodging costs", "Lodging costs?");
  void lodging;
  const asked = await s.post(inThread(second, "Open the dinner thread"));
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  const candidates = asked.body.navigation.candidates as Array<{ threadId: string; title: string; detail?: string }>;
  assert.equal(asked.body.navigation.kind, "clarify");
  assert.deepEqual(candidates.map(item => item.threadId).sort(), [first.id, second.id].sort());
  const byId = new Map(candidates.map(item => [item.threadId, item]));
  assert.match(byId.get(second.id)!.detail!, /^this conversation · last active .+ · \d+ messages?$/);
  assert.match(byId.get(first.id)!.detail!, /^last active .+ · \d+ messages?$/);
  assert.notEqual(byId.get(first.id)!.detail, byId.get(second.id)!.detail);
  const text = asked.body.durableAnswer as string;
  assert.match(text, /“Dinner near the lodge” \(this conversation · last active /);
  assert.match(text, /“Dinner near the lodge” \(last active /);
  assert.match(text, /I haven’t switched anything\./);
  // A non-duplicate current conversation is still marked, and a distinct title carries no date.
  const third = await startThread(s, "Friday dinner", "Friday dinner ideas?");
  const mixed = await s.post(inThread(third, "Open the dinner thread"));
  const shown = mixed.body.navigation.candidates as Array<{ threadId: string; title: string; detail?: string }>;
  assert.equal(shown.find(item => item.threadId === third.id)!.detail, "this conversation");
  assert.match(mixed.body.durableAnswer as string, /“Friday dinner” \(this conversation\)/);
}));
