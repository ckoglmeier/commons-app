import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, expenses, memberships, people, pollResponses, polls, tripActivationPayments } from "./schema";
import { commitEventCreationDraft, createEventCreationDraft } from "./event-creation-repository";
import { createCommonsPoll, getPublicPollByPublicId, FREE_LINK_POLL_RESPONSES, FREE_LINK_POLLS_PER_DAY, submitPublicPollResponseByPublicId } from "./poll-repository";
import { queueCommonsInvitationDeliveries, addCommonsPerson } from "./onboarding-repository";
import { attachTripCheckout, recordVerifiedTripPayment, reserveTripActivation, readTripActivationStatus, TripActivationRequiredError } from "./trip-activation-repository";
import { setTripExperience, attachBigQuestionPoll, decideBigQuestion, markTripGoing, readBigQuestions, saveTripBrief, tripHasPaidHelp } from "./trip-stage-repository";
import { queueTrafficAlert, readHourlyTraffic } from "./trip-traffic-repository";
import { hashOpaqueToken } from "./tokens";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const url = process.env.TEST_DATABASE_URL ?? "";

async function organizer() {
  const database = createDatabase(url);
  try {
    const id = randomUUID();
    await database.db.insert(people).values({ id, authUserId: randomUUID(), displayName: "Organizer", doNotCharge: false });
    return id;
  } finally { await database.close(); }
}
const trip = async (actorPersonId: string) => {
  const draft = await createEventCreationDraft({ sourceKind: "description", title: "Synthetic Napa", timezone: "UTC" }, { databaseUrl: url, actorPersonId, betaActivationRequired: true });
  const committed = await commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, { databaseUrl: url, actorPersonId, newExperience: true });
  return { draftId: draft.id, tripId: committed.eventId };
};
const pay = async (draftId: string, actorPersonId: string) => {
  const options = { databaseUrl: url, actorPersonId };
  const { payment } = await reserveTripActivation(draftId, options);
  const sessionId = `cs_test_${randomUUID().replaceAll("-", "")}`;
  await attachTripCheckout(draftId, payment.attemptId, { id: sessionId, url: `https://checkout.stripe.com/c/${sessionId}` }, options);
  await recordVerifiedTripPayment({ sessionId, eventId: `evt_${randomUUID().replaceAll("-", "")}`, amountCents: 2000, currency: "USD", taxAmountCents: null, paymentIntentId: `pi_${randomUUID().replaceAll("-", "")}` }, url);
};
const linkPoll = (commandId = randomUUID()) => ({ commandId, title: "Which week?", ballotMode: "transparent", questions: [{ id: randomUUID(), kind: "text", prompt: "Which week?" }] });

test("a free trip moves through questions to going, and answers never decide anything", { skip }, async () => {
  const owner = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const { draftId, tripId } = await trip(owner);
  let view = await readBigQuestions(tripId, options);
  assert.equal(view.stage, "deciding");
  assert.deepEqual(view.questions.map(question => question.id), ["where", "when", "who"]);
  assert.ok(view.questions.every(question => question.decided === null && question.poll === null));

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
    assert.deepEqual(view.questions.map(question => question.decided), ["Napa", "2027-10-09 – 2027-10-12", "Sam and Kit"]);
    const [saved] = await database.db.select({ location: commons.locationName, startsOn: commons.startsOn }).from(commons).where(eq(commons.id, tripId));
    assert.deepEqual(saved, { location: "Napa", startsOn: "2027-10-09" }, "a decision becomes the trip's fact");

    await assert.rejects(markTripGoing(tripId, options), TripActivationRequiredError, "going takes the fee");
    assert.equal(await tripHasPaidHelp(tripId, url), false, "AI help is part of the fee");
    await pay(draftId, owner);
    assert.equal(await tripHasPaidHelp(tripId, url), true);
    view = await readBigQuestions(tripId, options);
    assert.equal(view.stage, "deciding", "paying for help isn't saying you're going");
    assert.equal(view.paid, true);
    assert.equal((await database.db.select().from(expenses).where(eq(expenses.commonsId, tripId))).length, 1, "the fee is recorded once");
    await markTripGoing(tripId, options);
    await markTripGoing(tripId, options);
    assert.equal((await readBigQuestions(tripId, options)).stage, "going");
  } finally { await database.close(); }
});

test("sending invitations says the trip is on", { skip }, async () => {
  const owner = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const { draftId, tripId } = await trip(owner);
  await pay(draftId, owner);
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

test("free link polls are bounded per day and per poll; paid trips aren't", { skip }, async () => {
  const owner = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const { draftId, tripId } = await trip(owner);
  const database = createDatabase(url);
  try {
    const { id: pollId } = await createCommonsPoll(tripId, linkPoll(), options);
    const [row] = await database.db.select({ publicId: polls.publicId, questions: polls.questions }).from(polls).where(eq(polls.id, pollId));
    const questionId = (row.questions as { id: string }[])[0].id;
    await database.db.insert(pollResponses).values(Array.from({ length: FREE_LINK_POLL_RESPONSES }, (_, index) => ({ pollId, respondentName: `Guest ${index}`, receiptTokenHash: hashOpaqueToken(randomUUID()), answers: [] })));
    await assert.rejects(submitPublicPollResponseByPublicId(row.publicId, { respondentName: "One more", answers: [{ questionId, text: "Napa" }] }, url), /all the answers/);
    for (let index = 1; index < FREE_LINK_POLLS_PER_DAY; index += 1) await createCommonsPoll(tripId, linkPoll(), options);
    await assert.rejects(createCommonsPoll(tripId, linkPoll(), options), /a lot of polls/);
    await pay(draftId, owner);
    assert.ok(await createCommonsPoll(tripId, linkPoll(), options), "the daily limit is for unpaid trips");
    assert.ok(await submitPublicPollResponseByPublicId(row.publicId, { respondentName: "One more", answers: [{ questionId, text: "Napa" }] }, url), "so is the answer limit");
  } finally { await database.close(); }
});

test("traffic is counted by hour with no trip details, and each alert queues once", { skip }, async () => {
  const owner = await organizer(), { tripId } = await trip(owner);
  await createCommonsPoll(tripId, linkPoll(), { databaseUrl: url, actorPersonId: owner });
  const hours = await readHourlyTraffic(1, url);
  assert.ok(hours[0].polls >= 1 && hours[0].trips >= 1);
  assert.deepEqual(Object.keys(hours[0]).sort(), ["failures", "hour", "polls", "responses", "trips"]);
  const alert = { hour: `2099-${randomUUID().slice(0, 4)}`, signal: "responses", label: "poll answers", count: 600, level: 500 };
  assert.ok(await queueTrafficAlert(alert, url));
  assert.equal(await queueTrafficAlert(alert, url), null, "another instance noticing it adds nothing");
});

test("the welcome, deadline and rough cost reach the poll while deciding, and only an organizer sets them", { skip }, async () => {
  const owner = await organizer(), stranger = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const { draftId, tripId } = await trip(owner);
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
    await pay(draftId, owner); await markTripGoing(tripId, options);
    assert.equal((await getPublicPollByPublicId(row.publicId, url))?.tripBrief, null, "once going, the trip letter takes over");
  } finally { await database.close(); }
});

test("existing trips stay on the old experience until an organizer switches, and switching hides no fee and moves no record", { skip }, async () => {
  const owner = await organizer(), stranger = await organizer(), options = { databaseUrl: url, actorPersonId: owner };
  const legacy = await createEventCreationDraft({ sourceKind: "description", title: "Older trip", timezone: "UTC" }, options);
  const { eventId } = await commitEventCreationDraft(legacy.id, { commandId: randomUUID(), expectedVersion: legacy.version }, options);
  const database = createDatabase(url);
  try {
    const on = async () => (await database.db.select({ on: commons.newExperience, goingAt: commons.goingAt }).from(commons).where(eq(commons.id, eventId)))[0];
    assert.equal((await on()).on, false, "a trip with no setting stays as it was");
    assert.equal((await readBigQuestions(eventId, options)).stage, "going");
    await assert.rejects(setTripExperience(eventId, { enabled: true }, { databaseUrl: url, actorPersonId: stranger }));
    await setTripExperience(eventId, { enabled: true }, options);
    assert.equal((await readBigQuestions(eventId, options)).stage, "deciding", "a solo trip can start from the questions");
    await database.db.insert(memberships).values({ commonsId: eventId, personId: stranger, role: "member", status: "active" });
    await setTripExperience(eventId, { enabled: false }, options);
    assert.equal((await readBigQuestions(eventId, options)).stage, "going");
    await setTripExperience(eventId, { enabled: true }, options);
    assert.ok((await on()).goingAt, "a trip with people on it is past deciding");
    assert.equal((await readBigQuestions(eventId, options)).stage, "going");
    assert.equal(await tripHasPaidHelp(eventId, url), true, "switching on never adds a fee to an existing trip");
  } finally { await database.close(); }
  // A solo trip with costs doesn't put them behind a gate.
  const solo = await createEventCreationDraft({ sourceKind: "description", title: "Solo with costs", timezone: "UTC" }, options);
  const soloTrip = await commitEventCreationDraft(solo.id, { commandId: randomUUID(), expectedVersion: solo.version }, options);
  const costs = createDatabase(url);
  try { await costs.db.insert(expenses).values({ commonsId: soloTrip.eventId, title: "Deposit", amountCents: 100, paidByPersonId: owner, occurredOn: "2027-01-01", category: "Other", status: "confirmed", splitMethod: "equal", source: "web", sourceLabel: "Test" }); }
  finally { await costs.close(); }
  await setTripExperience(soloTrip.eventId, { enabled: true }, options);
  assert.equal((await readBigQuestions(soloTrip.eventId, options)).stage, "going", "recorded costs stay reachable");
  // Turning it off can't dodge the fee on a trip that has one.
  const { tripId } = await trip(owner);
  await setTripExperience(tripId, { enabled: false }, options);
  await assert.rejects(addCommonsPerson(tripId, { displayName: "Sam", email: `${randomUUID()}@example.test`, role: "member", accessMode: "account" }, options), TripActivationRequiredError);
});

test("beta accounts retain a no-charge exemption and can go without checkout", { skip }, async () => {
  const database = createDatabase(url);
  const id = randomUUID();
  try {
    const [account] = await database.db.insert(people).values({ id, authUserId: randomUUID(), displayName: "Beta traveler" }).returning();
    assert.equal(account.doNotCharge, true);
    const options = { databaseUrl: url, actorPersonId: id };
    const { draftId, tripId } = await trip(id);
    const before = await readBigQuestions(tripId, options);
    assert.equal(before.upgrade, false);
    assert.equal(before.paid, false);
    assert.equal(before.stage, "deciding");
    await assert.rejects(reserveTripActivation(draftId, options), /does not pay Commons trip fees/);
    await markTripGoing(tripId, options);
    assert.equal((await readBigQuestions(tripId, options)).stage, "going");
    assert.equal((await database.db.select().from(tripActivationPayments).where(eq(tripActivationPayments.draftId, draftId))).length, 0);
    const [persisted] = await database.db.select().from(people).where(eq(people.id, id));
    assert.equal(persisted.doNotCharge, true);
    const coorganizer = await organizer();
    await database.db.insert(memberships).values({commonsId:tripId,personId:coorganizer,role:"organizer",status:"active"});
    const coStatus = await readTripActivationStatus({tripId},{databaseUrl:url,actorPersonId:coorganizer});
    assert.equal(coStatus?.state,"exempt");
    assert.equal(coStatus?.going,true);
    assert.equal(coStatus?.feeCents,0);
    const outsider = await organizer();
    assert.equal(await readTripActivationStatus({tripId},{databaseUrl:url,actorPersonId:outsider}),null);
  } finally { await database.close(); }
});
