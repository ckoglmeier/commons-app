import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commons, processedCommands, coordinatorResearchRuns, coordinatorThreadIdeas, coordinatorThreads, coordinatorTurns, CoordinatorTurnError, itineraryItems, loadCoordinatorTripContext, memberships, people, pollDrafts, polls, publicWorkspace, readThreadExcerpt, stays, travelerProfiles, travelPlans } from "@commons/database";
import { actAs, databaseTestsEnabled, eq, fakeProviderResponse, installRouteFetch, jsonRequest, params, withCoordinatorScenario, withTestDatabase, type ProviderCall, type ScenarioContext } from "./coordinator-route-harness";
import { failedWorkspace, withLifecycleView, withThreadMeta } from "../test-support/coordinator-rows";
import { renderTripContextForModel } from "./coordinator-context-prompt";
import { getRecipeRun, publishRecipeRound, reviseRecipeRound, startRecipeRun, submitPublicPollResponseByPublicId } from "@commons/database";
// Goals are on by default; these cases cover the Coordinator paths without them.
process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "false";

// Acceptance-scenario tests for Stage 4 (design §12): real route handlers, real disposable database, a recording
// fake model and a recording fake public search. No real provider, voice session, or remote database is involved.
// Voice turns are the same command with inputMode "voice"; no audio or Live session is exercised here.
const skip = !databaseTestsEnabled;

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Started = { id: string; turnVersion: number; title: string };

async function startThread(s: ScenarioContext, title: string, text = "Where should we eat on Saturday?", reply = "Try the early seating near your stay.", summary = "Leaning toward an early dinner near the stay."): Promise<Started> {
  Object.assign(s.next, { title, reply, summary });
  const result = await s.post(s.command({ text }));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  return { id: result.body.thread.id, turnVersion: result.body.thread.turnVersion, title: result.body.thread.title };
}
const inThread = (thread: { id: string; turnVersion: number }, text: string, over: Record<string, unknown> = {}) => ({ commandId: randomUUID(), target: { kind: "existing", threadId: thread.id, expectedTurnVersion: thread.turnVersion }, inputMode: "text", text, ...over });
const voice = (delegationId = randomUUID()) => ({ inputMode: "voice", voice: { sessionId: "session-test", delegationId } });
const tables = (eventId: string) => withTestDatabase(async db => ({
  threads: await withThreadMeta(db, eventId, await db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, eventId))),
  turns: (await db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, eventId))).map(withLifecycleView),
  drafts: await db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, eventId)),
  polls: await db.select().from(polls).where(eq(polls.commonsId, eventId)),
  runs: await db.select({ run: coordinatorResearchRuns }).from(coordinatorResearchRuns).innerJoin(coordinatorThreads, eq(coordinatorThreads.id, coordinatorResearchRuns.threadId)).where(eq(coordinatorThreads.commonsId, eventId)).then(rows => rows.map(row => row.run)),
  stays: await db.select().from(stays).where(eq(stays.commonsId, eventId)),
}));
const providerBodies = (calls: ProviderCall[]) => JSON.stringify(calls.map(call => call.body));
const userPayload = (call: ProviderCall) => JSON.parse(call.body.messages!.at(-1)!.content) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const capture = (s: ScenarioContext) => s.network.providerCalls.length;

test("saved food answers reach organizer advice but are excluded from participant poll construction", { skip }, () => withCoordinatorScenario(async s => {
  const options = { databaseUrl: process.env.TEST_DATABASE_URL!, actorPersonId: s.trip.organizerId }, runId = randomUUID();
  await startRecipeRun(s.trip.eventId, { commandId: randomUUID(), runId, draftId: randomUUID(), recipe: "food_preferences" }, options);
  const run = await getRecipeRun(s.trip.eventId, runId, options);
  const published = await publishRecipeRound(s.trip.eventId, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, access: "link" }, options);
  await submitPublicPollResponseByPublicId(published.publicId, { respondentName: "Private Food Guest", answers: run.participantPreview!.questions.map((q, index) => ({ questionId: q.id, optionIds: [], text: index ? "" : "PRIVATE_FOOD_CONTEXT_CANARY" })) }, options.databaseUrl);
  const answered = await getRecipeRun(s.trip.eventId, runId, options);
  await reviseRecipeRound(s.trip.eventId, runId, { commandId: randomUUID(), expectedDraftVersion: answered.draft.version }, options);
  const dinner = await startThread(s, "Dinner planning", "What food preferences have people shared?", "For dinner, Private Food Guest has PRIVATE_FOOD_CONTEXT_CANARY.");
  assert.match(providerBodies(s.network.providerCalls), /PRIVATE_FOOD_CONTEXT_CANARY/);
  assert.match(providerBodies(s.network.providerCalls), /earlier|not reconfirmed/);
  const calls = capture(s);
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Which restaurant?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const result = await s.post(inThread(dinner, "Make a new poll asking the group where to eat on Saturday", { artifact: { kind: "poll", id: published.pollId } }));
  assert.equal(result.body.capability, "prepare_poll"); assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  assert.doesNotMatch(providerBodies(s.network.providerCalls.slice(calls)), /PRIVATE_FOOD_CONTEXT_CANARY|Private Food Guest/);
}));

test("food place collisions preserve provider query locations and only explicit reviewed searches retain dietary predicates", { skip }, () => withCoordinatorScenario(async s => {
  await withTestDatabase(async db => {
    await db.update(commons).set({ locationName: "Napa" }).where(eq(commons.id, s.trip.eventId));
    await db.update(stays).set({ name: "Sonoma Valley Lodge", address: "100 Synthetic Ridge Rd, Sonoma, California" }).where(eq(stays.commonsId, s.trip.eventId));
  });
  const options = { databaseUrl: process.env.TEST_DATABASE_URL!, actorPersonId: s.trip.organizerId }, runId = randomUUID();
  await startRecipeRun(s.trip.eventId, { commandId: randomUUID(), runId, draftId: randomUUID(), recipe: "food_preferences" }, options);
  const run = await getRecipeRun(s.trip.eventId, runId, options);
  const published = await publishRecipeRound(s.trip.eventId, runId, { commandId: randomUUID(), expectedDraftVersion: run.draft.version, access: "link" }, options);
  await submitPublicPollResponseByPublicId(published.publicId, { respondentName: "Private Food Guest", answers: run.participantPreview!.questions.map((q, index) => ({ questionId: q.id, optionIds: [], text: index === 0 ? "vegetarian PRIVATE_QUERY_CANARY" : index === 1 ? "Napa cabbage slaw and Sonoma cheese" : "" })) }, options.databaseUrl);
  for (const query of ["restaurants open late in Napa", "wine tasting tours in Napa and Sonoma", "vegetarian restaurants in Napa"]) {
    const response = await s.post(s.command({ text: `/search ${query}` }));
    assert.equal(response.body.status, "completed", JSON.stringify(response.body));
    assert.equal(response.body.capability, "research");
    assert.equal(s.network.tavilyCalls.filter(call => call.path === "search").at(-1)!.body.query, query);
  }
  const inferred = await s.post(s.command({ text: "Search for vegetarian restaurants in Napa" }));
  assert.equal(inferred.body.status, "completed", JSON.stringify(inferred.body));
  const wire = JSON.stringify(s.network.tavilyCalls);
  assert.doesNotMatch(wire, /PRIVATE_QUERY_CANARY|Private Food Guest|cabbage|cheese/);
  assert.equal(s.network.tavilyCalls.filter(call => call.path === "search" && call.body.query === "vegetarian restaurants in Napa").length, 1, "only the explicit query transmitted the dietary predicate");
}));

test("Ask about lodging while in restaurant topic: reads authorized lodging facts, keeps the topic, changes nothing", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const before = await tables(s.trip.eventId), stayBefore = before.stays[0];
  const calls = capture(s);
  const asked = await s.post(inThread(dinner, "What's our lodging address and check-in?"));
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.equal(asked.body.status, "completed");
  assert.equal(asked.body.capability, "retrieve_context");
  assert.equal(asked.body.navigation, null, "asking is not navigating");
  assert.equal(asked.body.thread.id, dinner.id, "the active topic is unchanged");
  assert.deepEqual(asked.body.artifacts, []);
  assert.equal(asked.body.reviewRequired, false);
  const call = s.network.providerCalls[calls];
  assert.equal(call.body.model, "test-mini-model", "grounded retrieval uses the cheap tier");
  const payload = userPayload(call);
  assert.equal(payload.tripContext.stays[0].name, "Synthetic Peak Lodge");
  assert.equal(payload.tripContext.stays[0].address, "100 Synthetic Ridge Rd, Breckenridge, CO");
  assert.equal(payload.otherConversationExcerpts, undefined, "no other thread is read for a saved-fact question");
  const after = await tables(s.trip.eventId);
  assert.deepEqual([after.stays[0].updatedAt.toISOString(), after.stays[0].totalCents, after.stays[0].address], [stayBefore.updatedAt.toISOString(), stayBefore.totalCents, stayBefore.address], "lodging is not modified");
  assert.deepEqual([after.drafts.length, after.polls.length, after.threads.length], [0, 0, 2]);
  assert.equal(after.turns.filter(turn => turn.threadId === lodging.id).length, 1, "the lodging thread gained nothing");
  assert.equal(after.turns.filter(turn => turn.threadId === dinner.id).length, 2, "the question is saved in the topic it was asked in");
  // Advice is not a lookup: it uses the conversation tier.
  const advice = await s.post(inThread({ id: dinner.id, turnVersion: asked.body.thread.turnVersion }, "Where should we stay next time?"));
  assert.equal(advice.body.capability, "answer");
  assert.equal(s.network.providerCalls.at(-1)!.body.model, "test-base-model");
}));

test("Explicitly continue in lodging thread: opens the unique target, acknowledges the switch, later turns attach there", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const before = await tables(s.trip.eventId), calls = capture(s);
  const request = inThread(dinner, "Continue this in lodging");
  const nav = await s.post(request);
  assert.equal(nav.status, 200, JSON.stringify(nav.body));
  assert.equal(nav.body.capability, "navigate_thread");
  assert.deepEqual(nav.body.navigation, { kind: "switched", threadId: lodging.id, title: lodging.title });
  assert.match(nav.body.durableAnswer, /^Opened “Lodging costs”\./);
  assert.equal(nav.body.thread.id, dinner.id, "the receipt lives in the origin thread");
  assert.equal(capture(s), calls, "navigation is model-free");
  assert.deepEqual(nav.body.artifacts, []);
  // A retry (or a reload) reports the same switch and does not repeat it.
  const looked = await s.lookup(request.commandId);
  assert.deepEqual(looked.body.navigation, nav.body.navigation);
  const after = await tables(s.trip.eventId);
  assert.deepEqual([after.drafts.length, after.polls.length, after.runs.length, after.threads.length], [before.drafts.length, before.polls.length, before.runs.length, before.threads.length], "nothing was created, moved, or copied");
  assert.equal(after.turns.filter(turn => turn.threadId === lodging.id).length, before.turns.filter(turn => turn.threadId === lodging.id).length);
  // The client loads the target thread for its history and version, then the next turn attaches there.
  const opened = await s.thread(lodging.id);
  const next = await s.post(inThread({ id: lodging.id, turnVersion: opened.version }, "How much was the lodging total?"));
  assert.equal(next.status, 200, JSON.stringify(next.body));
  assert.equal(next.body.thread.id, lodging.id);
  const later = await tables(s.trip.eventId);
  assert.equal(later.turns.find(turn => turn.id === next.body.turnId)!.threadId, lodging.id);
  // A move-worded request navigates but says honestly that nothing moved.
  const moved = await s.post(inThread({ id: dinner.id, turnVersion: nav.body.thread.turnVersion }, "Move this to lodging"));
  assert.equal(moved.body.navigation.kind, "switched");
  assert.match(moved.body.durableAnswer, /moving messages isn’t supported yet/);
}));

test("Two possible dinner threads: one focused clarification, no arbitrary selection", { skip }, () => withCoordinatorScenario(async s => {
  const friday = await startThread(s, "Friday dinner", "Friday dinner ideas?");
  const saturday = await startThread(s, "Saturday dinner", "Saturday dinner ideas?");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const calls = capture(s), before = await tables(s.trip.eventId);
  const asked = await s.post(inThread(lodging, "Open the dinner thread"));
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.equal(asked.body.navigation.kind, "clarify");
  assert.deepEqual(asked.body.navigation.candidates.map((candidate: { threadId: string }) => candidate.threadId).sort(), [friday.id, saturday.id].sort());
  assert.match(asked.body.durableAnswer, /Which one do you mean/);
  assert.match(asked.body.durableAnswer, /I haven’t switched anything/);
  assert.equal(capture(s), calls, "no model call and no guess");
  assert.equal((await tables(s.trip.eventId)).turns.length, before.turns.length + 1, "exactly one clarification turn was saved");
  // The organizer's choice is a client-side open of one candidate; a unique phrase resolves directly.
  const unique = await s.post(inThread({ id: lodging.id, turnVersion: asked.body.thread.turnVersion }, "Open the Friday dinner thread"));
  assert.deepEqual(unique.body.navigation, { kind: "switched", threadId: friday.id, title: friday.title });
  // A reference across the two dinner threads is also one clarification, and reads nothing.
  const reference = await s.post(inThread({ id: lodging.id, turnVersion: unique.body.thread.turnVersion }, "Use the dinner options we discussed"));
  assert.equal(reference.body.capability, "retrieve_context");
  assert.equal(reference.body.navigation, null);
  assert.match(reference.body.durableAnswer, /more than one conversation/);
  assert.match(reference.body.durableAnswer, /Friday dinner/);
  assert.match(reference.body.durableAnswer, /Saturday dinner/);
  assert.equal(capture(s), calls, "still no model call");
}));

test("navigation to an unknown, archived, or current thread is answered plainly and never guessed", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const old = await startThread(s, "Old lunch ideas", "Lunch ideas?");
  await withTestDatabase(db => db.update(coordinatorThreads).set({ status: "archived", archivedAt: new Date() }).where(eq(coordinatorThreads.id, old.id)));
  const calls = capture(s);
  const unknown = await s.post(inThread(dinner, "Open the spa thread"));
  assert.equal(unknown.body.navigation, null);
  assert.match(unknown.body.durableAnswer, /couldn’t find a thread that matches/);
  const archived = await s.post(inThread({ id: dinner.id, turnVersion: unknown.body.thread.turnVersion }, "Open the Old lunch ideas thread"));
  assert.equal(archived.body.navigation, null);
  assert.match(archived.body.durableAnswer, /is archived\. Restore it on screen/);
  const here = await s.post(inThread({ id: dinner.id, turnVersion: archived.body.thread.turnVersion }, "Continue this in the dinner thread"));
  assert.equal(here.body.navigation, null);
  assert.match(here.body.durableAnswer, /already in “Saturday dinner”/);
  assert.equal(capture(s), calls, "none of these needed the model");
}));

test("Use the dinner options we discussed: an unambiguous reference reads that thread, attributed, without moving the topic or promoting it", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner", "Where should we eat on Saturday?", "Options: Alpine Table (early seating) or Ridge Grill (quiet).", "Comparing Alpine Table and Ridge Grill.");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const before = await tables(s.trip.eventId), calls = capture(s);
  s.next.reply = "From the Saturday dinner thread, Alpine Table has early seating, so it fits a stay nearby. That's still just an idea from that thread.";
  const result = await s.post(inThread(lodging, "Use the dinner options we discussed to pick a place near the lodge"));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.capability, "retrieve_context");
  assert.equal(result.body.navigation, null);
  assert.equal(result.body.thread.id, lodging.id, "reading another thread does not move the conversation");
  const call = s.network.providerCalls[calls], payload = userPayload(call);
  assert.equal(call.body.model, "test-mini-model");
  assert.equal(payload.otherConversationExcerpts.length, 1);
  assert.equal(payload.otherConversationExcerpts[0].threadId, dinner.id);
  assert.equal(payload.otherConversationExcerpts[0].title, "Saturday dinner");
  assert.match(JSON.stringify(payload.otherConversationExcerpts), /Alpine Table \(early seating\)/);
  assert.match(call.body.messages!.map(message => message.content).join("\n"), /tentative discussion from other conversations/);
  const thread = result.body.sources.find((source: { kind: string }) => source.kind === "thread");
  assert.equal(thread.threadId, dinner.id, "attributed to its source thread");
  assert.equal(thread.turnIds.length, 1);
  const after = await tables(s.trip.eventId);
  assert.deepEqual([after.stays[0].updatedAt.toISOString(), after.drafts.length, after.polls.length], [before.stays[0].updatedAt.toISOString(), 0, 0], "reading is not promotion");
  assert.equal(after.turns.filter(turn => turn.threadId === dinner.id).length, 1, "the source thread is untouched");
}));

test("Request a poll explicitly: the draft is linked to the origin thread and construction saves a private draft and publishing stays separate", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const calls = capture(s);
  s.next.reply = "I've drafted a question for review.";
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Which restaurant?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const request = inThread(dinner, "Make a poll asking the group where to eat on Saturday");
  const result = await s.post(request);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.capability, "prepare_poll");
  assert.equal(capture(s), calls + 1);
  const saved = await tables(s.trip.eventId);
  assert.equal(saved.drafts.length, 1);
  const [draft] = saved.drafts;
  assert.deepEqual([draft.threadId, draft.organizerShared, draft.publishedPollId, draft.version, draft.data.questions.length], [dinner.id, true, null, 1, 1], "a populated private organizer draft in the origin thread");
  const kinds = result.body.artifacts.map((artifact: { kind: string }) => artifact.kind).sort();
  assert.deepEqual(kinds, ["poll_draft"]);
  assert.ok(result.body.artifacts.every((artifact: { threadId: string }) => artifact.threadId === dinner.id));
  assert.equal(result.body.artifacts.find((artifact: { kind: string }) => artifact.kind === "poll_draft").id, draft.id);
  assert.equal(result.body.reviewRequired, true);
  assert.equal(saved.polls.length, 0, "nothing is published or shared");
  const turn = saved.turns.find(item => item.id === result.body.turnId)!;
  assert.equal(turn.draftId, draft.id);
  assert.equal(turn.workspace?.proposal, undefined);
  // Replaying the same command creates no second draft.
  await s.post(request);
  assert.equal((await tables(s.trip.eventId)).drafts.length, 1);
}));

test("Start a new restaurant topic — no unsolicited poll draft, however the group is mentioned", { skip }, () => withCoordinatorScenario(async s => {
  const opener = await s.post(s.command({ text: "We're driving up from Denver on Friday. Where should the family eat dinner around 5 p.m.?", ...voice() }));
  assert.equal(opener.body.capability, "answer");
  let thread = { id: opener.body.thread.id as string, turnVersion: opener.body.thread.turnVersion as number };
  for (const text of ["How does a poll work?", "Would the group like early seating?", "What did the poll say about lodging?", "Anyone in the group vegetarian?"]) {
    const turn = await s.post(inThread(thread, text));
    assert.equal(turn.body.capability, "answer", text);
    thread = { id: thread.id, turnVersion: turn.body.thread.turnVersion };
  }
  const saved = await tables(s.trip.eventId);
  assert.deepEqual([saved.drafts.length, saved.polls.length, saved.threads.length], [0, 0, 1]);
  assert.ok(saved.turns.every(turn => publicWorkspace(turn.workspace) === null), "no proposal, draft, or artifact on ordinary advice");
  // The explicit UI action is the other way in, and it still creates one draft in the thread.
  s.next.extra = { operations: [{ kind: "add_text_question", prompt: "Where would you like to eat?", required: false }] };
  const explicit = await s.post(inThread(thread, "Ask the group where they want to eat", { explicitAction: { kind: "ask_group", starterId: null } }));
  assert.equal(explicit.body.capability, "prepare_poll");
  assert.equal((await tables(s.trip.eventId)).drafts.length, 1);
}));

test("Clear attendance statement: attributed receipt with Undo, no poll, no Save step, from text and from voice", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const calls = capture(s);
  const said = await s.post(inThread(dinner, "Robin and I are attending", { ...voice() }));
  assert.equal(said.status, 200, JSON.stringify(said.body));
  assert.equal(said.body.capability, "record_attendance");
  assert.equal(said.body.reviewRequired, false);
  assert.equal(capture(s), calls, "attendance is model-free");
  const receipt = said.body.artifacts.find((artifact: { kind: string }) => artifact.kind === "attendance_receipt");
  assert.deepEqual([receipt.undoable, receipt.threadId], [true, dinner.id]);
  assert.match(said.body.durableAnswer, /You and Robin Synthetic are marked as attending for Feb 12–15, 2027\./);
  assert.doesNotMatch(said.body.durableAnswer, /2027-02/);
  assert.match(said.body.spokenReply, /Feb 12–15, 2027/, "the spoken text uses the same human dates");
  const rows = await tables(s.trip.eventId);
  assert.deepEqual([rows.drafts.length, rows.polls.length], [0, 0], "no poll and no draft");
  const turn = rows.turns.find(item => item.id === said.body.turnId)!;
  assert.deepEqual(turn.workspace?.attendanceReceipt?.people.map(person => person.name).sort(), ["Casey Synthetic", "Robin Synthetic"]);
  assert.equal(turn.inputMode, "voice");
  const attending = async () => (await withTestDatabase(db => db.select().from(memberships).where(eq(memberships.commonsId, s.trip.eventId)))).filter(member => member.attendanceState === "attending").map(member => member.personId).sort();
  assert.deepEqual(await attending(), [s.trip.organizerId, s.trip.coOrganizerId].sort());
  // Undo lives on the receipt.
  actAs(s.trip.organizerId);
  const undo = await s.routes.turn.PATCH(jsonRequest(s.trip.eventId, "", "PATCH", { turnId: said.body.turnId, threadId: dinner.id, commandId: randomUUID(), action: "undo_attendance" }), params(s.trip.eventId));
  assert.equal(undo.status, 200);
  assert.deepEqual(await attending(), []);
  // Text works the same way.
  const text = await s.post(inThread({ id: dinner.id, turnVersion: said.body.thread.turnVersion }, "I am attending the trip."));
  assert.equal(text.body.capability, "record_attendance");
  assert.deepEqual(await attending(), [s.trip.organizerId]);
}));

test("ambiguous attendance asks one clarification and changes nothing", { skip }, () => withCoordinatorScenario(async s => {
  await withTestDatabase(async db => {
    const other = randomUUID();
    await db.insert(people).values({ id: other, displayName: "Robin Different", authUserId: other });
    await db.insert(memberships).values({ commonsId: s.trip.eventId, personId: other, role: "member", status: "active" });
  });
  const dinner = await startThread(s, "Saturday dinner");
  const calls = capture(s);
  const said = await s.post(inThread(dinner, "Robin and I are attending", { ...voice() }));
  assert.equal(said.body.status, "completed");
  assert.equal(said.body.capability, "record_attendance");
  assert.match(said.body.durableAnswer, /Who do you mean\? Name the travelers/);
  assert.deepEqual(said.body.artifacts, [], "no receipt, so nothing to undo");
  assert.equal(said.body.reviewRequired, false);
  assert.equal(capture(s), calls);
  const rows = await tables(s.trip.eventId);
  assert.deepEqual([rows.drafts.length, rows.polls.length], [0, 0], "never a poll or a Save step");
  const members = await withTestDatabase(db => db.select().from(memberships).where(eq(memberships.commonsId, s.trip.eventId)));
  assert.equal(members.filter(member => member.attendanceState === "attending").length, 0, "nothing was recorded");
}));

test("Ask to update stay with cost: a complete proposal with amount and intended stay, nothing applied before review", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const stayBefore = (await tables(s.trip.eventId)).stays[0], calls = capture(s);
  const suggestion = { operations: ["stay"], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: s.trip.stayId, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: 210_000, stayBookingUrl: null, stayStatus: null };
  Object.assign(s.next, { reply: "I can prepare that lodging update.", extra: { tripSuggestion: suggestion } });
  const result = await s.post(inThread(dinner, "Update our stay: the total lodging cost is $2,100."));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.capability, "propose_trip_change");
  assert.equal(s.network.providerCalls[calls].body.model, "test-mini-model", "structured extraction uses the cheap tier");
  assert.equal(result.body.reviewRequired, true);
  assert.equal(result.body.artifacts[0].kind, "trip_change_proposal");
  const saved = await tables(s.trip.eventId);
  const proposal = saved.turns.find(turn => turn.id === result.body.turnId)!.workspace!.tripProposal!;
  assert.equal(proposal.state, "pending");
  assert.deepEqual([proposal.changes.stay?.id, proposal.changes.stay?.totalCents, proposal.changes.stay?.name, proposal.base.stay?.totalCents, proposal.operations], [s.trip.stayId, 210_000, "Synthetic Peak Lodge", 184_000, ["stay"]], "amount and intended stay are both present");
  assert.equal(proposal.changes.includedPersonIds.length, 3, "included travelers are carried, not invented");
  assert.deepEqual([saved.stays[0].totalCents, saved.stays[0].updatedAt.toISOString()], [184_000, stayBefore.updatedAt.toISOString()], "nothing is applied before review");
  assert.match(result.body.durableAnswer, /Nothing is saved yet/);
  // Without an amount the proposal is not fabricated; the coordinator says what is missing.
  Object.assign(s.next, { reply: "What total should I record for the stay?", extra: { tripSuggestion: { ...suggestion, stayTotalCents: null } } });
  const missing = await s.post(inThread({ id: dinner.id, turnVersion: result.body.thread.turnVersion }, "Update the lodging cost"));
  assert.equal(missing.body.status, "completed");
  assert.equal(missing.body.reviewRequired, false);
  assert.deepEqual(missing.body.artifacts, []);
  assert.equal((await tables(s.trip.eventId)).stays[0].totalCents, 184_000);
  // Voice "yes, apply it" cannot apply it.
  const approve = await s.post(inThread({ id: dinner.id, turnVersion: missing.body.thread.turnVersion }, "Yes, apply it", { ...voice() }));
  assert.deepEqual([approve.body.capability, approve.body.error], ["unsupported", null]);
  assert.match(approve.body.durableAnswer, /Approval happens on screen/);
  const finalRows = await tables(s.trip.eventId);
  assert.equal(finalRows.turns.find(turn => turn.id === result.body.turnId)!.workspace!.tripProposal!.state, "pending");
  assert.equal(finalRows.stays[0].totalCents, 184_000);
}));

// Funded live eval (gpt-4.1-mini, openai policy): with a stay proposal pending, "Don't choose option 2" routed to answer, the model volunteered a
// tripSuggestion whose stayId kept its "stay:" context prefix, and the whole turn failed with provider_failed.
test("an answer turn with an invalid unsolicited tripSuggestion keeps the answer and creates no proposal", { skip }, () => withCoordinatorScenario(async s => {
  const lodging = await startThread(s, "Lodging");
  const suggestion = { operations: ["stay"], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: s.trip.stayId, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: 210_000, stayBookingUrl: null, stayStatus: null };
  Object.assign(s.next, { reply: "I can prepare that lodging update.", extra: { tripSuggestion: suggestion } });
  const proposed = await s.post(inThread(lodging, "Update our stay: the total lodging cost is $2,100."));
  assert.equal(proposed.body.capability, "propose_trip_change", JSON.stringify(proposed.body));
  const reply = "Understood, option 2 is off the table. The saved stay is still Synthetic Peak Lodge.";
  Object.assign(s.next, { reply, extra: { tripSuggestion: { ...suggestion, stayId: `stay:${s.trip.stayId}` } } });
  const result = await s.post(inThread({ id: lodging.id, turnVersion: proposed.body.thread.turnVersion }, "Don't choose option 2"));
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual([result.body.status, result.body.capability, result.body.error, result.body.reviewRequired, result.body.artifacts], ["completed", "answer", null, false, []]);
  assert.equal(result.body.durableAnswer, reply);
  const saved = await tables(s.trip.eventId);
  const turn = saved.turns.find(row => row.id === result.body.turnId)!;
  assert.equal(turn.assistantText, reply, "the answer is saved");
  assert.equal(turn.workspace?.tripProposal, undefined, "no proposal from the dropped suggestion");
  assert.equal(saved.turns.find(row => row.id === proposed.body.turnId)!.workspace!.tripProposal!.state, "pending", "the earlier proposal is untouched");
  assert.equal(saved.stays[0].totalCents, 184_000);
  // A real trip-change turn keeps the strict id validation: the same invalid id still fails rather than being dropped or loosened.
  const strict = await s.post(inThread({ id: lodging.id, turnVersion: result.body.thread.turnVersion }, "Update our stay: the total lodging cost is $2,100."));
  assert.deepEqual([strict.body.status, strict.body.error?.code ?? strict.body.error], ["failed", "provider_failed"], JSON.stringify(strict.body));
}));

test("Research by text and voice input modes: one bounded capability, sources saved to the origin thread, no private data in the query", { skip }, () => withCoordinatorScenario(async s => {
  const secret = "Look up kid-friendly dinner spots near Synthetic Peak Lodge at 100 Synthetic Ridge Rd for Robin's family, budget $200 total, confirmation ABC123XYZ, call +1 (970) 555-0142 or casey.private@example.com.";
  const textOpener = await startThread(s, "Text research topic");
  const voiceOpener = await startThread(s, "Voice research topic");
  s.next.reply = "Alpine Table looks family-friendly; availability and prices are unverified, so confirm with the restaurant.";
  const calls = capture(s);
  const byText = await s.post(inThread(textOpener, secret));
  const byVoice = await s.post(inThread(voiceOpener, secret, { ...voice() }));
  for (const result of [byText, byVoice]) {
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.capability, "research");
    assert.equal(result.body.artifacts.find((artifact: { kind: string }) => artifact.kind === "research_run").kind, "research_run");
  }
  assert.equal(byText.body.thread.id, textOpener.id);
  assert.equal(byVoice.body.thread.id, voiceOpener.id);
  const searches = s.network.tavilyCalls.filter(call => call.path === "search");
  assert.equal(searches.length, 2, "the same bounded capability ran for both input modes");
  assert.equal(searches[0].body.query, searches[1].body.query);
  assert.equal(searches[0].body.query, "kid-friendly dinner spots in Breckenridge, Colorado");
  const wire = JSON.stringify(s.network.tavilyCalls);
  for (const leaked of ["Synthetic", "Robin", "Casey", "Taylor", "100 ", "Ridge", "$200", "ABC123", "555", "@", "peanut", "budget"]) assert.equal(wire.includes(leaked), false, `${leaked} must not reach the public search`);
  assert.ok(s.network.tavilyCalls.filter(call => call.path === "extract").every(call => call.body.urls!.every(url => url.startsWith("https://"))));
  const saved = await tables(s.trip.eventId);
  assert.equal(saved.runs.length, 2);
  assert.deepEqual(saved.runs.map(run => run.threadId).sort(), [textOpener.id, voiceOpener.id].sort(), "each run is saved to its origin thread");
  for (const run of saved.runs) {
    assert.equal(run.query, "kid-friendly dinner spots in Breckenridge, Colorado", "the saved run records the exact query sent");
    assert.ok(run.sources.length > 0 && run.sources.every(source => Boolean(source.retrievedAt)), "sources with freshness");
    assert.ok(run.limitations.some(limitation => /not a booking quote or confirmation of availability/.test(limitation)), "the unverified-availability caveat is saved");
  }
  assert.deepEqual(saved.turns.filter(turn => turn.workspace?.research).map(turn => turn.inputMode).sort(), ["text", "voice"]);
  // The model saw the evidence as untrusted research, not as instructions.
  assert.match(providerBodies(s.network.providerCalls.slice(calls)), /read-only research worker/);
  // A typed, reviewed query gets the same second check.
  const typed = await s.post(inThread({ id: textOpener.id, turnVersion: byText.body.thread.turnVersion }, "Find options", { explicitAction: { kind: "research", query: "Restaurants for Casey Synthetic near 100 Synthetic Ridge Rd, ref ABC123XYZ" } }));
  assert.equal(typed.body.capability, "research");
  const typedQuery = s.network.tavilyCalls.filter(call => call.path === "search").at(-1)!.body.query!;
  assert.doesNotMatch(typedQuery, /Casey|Synthetic|100|ABC123/);
  assert.match(typedQuery, /Restaurants/);
  const typedRun = (await tables(s.trip.eventId)).runs.find(run => run.query === typedQuery)!;
  assert.ok(typedRun.limitations.some(limitation => /Private trip details were removed/.test(limitation)));
  // Nothing substantive left after removing private terms: nothing is searched.
  const before = s.network.tavilyCalls.length, providerBefore = capture(s);
  const unsafe = await s.post(inThread({ id: textOpener.id, turnVersion: typed.body.thread.turnVersion }, "Look up Casey Synthetic and Robin Synthetic", { ...voice() }));
  assert.deepEqual([unsafe.body.capability, unsafe.body.error], ["unsupported", null]);
  assert.match(unsafe.body.durableAnswer, /nothing was searched/);
  assert.deepEqual([s.network.tavilyCalls.length, capture(s)], [before, providerBefore]);
  // Without a search key, an explicit research action is refused before anything is saved; an inferred request is just conversation.
  const key = process.env.TAVILY_API_KEY; delete process.env.TAVILY_API_KEY;
  try {
    const refused = await s.post(inThread({ id: textOpener.id, turnVersion: unsafe.body.thread.turnVersion }, "Find options", { explicitAction: { kind: "research", query: "family restaurants" } }));
    assert.deepEqual([refused.status, refused.body.error.code], [503, "provider_not_configured"]);
    const inferred = await s.post(inThread({ id: textOpener.id, turnVersion: unsafe.body.thread.turnVersion }, "Look up kid-friendly dinner spots"));
    assert.equal(inferred.body.capability, "answer");
  } finally { process.env.TAVILY_API_KEY = key; }
}));

test("unsupported capability answered honestly: booking, payment, calendar, external messages, merge and move requests change nothing", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  await startThread(s, "Lodging costs", "Let's talk about lodging.", "Lodging was booked earlier.");
  const before = await tables(s.trip.eventId), calls = capture(s);
  // The trip is at its hourly inference limit: honest refusals and other model-free answers neither count against it nor wait on it.
  await withTestDatabase(db => db.insert(processedCommands).values(Array.from({ length: 100 }, (_, index) => ({ commonsId: s.trip.eventId, commandId: `seeded-${index}`, result: { kind: "poll_inference", actorPersonId: s.trip.organizerId } }))));
  const reservations = () => withTestDatabase(async db => (await db.select().from(processedCommands).where(eq(processedCommands.commonsId, s.trip.eventId))).filter(row => (row.result as { kind?: string }).kind === "poll_inference").length);
  const reservedBefore = await reservations();
  let thread = dinner;
  const cases: Array<[string, "text" | "voice", RegExp]> = [
    ["Book it", "text", /can’t book or reserve anything, and nothing was booked/],
    ["Can you reserve the lodge for us?", "voice", /can’t book or reserve anything/],
    ["Pay the deposit", "text", /can’t make payments or move money, and nothing was charged/],
    ["Add this to my calendar", "voice", /can’t add anything to a calendar/],
    ["Email the group the plan", "text", /can’t send custom messages or emails for you, and nothing was sent/],
    ["Text everyone the address", "voice", /nothing was sent/],
    ["Merge the dinner and lodging threads", "text", /Merging or splitting threads isn’t supported yet, and nothing changed/],
    ["Move these messages to lodging", "text", /Moving messages or drafts between threads isn’t supported yet, and nothing was moved/],
  ];
  for (const [text, mode, expected] of cases) {
    const result = await s.post(inThread(thread, text, mode === "voice" ? voice() : {}));
    assert.equal(result.status, 200, `${text}: ${JSON.stringify(result.body)}`);
    assert.deepEqual([result.body.status, result.body.capability, result.body.error, result.body.navigation, result.body.artifacts, result.body.reviewRequired], ["completed", "unsupported", null, null, [], false], text);
    assert.match(result.body.durableAnswer, expected, text);
    assert.equal(result.body.spokenReply.length > 0 && result.body.spokenReply.length <= 600, true);
    thread = { ...thread, turnVersion: result.body.thread.turnVersion };
  }
  assert.equal(capture(s), calls, "an honest refusal never spends a model call");
  const after = await tables(s.trip.eventId);
  assert.deepEqual([after.drafts.length, after.polls.length, after.threads.length, after.runs.length, after.stays[0].updatedAt.toISOString()], [0, 0, before.threads.length, 0, before.stays[0].updatedAt.toISOString()]);
  assert.equal(await reservations(), reservedBefore, "no quota slot was used");
  // A report is not a request, so it is conversation, and conversation needs a model call the limit still governs.
  const report = await s.post(inThread(thread, "We booked the lodge last month"));
  assert.deepEqual([report.status, report.body.error.code], [429, "rate_limited"]);
  await withTestDatabase(db => db.delete(processedCommands).where(eq(processedCommands.commonsId, s.trip.eventId)));
  const allowed = await s.post(inThread(thread, "We booked the lodge last month"));
  assert.equal(allowed.body.capability, "answer", JSON.stringify(allowed.body));
}));

test("book requests that carry planning substance are answered with the limit stated first, by code", { skip }, () => withCoordinatorScenario(async s => {
  const notice = "I can’t book or reserve anything, and nothing was booked.";
  // Probe: "lock in" means decide, so no limit notice at all.
  const lock = await s.post(s.command({ text: "Let's lock in the dinner plan for Saturday" }));
  assert.equal(lock.body.capability, "answer");
  assert.doesNotMatch(lock.body.durableAnswer, /can’t book/);
  // Probe: an actionable request with substance is answered, not merely refused.
  s.next.reply = "Alpine Table has 5:00 seatings a short drive from your stay. You would need to reserve with the restaurant yourself.";
  const calls = capture(s);
  const probe = await s.post(s.command({ text: "Book us a table for dinner around 5 near the condo" }));
  assert.equal(probe.status, 200, JSON.stringify(probe.body));
  assert.equal(probe.body.capability, "answer");
  assert.ok(probe.body.durableAnswer.startsWith(notice), probe.body.durableAnswer);
  assert.match(probe.body.durableAnswer, /Alpine Table has 5:00 seatings/);
  assert.equal(capture(s), calls + 1);
  // CK-style: driving from Denver, book somewhere for dinner around 5.
  const beforeCall = capture(s);
  const ck = await s.post(s.command({ text: "We're driving from Denver; book us somewhere for dinner around 5", ...voice() }));
  assert.equal(ck.status, 200, JSON.stringify(ck.body));
  assert.equal(ck.body.capability, "answer");
  assert.ok(ck.body.durableAnswer.startsWith(notice), "the notice comes first in the durable answer");
  assert.ok(ck.body.spokenReply.startsWith(notice), "and in the spoken reply");
  assert.ok(ck.body.spokenReply.length <= 600);
  assert.doesNotMatch(ck.body.durableAnswer, /(?:I(?:'ve| have)|Commons) (?:booked|reserved)|is (?:now )?booked/i);
  const call = s.network.providerCalls[beforeCall];
  const system = call.body.messages!.filter(message => message.role === "system").map(message => message.content).join("\n");
  assert.match(system, /request to book or reserve something\. Commons cannot do that/);
  assert.match(system, /Never say or imply that anything was booked/);
  assert.equal(userPayload(call).tripContext.stays[0].name, "Synthetic Peak Lodge", "the saved stay is in the request");
  assert.equal(call.body.model, "test-base-model");
  const rows = await tables(s.trip.eventId);
  assert.deepEqual([rows.drafts.length, rows.polls.length, rows.runs.length], [0, 0, 0], "no draft or proposal");
  assert.equal(publicWorkspace(rows.turns.find(turn => turn.id === ck.body.turnId)!.workspace), null);
  // A model that claims it booked something is replaced, and the notice still leads.
  s.next.reply = "I've booked Alpine Table for 5 p.m.";
  const claimed = await s.post(s.command({ text: "Book us a table for dinner around 5 near the condo" }));
  assert.ok(claimed.body.durableAnswer.startsWith(notice));
  assert.doesNotMatch(claimed.body.durableAnswer, /I've booked/);
  const logs = s.infoLogs.filter(entry => entry.name === "commons.coordinator.turn").map(entry => entry.detail as Body);
  assert.equal(logs.at(-1)!.outcome, "answered_with_limit_notice");
  assert.equal(logs.at(-1)!.unsupportedReason, "booking");
}));

test("a bare booking request stays model-free and takes no quota slot", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const reservations = () => withTestDatabase(async db => (await db.select().from(processedCommands).where(eq(processedCommands.commonsId, s.trip.eventId))).filter(row => (row.result as { kind?: string }).kind === "poll_inference").length);
  const [calls, reserved] = [capture(s), await reservations()];
  const bare = await s.post(inThread(dinner, "Book it"));
  assert.deepEqual([bare.body.capability, bare.body.error], ["unsupported", null]);
  assert.match(bare.body.durableAnswer, /^I can’t book or reserve anything, and nothing was booked\. I can help compare options/);
  assert.deepEqual([capture(s), await reservations()], [calls, reserved], "no model call and no quota row");
}));

test("Start a separate thread creates one named thread and moves nothing", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const before = await tables(s.trip.eventId), calls = capture(s);
  const request = inThread(dinner, "Start a separate thread for the ski lessons");
  const result = await s.post(request);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.capability, "navigate_thread");
  assert.equal(result.body.navigation.kind, "created");
  assert.equal(result.body.navigation.title, "ski lessons");
  assert.equal(capture(s), calls);
  const created = result.body.navigation.threadId as string;
  const saved = await tables(s.trip.eventId);
  assert.equal(saved.threads.length, before.threads.length + 1);
  const row = saved.threads.find(thread => thread.id === created)!;
  assert.deepEqual([row.title, row.titleSource, row.status], ["ski lessons", "provisional", "active"]);
  assert.equal(saved.turns.filter(turn => turn.threadId === created).length, 0, "the new thread starts empty; nothing was moved or copied");
  assert.deepEqual([saved.drafts.length, saved.polls.length, saved.runs.length], [0, 0, 0]);
  assert.deepEqual(result.body.artifacts.map((artifact: { kind: string; threadId: string; id: string }) => [artifact.kind, artifact.threadId, artifact.id]), [["thread", dinner.id, created]], "the receipt carries the origin thread");
  // Replay and lookup do not create a second thread.
  const again = await s.post(request), looked = await s.lookup(request.commandId);
  assert.deepEqual([again.body.navigation, looked.body.navigation], [result.body.navigation, result.body.navigation]);
  assert.equal((await tables(s.trip.eventId)).threads.length, before.threads.length + 1);
  // The first real turn there names it and is attached to it.
  s.next.title = "Ski lesson options";
  const opened = await s.thread(created);
  const first = await s.post(inThread({ id: created, turnVersion: opened.version }, "Which ski lessons suit young kids?"));
  assert.equal(first.body.thread.id, created);
  assert.equal(first.body.thread.title, "Ski lesson options");
}));

test("a late response attaches to its origin thread after navigation", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  s.network.restore();
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const slow = installRouteFetch(s.routes, { provider: async body => {
    const mine = calls += 1;
    if (mine === 1) await gate;
    return fakeProviderResponse(body as never, mine === 1 ? "Slow answer about kids' dinner." : "Answer about lodging.", null, { threadSummary: null, openQuestions: [] });
  } });
  try {
    const slowTurn = s.post(inThread(dinner, "Which restaurant is best for kids?"));
    for (let attempt = 0; attempt < 100 && calls < 1; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 1, "the first turn is in flight");
    // Meanwhile the organizer navigated to lodging and asked something there.
    const quick = await s.post(inThread(lodging, "Who is included in the stay question?"));
    assert.equal(quick.body.status, "completed");
    assert.equal(quick.body.thread.id, lodging.id);
    release();
    const late = await slowTurn;
    assert.equal(late.body.status, "completed", JSON.stringify(late.body));
    assert.equal(late.body.thread.id, dinner.id, "the late answer belongs to the thread it was asked in");
    assert.match(late.body.durableAnswer, /Slow answer/);
    const saved = await tables(s.trip.eventId);
    const dinnerText = saved.turns.filter(turn => turn.threadId === dinner.id).map(turn => turn.assistantText).join("|");
    const lodgingText = saved.turns.filter(turn => turn.threadId === lodging.id).map(turn => turn.assistantText).join("|");
    assert.match(dinnerText, /Slow answer/);
    assert.doesNotMatch(lodgingText, /Slow answer/);
    assert.match(lodgingText, /Answer about lodging/);
  } finally { release(); slow.restore(); }
}));

test("thread summaries stay attributed, bounded, and never become trip facts", { skip }, () => withCoordinatorScenario(async s => {
  const tentative = "Group is tentatively leaning to Alpine Table for Saturday; nobody has decided. ".repeat(12);
  assert.ok(tentative.length > 400);
  Object.assign(s.next, { questions: ["Which restaurant?", "What time?", "How many kids?", "Anything else?"] });
  const dinner = await startThread(s, "Saturday dinner", "Where should we eat on Saturday?", "Try Alpine Table.", tentative);
  const [row] = (await tables(s.trip.eventId)).threads;
  assert.ok(row.summary!.length <= 400, "bounded");
  assert.equal(row.summaryTurnVersion, 1);
  assert.equal(row.openQuestions.length, 3, "at most three open questions");
  const context = await loadCoordinatorTripContext(s.trip.eventId, { databaseUrl: process.env.TEST_DATABASE_URL!, actorPersonId: s.trip.organizerId, sharedCoordinator: true, activeThreadId: dinner.id });
  const entry = context.threads.find(thread => thread.threadId === dinner.id)!;
  assert.deepEqual([entry.summary, entry.summaryTurnVersion, entry.approvedOutcomes], [row.summary, 1, []], "a summary is not an approved outcome");
  const facts = JSON.stringify({ trip: context.trip, stays: context.stays, budget: context.budget, plans: context.plans, polls: context.polls, travelers: context.travelers, unknowns: context.unknowns });
  assert.equal(facts.includes("Alpine Table"), false, "the summary never becomes a trip fact");
  const rendered = JSON.parse(renderTripContextForModel(context, { maxChars: 6_000, focusThreadId: dinner.id }).json);
  assert.match(rendered.conversations[0].tentativeSummary, /tentatively leaning/);
  assert.equal(JSON.stringify({ trip: rendered.trip, stays: rendered.stays, budget: rendered.budget }).includes("Alpine Table"), false);
  // A later turn refreshes the summary and marks which turn it reflects.
  s.next.summary = "Now comparing two places.";
  const later = await s.post(inThread(dinner, "What about lunch?"));
  const [updated] = (await tables(s.trip.eventId)).threads;
  assert.deepEqual([updated.summary, updated.summaryTurnVersion, later.body.thread.turnVersion], ["Now comparing two places.", 2, 2]);
}));

test("thread index and retrieval exclude legacy private turns, failed attempts, other trips and restricted details, including in model requests", { skip }, () => withCoordinatorScenario(async s => {
  const markers = { legacy: "MARKER-LEGACY-PRIVATE-TURN-4471", privateInThread: "MARKER-PRIVATE-IN-THREAD-4471", failed: "MARKER-FAILED-ATTEMPT-4471", foreign: "MARKER-FOREIGN-TRIP-4471", profile: "MARKER-DIETARY-PROFILE-4471", route: "MARKER-PRIVATE-FLIGHT-4471", code: "MARKER-CONFIRMATION-4471" };
  const dinner = await startThread(s, "Saturday dinner", "Where should we eat on Saturday?", "Options: Alpine Table or Ridge Grill.", "Comparing Alpine Table and Ridge Grill.");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const foreignTrip = randomUUID(), foreignThread = randomUUID();
  await withTestDatabase(async db => {
    await db.insert(travelerProfiles).values({ personId: s.trip.travelerId, dietaryPreferences: markers.profile });
    await db.insert(travelPlans).values({ commonsId: s.trip.eventId, personId: s.trip.travelerId, kind: "car_rental", date: "2027-02-12", route: markers.route, time: "14:30", status: "confirmed", visibility: "private", confirmationCode: markers.code, sourceLabel: "Added by Taylor Synthetic" });
    await db.insert(coordinatorTurns).values([
      { commonsId: s.trip.eventId, ownerPersonId: s.trip.organizerId, organizerShared: false, sequence: 1, commandId: randomUUID(), fingerprint: "x", userText: markers.legacy, assistantText: `Reply ${markers.legacy}` },
      { commonsId: s.trip.eventId, ownerPersonId: s.trip.organizerId, threadId: dinner.id, organizerShared: false, sequence: 50, commandId: randomUUID(), fingerprint: "x", userText: markers.privateInThread, assistantText: `Reply ${markers.privateInThread}` },
      { commonsId: s.trip.eventId, ownerPersonId: s.trip.organizerId, threadId: dinner.id, organizerShared: true, sequence: 51, commandId: randomUUID(), fingerprint: "x", userText: markers.failed, assistantText: "", workspace: failedWorkspace("provider_failed") },
    ]);
    await db.insert(commons).values({ id: foreignTrip, slug: `foreign-${foreignTrip}`, name: "Elsewhere", timezone: "America/Denver", createdByPersonId: s.trip.organizerId });
    await db.insert(memberships).values({ commonsId: foreignTrip, personId: s.trip.organizerId, role: "organizer", status: "active" });
    await db.insert(coordinatorThreads).values({ id: foreignThread, commonsId: foreignTrip, createdByPersonId: s.trip.organizerId, title: "Saturday dinner elsewhere", lastCommandId: randomUUID(), lastCommandFingerprint: "x" });
    await db.insert(coordinatorTurns).values({ commonsId: foreignTrip, ownerPersonId: s.trip.organizerId, threadId: foreignThread, organizerShared: true, sequence: 1, commandId: randomUUID(), fingerprint: "x", userText: markers.foreign, assistantText: markers.foreign,
      workspace: { threadState: { v: 1, summary: markers.foreign, summaryTurnVersion: 1, openQuestions: [], generatedTitle: null } } });
  });
  try {
    const calls = capture(s);
    const result = await s.post(inThread(lodging, "Use the dinner options we discussed to pick a place near the lodge"));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.capability, "retrieve_context", "the foreign 'Saturday dinner elsewhere' thread is not a second candidate");
    const request = providerBodies(s.network.providerCalls.slice(calls));
    for (const [name, marker] of Object.entries(markers)) assert.equal(request.includes(marker), false, `${name} marker must not appear in the provider request`);
    assert.match(request, /Options: Alpine Table or Ridge Grill\./, "the shared, completed discussion is what was read");
    assert.equal(JSON.stringify(result.body).includes("MARKER"), false);
    // The index itself and the direct read enforce the same boundary.
    const options = { databaseUrl: process.env.TEST_DATABASE_URL!, actorPersonId: s.trip.organizerId, sharedCoordinator: true };
    const context = await loadCoordinatorTripContext(s.trip.eventId, { ...options, activeThreadId: lodging.id });
    assert.deepEqual(context.threads.map(thread => thread.threadId).sort(), [dinner.id, lodging.id].sort());
    assert.equal(JSON.stringify(context).includes("MARKER"), false);
    const excerpt = await readThreadExcerpt(s.trip.eventId, dinner.id, options);
    assert.equal(JSON.stringify(excerpt).includes("MARKER"), false);
    assert.deepEqual(excerpt.turns.map(turn => turn.userText), ["Where should we eat on Saturday?"]);
    await assert.rejects(readThreadExcerpt(s.trip.eventId, foreignThread, options), (error: unknown) => error instanceof CoordinatorTurnError && error.code === "thread_unavailable");
    await assert.rejects(readThreadExcerpt(s.trip.eventId, dinner.id, { ...options, actorPersonId: s.trip.travelerId }), (error: unknown) => error instanceof CoordinatorTurnError && error.code === "organizer_required");
    const asParticipant = await s.post(inThread(lodging, "Use the dinner options we discussed"), s.trip.travelerId);
    assert.deepEqual([asParticipant.status, asParticipant.body.error.code], [403, "organizer_required"]);
    assert.equal(JSON.stringify(asParticipant.body).includes("Alpine"), false);
    assert.equal(capture(s), calls + 1, "the participant's request never reached the model");
  } finally { await withTestDatabase(db => db.delete(commons).where(eq(commons.id, foreignTrip))); }
}));

test("Link an idea to this thread: explicit, unique, no copy, ambiguity asks once", { skip }, () => withCoordinatorScenario(async s => {
  const dinner = await startThread(s, "Saturday dinner");
  const [lesson, rental] = [randomUUID(), randomUUID()];
  await withTestDatabase(db => db.insert(itineraryItems).values([lesson, rental].map((id, index) => ({ id, commonsId: s.trip.eventId, title: index ? "Ski rental" : "Ski lesson", timezone: "America/Denver", audience: "everyone" as const, status: "idea" as const, provenanceLabel: "Suggested by Casey" }))));
  const calls = capture(s);
  const ambiguous = await s.post(inThread(dinner, "Link the ski idea to this thread", { ...voice() }));
  assert.match(ambiguous.body.durableAnswer, /Which idea do you mean/);
  assert.deepEqual(ambiguous.body.artifacts, []);
  const linked = await s.post(inThread({ id: dinner.id, turnVersion: ambiguous.body.thread.turnVersion }, "Link the ski lesson idea to this thread"));
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.capability, "link_idea");
  assert.equal(linked.body.artifacts[0].kind, "linked_idea");
  assert.equal(capture(s), calls, "linking is model-free");
  const rows = await withTestDatabase(async db => ({ links: await db.select().from(coordinatorThreadIdeas).where(eq(coordinatorThreadIdeas.threadId, dinner.id)), items: await db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, s.trip.eventId)) }));
  assert.deepEqual([rows.links.length, rows.links[0].itineraryItemId, rows.items.length], [1, lesson, 2], "linked by reference; nothing copied");
  const again = await s.post(inThread({ id: dinner.id, turnVersion: linked.body.thread.turnVersion }, "Link the ski lesson idea to this thread"));
  assert.match(again.body.durableAnswer, /already linked/);
  assert.equal((await withTestDatabase(db => db.select().from(coordinatorThreadIdeas))).filter(link => link.threadId === dinner.id).length, 1);
  const missing = await s.post(inThread({ id: dinner.id, turnVersion: again.body.thread.turnVersion }, "Link the spa day idea to this thread"));
  assert.match(missing.body.durableAnswer, /couldn’t find that idea/);
}));

test("turn metrics carry capability, input mode, latency, context size and correlated ids, and never content", { skip }, () => withCoordinatorScenario(async s => {
  const text = "MARKER-METRIC-SECRET-8812 where should we eat?";
  s.next.reply = "MARKER-METRIC-ANSWER-8812";
  const dinner = await startThread(s, "Saturday dinner", text, "MARKER-METRIC-ANSWER-8812", "MARKER-METRIC-SUMMARY-8812");
  await s.post(inThread(dinner, "I am attending the trip.", { inputMode: "voice", voice: { sessionId: "session-abc", delegationId: "delegation-xyz" } }));
  const logs = s.infoLogs.filter(entry => entry.name === "commons.coordinator.turn").map(entry => entry.detail as Body);
  assert.equal(logs.length, 2);
  const [answer, attendance] = logs;
  assert.deepEqual([answer.capability, answer.inputMode, answer.modelTier, answer.outcome, answer.status], ["answer", "text", "conversation", "answered", "completed"]);
  assert.deepEqual([attendance.capability, attendance.inputMode, attendance.modelTier, attendance.outcome, attendance.voiceSessionId, attendance.delegationId], ["record_attendance", "voice", "none", "direct_change", "session-abc", "delegation-xyz"]);
  for (const log of logs) {
    assert.equal(typeof log.latencyMs.total, "number");
    assert.ok(log.contextChars > 0 && log.turnId && log.commandId && log.threadId);
    assert.equal(JSON.stringify(log).includes("MARKER"), false, "no transcript, answer, or summary text in metrics");
  }
}));

test("a legacy unthreaded draft turn that asks for something unsupported keeps its draft and does not conflict", { skip }, () => withCoordinatorScenario(async s => {
  actAs(s.trip.organizerId);
  const created = await s.routes.drafts.POST(jsonRequest(s.trip.eventId, "/drafts", "POST", { id: randomUUID(), prompt: "Where should we stay?" }), params(s.trip.eventId));
  const { draft } = await created.json();
  const before = capture(s);
  const turn = await s.routes.turn.POST(jsonRequest(s.trip.eventId, "", "POST", { commandId: randomUUID(), version: 0, prompt: "Book the lodge for us", draftId: draft.id, draftVersion: draft.version }), params(s.trip.eventId));
  assert.equal(turn.status, 200, JSON.stringify(await turn.clone().json()));
  const payload = await turn.json();
  assert.match(payload.turns.at(-1).assistantText, /can’t book or reserve anything/);
  assert.equal(capture(s), before, "refused without the model");
  assert.equal((await tables(s.trip.eventId)).drafts[0].version, draft.version, "the draft is unchanged");
}));
