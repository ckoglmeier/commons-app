import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, expenses, memberships, people, polls } from "./schema";
import { commitEventCreationDraft, createEventCreationDraft } from "./event-creation-repository";
import { createCommonsPoll, getPublicPollByPublicId, submitPublicPollResponseByPublicId } from "./poll-repository";
import { queueCommonsInvitationDeliveries, addCommonsPerson } from "./onboarding-repository";
import { attachBigQuestionPoll, decideBigQuestion, markTripGoing, readBigQuestions, saveTripBrief } from "./trip-stage-repository";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const url = process.env.TEST_DATABASE_URL ?? "";

async function organizer() {
  const database = createDatabase(url);
  try {
    const id = randomUUID();
    await database.db.insert(people).values({ id, authUserId: randomUUID(), displayName: "Organizer" });
    return id;
  } finally { await database.close(); }
}
const trip = async (actorPersonId: string) => {
  const draft = await createEventCreationDraft({ sourceKind: "description", title: "Synthetic Napa", timezone: "UTC" }, { databaseUrl: url, actorPersonId });
  const committed = await commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, { databaseUrl: url, actorPersonId, newExperience: true });
  return { tripId: committed.eventId };
};
const linkPoll = (commandId = randomUUID()) => ({ commandId, title: "Which week?", ballotMode: "transparent", questions: [{ id: randomUUID(), kind: "text", prompt: "Which week?" }] });

test("a trip moves through questions to going, and answers never decide anything", { skip }, async () => {
  const owner = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const { tripId } = await trip(owner);
  let view = await readBigQuestions(tripId, options);
  assert.equal(view.stage, "deciding");
  assert.deepEqual(view.questions.map(question => question.id), ["where", "when", "who"]);
  assert.ok(view.questions.every(question => question.decided === null && question.poll === null && question.saved === undefined));

  const { id: pollId } = await createCommonsPoll(tripId, linkPoll(), options);
  await attachBigQuestionPoll(tripId, { question: "where", pollId }, options);
  const database = createDatabase(url);
  try {
    const [row] = await database.db.select({ publicId: polls.publicId }).from(polls).where(eq(polls.id, pollId));
    const questions = (await database.db.select({ questions: polls.questions }).from(polls).where(eq(polls.id, pollId)))[0].questions as { id: string }[];
    await submitPublicPollResponseByPublicId(row.publicId, { respondentName: "Guest", answers: [{ questionId: questions[0].id, text: "Napa" }] }, url);
    view = await readBigQuestions(tripId, options);
    assert.equal(view.questions[0].poll?.answers, 1);
    assert.equal(view.questions[0].decided, null, "an answer decides nothing");
    assert.equal((await database.db.select().from(memberships).where(eq(memberships.commonsId, tripId))).length, 1, "answering doesn't join the trip");

    await decideBigQuestion(tripId, { commandId: randomUUID(), question: "where", locationName: "Napa" }, options);
    await decideBigQuestion(tripId, { commandId: randomUUID(), question: "when", startsOn: "2027-10-09", endsOn: "2027-10-12" }, options);
    await decideBigQuestion(tripId, { commandId: randomUUID(), question: "who", note: "Sam and Kit" }, options);
    await assert.rejects(decideBigQuestion(tripId, { commandId: randomUUID(), question: "when", startsOn: "2027-10-12", endsOn: "2027-10-09" }, options));
    view = await readBigQuestions(tripId, options);
    assert.deepEqual(view.questions.map(question => question.decided), ["Napa", "Oct 9–12, 2027", "Sam and Kit"]);
    assert.deepEqual(view.questions.map(question => question.saved), [{ locationName: "Napa" }, { startsOn: "2027-10-09", endsOn: "2027-10-12" }, { note: "Sam and Kit" }], "Change opens with what is saved");
    const [saved] = await database.db.select({ location: commons.locationName, startsOn: commons.startsOn }).from(commons).where(eq(commons.id, tripId));
    assert.deepEqual(saved, { location: "Napa", startsOn: "2027-10-09" }, "a decision becomes the trip's fact");

    assert.equal((await readBigQuestions(tripId, options)).stage, "deciding", "deciding the questions isn't saying you're going");
    assert.equal((await database.db.select().from(expenses).where(eq(expenses.commonsId, tripId))).length, 0, "no cost is recorded");
    await markTripGoing(tripId, options);
    await markTripGoing(tripId, options);
    assert.equal((await readBigQuestions(tripId, options)).stage, "going");
  } finally { await database.close(); }
});

test("sending invitations says the trip is on", { skip }, async () => {
  const owner = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const { tripId } = await trip(owner);
  await addCommonsPerson(tripId, { displayName: "Sam", email: `${randomUUID()}@example.test`, role: "member", accessMode: "account" }, options);
  await queueCommonsInvitationDeliveries(tripId, null, options);
  assert.equal((await readBigQuestions(tripId, options)).stage, "going");
});

test("only an organizer reaches the questions, and another trip's poll can't be attached", { skip }, async () => {
  const owner = await organizer(), stranger = await organizer();
  const { tripId } = await trip(owner), other = await trip(stranger);
  const options = { databaseUrl: url, actorPersonId: owner };
  await assert.rejects(readBigQuestions(tripId, { databaseUrl: url, actorPersonId: stranger }));
  await assert.rejects(decideBigQuestion(tripId, { commandId: randomUUID(), question: "where", locationName: "Elsewhere" }, { databaseUrl: url, actorPersonId: stranger }));
  await assert.rejects(markTripGoing(tripId, { databaseUrl: url, actorPersonId: stranger }));
  const { id: foreign } = await createCommonsPoll(other.tripId, linkPoll(), { databaseUrl: url, actorPersonId: stranger });
  await assert.rejects(attachBigQuestionPoll(tripId, { question: "where", pollId: foreign }, options));
});

test("the welcome, deadline and rough cost reach the poll while deciding, and only an organizer sets them", { skip }, async () => {
  const owner = await organizer(), stranger = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const { tripId } = await trip(owner);
  const database = createDatabase(url);
  try {
    await database.db.update(commons).set({ welcomeMessage: "Let’s make Napa happen." }).where(eq(commons.id, tripId));
    await saveTripBrief(tripId, { decideBy: "2027-01-15", roughCost: "About $600 each" }, options);
    await assert.rejects(saveTripBrief(tripId, { decideBy: null, roughCost: null }, { databaseUrl: url, actorPersonId: stranger }));
    await assert.rejects(saveTripBrief(tripId, { decideBy: "soon", roughCost: null }, options));
    const view = await readBigQuestions(tripId, options);
    assert.deepEqual([view.welcome, view.decideBy, view.roughCost], ["Let’s make Napa happen.", "2027-01-15", "About $600 each"]);
    const { id } = await createCommonsPoll(tripId, linkPoll(), options);
    const [row] = await database.db.select({ publicId: polls.publicId }).from(polls).where(eq(polls.id, id));
    const shown = await getPublicPollByPublicId(row.publicId, url);
    assert.deepEqual(shown?.tripBrief, { welcome: "Let’s make Napa happen.", organizerName: "Organizer", decideBy: "2027-01-15", roughCost: "About $600 each" });
    assert.equal((await database.db.select().from(expenses).where(eq(expenses.commonsId, tripId))).length, 0, "a rough cost adds nothing to Money");
    await saveTripBrief(tripId, { decideBy: null, roughCost: null }, options);
    const cleared = await readBigQuestions(tripId, options);
    assert.deepEqual([cleared.decideBy, cleared.roughCost], [null, null]);
    await markTripGoing(tripId, options);
    assert.equal((await getPublicPollByPublicId(row.publicId, url))?.tripBrief, null, "once going, the trip letter takes over");
  } finally { await database.close(); }
});

test("a trip created before the two stages, with the column false, still reads as going", { skip }, async () => {
  const owner = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const legacy = await createEventCreationDraft({ sourceKind: "description", title: "Older trip", timezone: "UTC" }, options);
  const { eventId } = await commitEventCreationDraft(legacy.id, { commandId: randomUUID(), expectedVersion: legacy.version }, options);
  const database = createDatabase(url);
  try {
    const [row] = await database.db.select({ on: commons.newExperience, goingAt: commons.goingAt }).from(commons).where(eq(commons.id, eventId));
    assert.equal(row.on, false);
    assert.equal(row.goingAt, null);
    assert.equal((await readBigQuestions(eventId, options)).stage, "going");
  } finally { await database.close(); }
});
