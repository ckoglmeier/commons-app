import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { commons, itineraryItems } from "@commons/database";
import { databaseTestsEnabled, eq, withCoordinatorScenario, withTestDatabase, type ScenarioContext } from "./coordinator-route-harness";

// Live feedback, September 30 (an organizer test thread): the organizer said "It's confirmed, you should switch that" and then insisted five
// times; every message went to a plain answer, so the model kept apologising and describing the change it could not make. Replayed here with synthetic
// data through the real /turns route, the real disposable database and a recording fake model.
const skip = !databaseTestsEnabled;
type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const EMPTY = { operations: [], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: null, stayBookingUrl: null, stayStatus: null,
  planId: null, planTitle: null, planStatus: null, planStartsOn: null, planStartsTime: null, planNote: null, planContactLabel: null };
const inThread = (thread: { id: string; turnVersion: number }, text: string) => ({ commandId: randomUUID(), target: { kind: "existing", threadId: thread.id, expectedTurnVersion: thread.turnVersion }, inputMode: "text", text });

async function seedLesson(s: ScenarioContext) {
  return withTestDatabase(async db => {
    await db.update(commons).set({ startsOn: "2027-10-08", endsOn: "2027-10-13" }).where(eq(commons.id, s.trip.eventId));
    const [lesson] = await db.insert(itineraryItems).values({ commonsId: s.trip.eventId, timezone: "America/Denver", audience: "everyone", provenanceLabel: "Added by Casey Synthetic",
      title: "Horseback riding lesson", startsAt: new Date("2027-10-11T15:00:00.000Z"), endsAt: new Date("2027-10-11T17:00:00.000Z"), status: "planned" }).returning();
    return lesson;
  });
}
async function firstTurn(s: ScenarioContext) {
  s.next.title = "Horseback riding lesson";
  Object.assign(s.next, { reply: "The horseback riding lesson is saved for October 11 at 9:00 AM, and its status is planned.", extra: { tripSuggestion: null } });
  // Live wording: the organizer's name for the plan does not match its saved title, so the plan can only come from the model's id.
  const first = await s.post(s.command({ text: "Did we confirm a time and place for Sam's lesson?" }));
  assert.equal(first.body.status, "completed", JSON.stringify(first.body));
  return first.body.thread as { id: string; turnVersion: number };
}

test("a follow-up the router does not recognise still becomes a reviewable plan update when the model prepares one", { skip }, () => withCoordinatorScenario(async s => {
  const lesson = await seedLesson(s);
  const thread = await firstTurn(s);
  Object.assign(s.next, { reply: "Marking the lesson confirmed.", extra: { tripSuggestion: { ...EMPTY, operations: ["plan"], planId: `plan:${lesson.id}`, planStatus: "confirmed" } } });
  const reply = await s.post(inThread(thread, "It's confirmed, you should switch that"));
  const body = reply.body as Body;
  assert.equal(body.status, "completed", JSON.stringify(body));
  assert.equal(body.capability, "propose_trip_change");
  assert.ok(body.artifacts.some((artifact: Body) => artifact.kind === "trip_change_proposal" && artifact.reviewRequired));
  assert.match(body.durableAnswer, /Horseback riding lesson/);
  assert.doesNotMatch(body.durableAnswer, /sorry|You’re right|Next step/i);
  const [saved] = await withTestDatabase(db => db.select().from(itineraryItems).where(eq(itineraryItems.id, lesson.id)));
  assert.equal(saved.status, "planned", "nothing changes until an organizer applies the review");
}));

test("an insistent follow-up with no status in it uses the organizer's earlier words, and a waiting review is pointed to, not duplicated", { skip }, () => withCoordinatorScenario(async s => {
  const lesson = await seedLesson(s);
  let thread = await firstTurn(s);
  const suggestion = { ...EMPTY, operations: ["plan"], planId: `plan:${lesson.id}`, planStatus: "confirmed" };
  Object.assign(s.next, { reply: "Noted.", extra: { tripSuggestion: null } });
  thread = (await s.post(inThread(thread, "It's confirmed, you should switch that"))).body.thread;
  Object.assign(s.next, { reply: "Preparing it.", extra: { tripSuggestion: suggestion } });
  const insist = await s.post(inThread(thread, "Why aren't you doing it?"));
  assert.equal(insist.body.capability, "propose_trip_change", JSON.stringify(insist.body));
  assert.ok(insist.body.artifacts.some((artifact: Body) => artifact.kind === "trip_change_proposal"));
  const again = await s.post(inThread(insist.body.thread, "Did you do it? I told you to"));
  assert.equal(again.body.artifacts.length, 0, "the same review is not created twice");
  assert.match(again.body.durableAnswer, /already waiting/);
}));

test("the model cannot supply a change nobody asked for: no organizer words for the status means no review card", { skip }, () => withCoordinatorScenario(async s => {
  const lesson = await seedLesson(s);
  const thread = await firstTurn(s);
  Object.assign(s.next, { reply: "The lesson is at 9 AM.", extra: { tripSuggestion: { ...EMPTY, operations: ["plan"], planId: `plan:${lesson.id}`, planStatus: "cancelled" } } });
  const reply = await s.post(inThread(thread, "What should Sam wear for the lesson?"));
  assert.equal(reply.body.capability, "answer");
  assert.deepEqual(reply.body.artifacts, []);
}));

test("with trip changes switched off, a model suggestion is ignored", { skip }, () => withCoordinatorScenario(async s => {
  const lesson = await seedLesson(s);
  const thread = await firstTurn(s);
  process.env.COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED = "false";
  Object.assign(s.next, { reply: "You can mark it confirmed in Plan.", extra: { tripSuggestion: { ...EMPTY, operations: ["plan"], planId: `plan:${lesson.id}`, planStatus: "confirmed" } } });
  const reply = await s.post(inThread(thread, "It's confirmed, you should switch that"));
  assert.deepEqual(reply.body.artifacts, []);
}));

test("a question about saved dates and lodging is answered, never treated as an update request", { skip }, () => withCoordinatorScenario(async s => {
  Object.assign(s.next, { reply: "Yes: February 12–15 at Synthetic Peak Lodge, 100 Synthetic Ridge Rd.", extra: { tripSuggestion: null } });
  const reply = await s.post(s.command({ text: "Do we have our dates and lodging set for this trip?" }));
  assert.ok(["answer", "retrieve_context"].includes(reply.body.capability), JSON.stringify(reply.body));
  assert.deepEqual(reply.body.artifacts, []);
  assert.equal(reply.body.durableAnswer, "Yes: February 12–15 at Synthetic Peak Lodge, 100 Synthetic Ridge Rd.");
  assert.doesNotMatch(reply.body.durableAnswer, /couldn’t prepare a trip update/);
}));
