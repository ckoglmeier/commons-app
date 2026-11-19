import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ParticipantAnswerEnvelope } from "@commons/contracts";
import { createDatabase } from "./client";
import { operateCoordinatorGoal, listCoordinatorGoals } from "./coordinator-goal-repository";
import { actOnCoordinatorWorkspace, commitCoordinatorTurn, getCoordinatorThread } from "./coordinator-repository";
import { approveSyntheticOutreach, ingestSyntheticParticipantReply } from "./coordinator-participant-adapter";
import { CommandAccessError, CommandConflictError } from "./event-command";
import { answerParticipantQuestion, cancelParticipantQuestion, listGoalParticipantQuestions, listRecipientParticipantQuestions, ParticipantQuestionClosedError, prepareParticipantQuestion, publishParticipantQuestion, readGoalParticipantEvidence, readRecipientParticipantQuestion } from "./participant-question-repository";
import { commons, coordinatorGoalReports, coordinatorOutreach, coordinatorOutreachMessages, memberships, participantAnswers, participantQuestions, people, travelPlans, itineraryItems } from "./schema";

/*
 * Conversation durability lane B (CONVERSATION-DURABILITY-TEST-PLAN.md B01-B14) against exact stored rows. Synthetic people only.
 * Sonoma: organizer Casey asks traveler Taylor for a missing November 7 arrival time from a "Coordinate airport transport" task. Santa Fe: the same
 * traveler on a second trip with the same trip name, to prove request correlation never follows a "last selected trip".
 */
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const databaseUrl = process.env.TEST_DATABASE_URL!;

async function seed() {
  assert.equal(new URL(databaseUrl).hostname, "127.0.0.1");
  const db = createDatabase(databaseUrl);
  const sonoma = randomUUID(), santaFe = randomUUID(), casey = randomUUID(), robin = randomUUID(), taylor = randomUUID(), jordan = randomUUID(), outsider = randomUUID();
  const ids = [casey, robin, taylor, jordan, outsider];
  await db.db.insert(people).values([
    { id: casey, displayName: "Casey Synthetic Organizer" }, { id: robin, displayName: "Robin Synthetic Organizer" },
    { id: taylor, displayName: "Taylor Synthetic" }, { id: jordan, displayName: "Jordan Synthetic" }, { id: outsider, displayName: "Outsider Synthetic" },
  ]);
  // Two trips with the same name: the id, never the name or a remembered selection, picks the request.
  await db.db.insert(commons).values([sonoma, santaFe].map(id => ({ id, slug: `pq-${id}`, name: "Synthetic group weekend", timezone: "America/Los_Angeles", startsOn: "2026-11-05", endsOn: "2026-11-07", createdByPersonId: casey })));
  await db.db.insert(memberships).values([
    ...[sonoma, santaFe].flatMap(trip => [
      { commonsId: trip, personId: casey, role: "organizer" as const, status: "active" as const }, { commonsId: trip, personId: robin, role: "organizer" as const, status: "active" as const },
      { commonsId: trip, personId: taylor, role: "member" as const, status: "active" as const }, { commonsId: trip, personId: jordan, role: "member" as const, status: "active" as const },
    ]),
  ]);
  const as = (actorPersonId: string, now?: Date) => ({ databaseUrl, actorPersonId, ...(now ? { now } : {}) });
  const goalOptions = (actorPersonId: string) => ({ databaseUrl, actorPersonId, syntheticParticipants: true, researchAvailable: false });
  const transportGoal = async (trip: string) => (await operateCoordinatorGoal(trip, { op: "start", commandId: randomUUID(), kind: "plan_action", title: "Coordinate airport transport",
    goal: "Resolve how everyone gets from SFO to the Sonoma house on November 7.", completionCriterion: "A reviewed transport plan is saved." }, goalOptions(casey))).goal;
  return { db, sonoma, santaFe, casey, robin, taylor, jordan, outsider, as, goalOptions, transportGoal,
    cleanup: async () => { await db.db.delete(commons).where(inArray(commons.id, [sonoma, santaFe])); await db.db.delete(people).where(inArray(people.id, ids)); await db.close(); } };
}
type Seed = Awaited<ReturnType<typeof seed>>;
const withSeed = (run: (s: Seed) => Promise<void>) => async () => { const s = await seed(); try { await run(s); } finally { await s.cleanup(); } };
const ARRIVAL = "What time does your flight land at SFO on November 7?";
async function askTaylor(s: Seed, trip = s.sonoma, goal?: { goalId: string; revision: number }) {
  const g = goal ?? await s.transportGoal(trip);
  const prepared = await prepareParticipantQuestion(trip, { commandId: randomUUID(), goalId: g.goalId, expectedGoalRevision: g.revision, recipientPersonId: s.taylor, purpose: "Arrival time for airport transport", question: ARRIVAL, expiresInHours: 48 }, s.as(s.casey));
  return { goal: g, ...prepared };
}

test("B01 preparing and previewing deliver nothing; explicit publication pins the exact recipient, wording and version", { skip }, withSeed(async s => {
  const { questionId, version, goal } = await askTaylor(s);
  assert.deepEqual(await listRecipientParticipantQuestions(s.sonoma, s.as(s.taylor)), [], "a draft is not available to the recipient");
  await assert.rejects(readRecipientParticipantQuestion(s.sonoma, questionId, s.as(s.taylor)), CommandAccessError);
  const coOrganizerView = await listGoalParticipantQuestions(s.sonoma, goal.goalId, s.as(s.robin));
  assert.equal(coOrganizerView.length, 0, "another organizer does not see the asker's private draft");
  await assert.rejects(publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId, expectedVersion: version }, s.as(s.robin)), CommandAccessError, "only the asker publishes");
  const publishCommand = randomUUID();
  await publishParticipantQuestion(s.sonoma, { commandId: publishCommand, questionId, expectedVersion: version }, s.as(s.casey));
  assert.equal((await publishParticipantQuestion(s.sonoma, { commandId: publishCommand, questionId, expectedVersion: version }, s.as(s.casey))).replayed, true);
  const [row] = await s.db.db.select().from(participantQuestions).where(eq(participantQuestions.id, questionId));
  assert.equal(row.status, "published"); assert.equal(row.recipientPersonId, s.taylor); assert.equal(row.question, ARRIVAL); assert.equal(row.version, 1); assert.equal(row.channel, "web");
  assert.equal((await s.db.db.select().from(coordinatorOutreach).where(eq(coordinatorOutreach.commonsId, s.sonoma))).length, 0, "no outreach or delivery record is created");
}));

test("B02/B06/B08/B11 recipient-only access across reloads, other people, another trip with the same name and guessed ids", { skip }, withSeed(async s => {
  const sonoma = await askTaylor(s);
  await publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId: sonoma.questionId, expectedVersion: 1 }, s.as(s.casey));
  const santaFe = await askTaylor(s, s.santaFe);
  await publishParticipantQuestion(s.santaFe, { commandId: randomUUID(), questionId: santaFe.questionId, expectedVersion: 1 }, s.as(s.casey));
  const first = await readRecipientParticipantQuestion(s.sonoma, sonoma.questionId, s.as(s.taylor));
  const again = await readRecipientParticipantQuestion(s.sonoma, sonoma.questionId, s.as(s.taylor));
  assert.deepEqual(first, again, "reload or another browser recovers the same server state");
  assert.equal(first.state, "waiting"); assert.equal(first.askedBy, "Casey Synthetic Organizer"); assert.deepEqual(first.sharedWith, ["Casey Synthetic Organizer", "Robin Synthetic Organizer"]);
  assert.doesNotMatch(JSON.stringify(first), /Resolve how everyone|goalId|Jordan|SFO to the Sonoma house/, "no organizer task context in the recipient projection");
  for (const [trip, id, actor] of [[s.sonoma, sonoma.questionId, s.jordan], [s.sonoma, sonoma.questionId, s.robin], [s.sonoma, sonoma.questionId, s.outsider], [s.santaFe, sonoma.questionId, s.taylor], [s.sonoma, santaFe.questionId, s.taylor], [s.sonoma, randomUUID(), s.taylor], [s.sonoma, "not-a-uuid", s.taylor]] as const)
    await assert.rejects(readRecipientParticipantQuestion(trip, id, s.as(actor)), CommandAccessError);
  await assert.rejects(answerParticipantQuestion(s.sonoma, sonoma.questionId, { submissionId: randomUUID(), body: "3:10 PM", expectedAnswerRevision: 0 }, s.as(s.jordan)), CommandAccessError);
  await assert.rejects(answerParticipantQuestion(s.santaFe, sonoma.questionId, { submissionId: randomUUID(), body: "3:10 PM", expectedAnswerRevision: 0 }, s.as(s.taylor)), CommandAccessError);
  // Each trip lists only its own question; Taylor's answers stay with the request they answer.
  assert.deepEqual((await listRecipientParticipantQuestions(s.sonoma, s.as(s.taylor))).map(q => q.questionId), [sonoma.questionId]);
  assert.deepEqual((await listRecipientParticipantQuestions(s.santaFe, s.as(s.taylor))).map(q => q.questionId), [santaFe.questionId]);
  await answerParticipantQuestion(s.santaFe, santaFe.questionId, { submissionId: randomUUID(), body: "Santa Fe: landing 11:05 AM", expectedAnswerRevision: 0 }, s.as(s.taylor));
  assert.equal((await readRecipientParticipantQuestion(s.sonoma, sonoma.questionId, s.as(s.taylor))).answer, null, "a delayed reply on another trip never lands here");
  await assert.rejects(listRecipientParticipantQuestions(s.sonoma, s.as(s.outsider)), CommandAccessError);
}));

test("B03/B04/B08/B10 one answer persists with one report; replay returns the receipt; a changed body for the same submission conflicts; the task stays open", { skip }, withSeed(async s => {
  const { questionId, goal } = await askTaylor(s);
  await publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId, expectedVersion: 1 }, s.as(s.casey));
  const submissionId = randomUUID(), body = "We land at 3:10 PM on United 1234.";
  const receipt = await answerParticipantQuestion(s.sonoma, questionId, { submissionId, body, expectedAnswerRevision: 0 }, s.as(s.taylor));
  assert.equal(receipt.revision, 1); assert.equal(receipt.replayed, false);
  // The client lost the response and retries the same submission: the original receipt, no second report.
  const replay = await answerParticipantQuestion(s.sonoma, questionId, { submissionId, body, expectedAnswerRevision: 0 }, s.as(s.taylor));
  assert.deepEqual({ ...replay, replayed: false }, receipt); assert.equal(replay.replayed, true);
  await assert.rejects(answerParticipantQuestion(s.sonoma, questionId, { submissionId, body: "Different", expectedAnswerRevision: 0 }, s.as(s.taylor)), CommandConflictError);
  // A concurrent second first-answer from another tab loses on the expected revision.
  await assert.rejects(answerParticipantQuestion(s.sonoma, questionId, { submissionId: randomUUID(), body: "4 PM", expectedAnswerRevision: 0 }, s.as(s.taylor)), CommandConflictError);
  assert.equal((await s.db.db.select().from(participantAnswers).where(eq(participantAnswers.questionId, questionId))).length, 1);
  const reports = await s.db.db.select().from(coordinatorGoalReports).where(and(eq(coordinatorGoalReports.goalId, goal.goalId), eq(coordinatorGoalReports.kind, "milestone")));
  assert.equal(reports.length, 1); assert.doesNotMatch(reports[0].headline + reports[0].detail, /3:10/, "the report says an answer arrived; the answer itself is in the task projection");
  for (const organizer of [s.casey, s.robin]) {
    const [view] = await listGoalParticipantQuestions(s.sonoma, goal.goalId, s.as(organizer));
    assert.equal(view.answer?.body, body); assert.equal(view.state, "answered"); assert.equal(view.recipient.name, "Taylor Synthetic");
  }
  await assert.rejects(listGoalParticipantQuestions(s.sonoma, goal.goalId, s.as(s.jordan)), "another traveler cannot read the task audience projection");
  const goals = await listCoordinatorGoals(s.sonoma, s.goalOptions(s.casey));
  assert.notEqual(goals.goals.find(g => g.goalId === goal.goalId)?.lifecycle, "completed", "collecting the arrival time does not resolve transportation");
  assert.equal((await s.db.db.select().from(travelPlans).where(eq(travelPlans.commonsId, s.sonoma))).length, 0, "no travel record");
  assert.equal((await s.db.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, s.sonoma))).length, 0, "no Plan change");
  const evidence = await readGoalParticipantEvidence(s.sonoma, goal.goalId, s.as(s.casey));
  assert.equal(evidence[0].answer, body); assert.match(evidence[0].kind, /reported by the traveler/);
}));

test("B05 a deliberate correction adds a revision and supersedes the report; a stale tab cannot overwrite it", { skip }, withSeed(async s => {
  const { questionId, goal } = await askTaylor(s);
  await publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId, expectedVersion: 1 }, s.as(s.casey));
  await answerParticipantQuestion(s.sonoma, questionId, { submissionId: randomUUID(), body: "3:10 PM", expectedAnswerRevision: 0 }, s.as(s.taylor));
  await answerParticipantQuestion(s.sonoma, questionId, { submissionId: randomUUID(), body: "Correction: 5:45 PM, the flight moved.", expectedAnswerRevision: 1 }, s.as(s.taylor));
  await assert.rejects(answerParticipantQuestion(s.sonoma, questionId, { submissionId: randomUUID(), body: "3:10 PM (old tab)", expectedAnswerRevision: 1 }, s.as(s.taylor)), CommandConflictError);
  const history = await s.db.db.select().from(participantAnswers).where(eq(participantAnswers.questionId, questionId));
  assert.deepEqual(history.map(row => [row.revision, row.body]).sort(), [[1, "3:10 PM"], [2, "Correction: 5:45 PM, the flight moved."]]);
  const [view] = await listGoalParticipantQuestions(s.sonoma, goal.goalId, s.as(s.robin));
  assert.equal(view.answer?.body, "Correction: 5:45 PM, the flight moved."); assert.equal(view.answer?.corrected, true); assert.equal(view.answer?.earlierRevisions, 1);
  const reports = await s.db.db.select().from(coordinatorGoalReports).where(eq(coordinatorGoalReports.goalId, goal.goalId));
  const answerReports = reports.filter(r => r.discriminator.startsWith("participant_answer:"));
  assert.equal(answerReports.length, 2); assert.equal(answerReports.filter(r => r.supersededAt === null).length, 1);
  assert.equal((await readRecipientParticipantQuestion(s.sonoma, questionId, s.as(s.taylor))).answer?.revision, 2);
}));

test("B07 closed, cancelled, expired, removed recipient or asker, and a revised or finished task refuse fresh answers; an accepted submission still replays", { skip }, withSeed(async s => {
  const ask = async () => { const q = await askTaylor(s); await publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId: q.questionId, expectedVersion: 1 }, s.as(s.casey)); return q; };
  const fresh = () => ({ submissionId: randomUUID(), body: "3:10 PM", expectedAnswerRevision: 0 });
  const cancelled = await ask();
  const accepted = { submissionId: randomUUID(), body: "3:10 PM", expectedAnswerRevision: 0 };
  await answerParticipantQuestion(s.sonoma, cancelled.questionId, accepted, s.as(s.taylor));
  await cancelParticipantQuestion(s.sonoma, { questionId: cancelled.questionId }, s.as(s.casey));
  await assert.rejects(answerParticipantQuestion(s.sonoma, cancelled.questionId, { ...fresh(), expectedAnswerRevision: 1 }, s.as(s.taylor)), ParticipantQuestionClosedError);
  assert.equal((await answerParticipantQuestion(s.sonoma, cancelled.questionId, accepted, s.as(s.taylor))).replayed, true, "exact replay of an accepted submission keeps its receipt");
  assert.equal((await readRecipientParticipantQuestion(s.sonoma, cancelled.questionId, s.as(s.taylor))).state, "cancelled");
  const expired = await ask();
  await assert.rejects(answerParticipantQuestion(s.sonoma, expired.questionId, fresh(), s.as(s.taylor, new Date(Date.now() + 49 * 3_600_000))), ParticipantQuestionClosedError);
  const revised = await ask();
  await operateCoordinatorGoal(s.sonoma, { op: "edit_goal", commandId: randomUUID(), goalId: revised.goal.goalId, expectedRevision: revised.goal.revision, goal: "Resolve transport for Saturday instead.", completionCriterion: "A reviewed transport plan is saved." }, s.goalOptions(s.casey));
  await assert.rejects(answerParticipantQuestion(s.sonoma, revised.questionId, fresh(), s.as(s.taylor)), ParticipantQuestionClosedError, "a new goal revision does not inherit the question");
  const askerGone = await ask();
  await s.db.db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, s.sonoma), eq(memberships.personId, s.casey)));
  await assert.rejects(answerParticipantQuestion(s.sonoma, askerGone.questionId, fresh(), s.as(s.taylor)), ParticipantQuestionClosedError);
  await s.db.db.update(memberships).set({ role: "organizer" }).where(and(eq(memberships.commonsId, s.sonoma), eq(memberships.personId, s.casey)));
  const recipientGone = await ask();
  await s.db.db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.commonsId, s.sonoma), eq(memberships.personId, s.taylor)));
  await assert.rejects(answerParticipantQuestion(s.sonoma, recipientGone.questionId, fresh(), s.as(s.taylor)), CommandAccessError);
  await assert.rejects(readRecipientParticipantQuestion(s.sonoma, recipientGone.questionId, s.as(s.taylor)), CommandAccessError);
  // Retargeting: there is no command that changes the recipient or wording; another person needs a new reviewed question.
  assert.equal((await s.db.db.select().from(participantQuestions).where(eq(participantQuestions.id, recipientGone.questionId)))[0].recipientPersonId, s.taylor);
}));

test("B13/B14 historical synthetic outreach is untouched and never shown as a web question; repeated reads make no writes", { skip }, withSeed(async s => {
  const participantGoal = await operateCoordinatorGoal(s.sonoma, { op: "start", commandId: randomUUID(), kind: "participant", title: "Confirm Taylor arrival", goal: "Collect Taylor's stated arrival time", recipientPersonId: s.taylor, question: "What time do you arrive?" }, s.goalOptions(s.casey));
  const sent = await approveSyntheticOutreach(s.sonoma, { outreachId: participantGoal.goal.steps[0].refId!, expectedRevision: 1 }, s.goalOptions(s.casey));
  await ingestSyntheticParticipantReply(s.sonoma, s.taylor, { providerMessageId: "hist-1", conversationAddress: sent.address, body: "PRIVATE_SYNTHETIC_BODY 6:40 PM", receivedAt: new Date().toISOString() }, s.goalOptions(s.casey));
  const listed = await listRecipientParticipantQuestions(s.sonoma, s.as(s.taylor));
  assert.equal(listed.length, 0, "a synthetic outreach is not relabelled as a web question");
  const before = await s.db.db.select().from(coordinatorOutreach).where(eq(coordinatorOutreach.commonsId, s.sonoma));
  assert.equal(before[0].channel, "synthetic_sms");
  const { questionId, goal } = await askTaylor(s);
  await publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId, expectedVersion: 1 }, s.as(s.casey));
  const snapshot = JSON.stringify(await s.db.db.select().from(participantQuestions).where(eq(participantQuestions.id, questionId)));
  for (let read = 0; read < 10; read += 1) { await readRecipientParticipantQuestion(s.sonoma, questionId, s.as(s.taylor)); await listGoalParticipantQuestions(s.sonoma, goal.goalId, s.as(s.casey)); }
  assert.equal(JSON.stringify(await s.db.db.select().from(participantQuestions).where(eq(participantQuestions.id, questionId))), snapshot, "reads write nothing");
  assert.doesNotMatch(JSON.stringify(await listGoalParticipantQuestions(s.sonoma, goal.goalId, s.as(s.robin))), /PRIVATE_SYNTHETIC_BODY/);
  assert.equal((await s.db.db.select().from(coordinatorOutreachMessages).where(eq(coordinatorOutreachMessages.commonsId, s.sonoma))).filter(m => m.direction === "inbound").length, 1);
}));

// B12: the same correlation guarantees through both adapters, with their intentional difference (closed web refuses; late synthetic is retained).
const seenRevision = new Map<string, number>();
type Adapter = { name: string; setup: (s: Seed) => Promise<{ requestRef: string; close: () => Promise<void> }>; deliver: (s: Seed, envelope: ParticipantAnswerEnvelope) => Promise<{ replayed: boolean; late?: boolean }> };
const adapters: Adapter[] = [
  { name: "web", setup: async s => { const q = await askTaylor(s); await publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId: q.questionId, expectedVersion: 1 }, s.as(s.casey));
      return { requestRef: q.questionId, close: async () => { await cancelParticipantQuestion(s.sonoma, { questionId: q.questionId }, s.as(s.casey)); } }; },
    // A client retry resends the identical submission, including the answer revision it saw when it first sent it.
    deliver: async (s, e) => { const [row] = await s.db.db.select({ answerRevision: participantQuestions.answerRevision }).from(participantQuestions).where(eq(participantQuestions.id, e.requestRef));
      if (!seenRevision.has(e.deliveryId)) seenRevision.set(e.deliveryId, row?.answerRevision ?? 0);
      const r = await answerParticipantQuestion(e.tripId, e.requestRef, { submissionId: e.deliveryId, body: e.body, expectedAnswerRevision: seenRevision.get(e.deliveryId)! }, s.as(e.recipientPersonId)); return { replayed: r.replayed }; } },
  { name: "synthetic_sms", setup: async s => { const g = await operateCoordinatorGoal(s.sonoma, { op: "start", commandId: randomUUID(), kind: "participant", title: "Confirm arrival", goal: "Collect a stated arrival time", recipientPersonId: s.taylor, question: "What time do you arrive?" }, s.goalOptions(s.casey));
      const sent = await approveSyntheticOutreach(s.sonoma, { outreachId: g.goal.steps[0].refId!, expectedRevision: 1 }, s.goalOptions(s.casey));
      return { requestRef: sent.address, close: async () => { /* The participant goal completes on its first reply; collection has stopped. */ } }; },
    deliver: async (s, e) => { const r = await ingestSyntheticParticipantReply(e.tripId, e.recipientPersonId, { providerMessageId: e.deliveryId, conversationAddress: e.requestRef, body: e.body, receivedAt: e.receivedAt }, s.goalOptions(s.casey)); return { replayed: r.replayed, late: r.late }; } },
];
for (const adapter of adapters) {
  test(`B12 ${adapter.name}: identity from the adapter, exact trip and recipient, idempotent delivery, conflicting duplicate, revoked access`, { skip }, withSeed(async s => {
    const { requestRef, close } = await adapter.setup(s);
    const envelope = (over: Partial<ParticipantAnswerEnvelope> = {}): ParticipantAnswerEnvelope => ({ channel: adapter.name as ParticipantAnswerEnvelope["channel"], tripId: s.sonoma, recipientPersonId: s.taylor, requestRef, deliveryId: randomUUID(), body: "I land at 3:10 PM.", receivedAt: new Date().toISOString(), ...over });
    await assert.rejects(adapter.deliver(s, envelope({ recipientPersonId: s.jordan })), CommandAccessError, "wrong recipient");
    await assert.rejects(adapter.deliver(s, envelope({ tripId: s.santaFe })), CommandAccessError, "wrong trip");
    const first = envelope();
    assert.equal((await adapter.deliver(s, first)).replayed, false);
    assert.equal((await adapter.deliver(s, first)).replayed, true, "the same delivery is one record");
    await assert.rejects(adapter.deliver(s, { ...first, body: "Different words, same delivery id" }), CommandConflictError);
    // Intentional difference after the request closes: the web refuses a fresh submission; the synthetic adapter retains a late reply privately.
    await close();
    if (adapter.name === "web") await assert.rejects(adapter.deliver(s, envelope()), ParticipantQuestionClosedError);
    else assert.equal((await adapter.deliver(s, envelope())).late, true);
    await s.db.db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.commonsId, s.sonoma), eq(memberships.personId, s.taylor)));
    await assert.rejects(adapter.deliver(s, envelope()), CommandAccessError, "revoked access");
  }));
}

test("B09 a proposal prepared before a correction cannot be applied; one prepared after it can, and only that explicit approval changes the trip", { skip }, withSeed(async s => {
  const { questionId, goal } = await askTaylor(s);
  await publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId, expectedVersion: 1 }, s.as(s.casey));
  const [g] = (await listCoordinatorGoals(s.sonoma, s.goalOptions(s.casey))).goals.filter(item => item.goalId === goal.goalId);
  await answerParticipantQuestion(s.sonoma, questionId, { submissionId: randomUUID(), body: "3:10 PM", expectedAnswerRevision: 0 }, s.as(s.taylor));
  const options = { databaseUrl, actorPersonId: s.casey, sharedCoordinator: true };
  const [trip] = await s.db.db.select().from(commons).where(eq(commons.id, s.sonoma));
  const base = { budgetCents: trip.targetBudgetCents, startsOn: trip.startsOn, endsOn: trip.endsOn, locationName: trip.locationName, stay: null, includedPersonIds: [] };
  const propose = async (cents: number) => {
    const thread = await getCoordinatorThread(s.sonoma, options, undefined, g.threadId);
    await commitCoordinatorTurn(s.sonoma, { commandId: randomUUID(), version: thread.turns.length, threadId: g.threadId, prompt: "Budget the shuttle", draftId: null, draftVersion: null }, "Review before applying.", null, options,
      { tripConversation: true, tripProposal: { version: 1, state: "pending", source: "organizer request", base, changes: { ...base, budgetCents: cents }, operations: ["budget"], travelers: [], receipt: null } });
    return (await getCoordinatorThread(s.sonoma, options, undefined, g.threadId)).turns.at(-1)!;
  };
  const before = await propose(250_000);
  assert.equal((await s.db.db.select().from(commons).where(eq(commons.id, s.sonoma)))[0].targetBudgetCents, trip.targetBudgetCents, "an answer and a pending proposal change nothing");
  await new Promise(resolve => setTimeout(resolve, 5));
  await answerParticipantQuestion(s.sonoma, questionId, { submissionId: randomUUID(), body: "Correction: 5:45 PM", expectedAnswerRevision: 1 }, s.as(s.taylor));
  await assert.rejects(actOnCoordinatorWorkspace(s.sonoma, { turnId: before.id, threadId: g.threadId, commandId: randomUUID(), action: "apply_trip", expectedVersion: 1 }, options), CommandConflictError);
  const after = await propose(260_000);
  await actOnCoordinatorWorkspace(s.sonoma, { turnId: after.id, threadId: g.threadId, commandId: randomUUID(), action: "apply_trip", expectedVersion: 1 }, options);
  assert.equal((await s.db.db.select().from(commons).where(eq(commons.id, s.sonoma)))[0].targetBudgetCents, 260_000);
}));

test("B01 review fix (H1/L2): discarding a never-published draft deletes it; the same question can then be prepared again as a new draft", { skip }, withSeed(async s => {
  const goal = await s.transportGoal(s.sonoma), commandId = randomUUID();
  const input = { commandId, goalId: goal.goalId, expectedGoalRevision: goal.revision, recipientPersonId: s.taylor, purpose: "Airport pickup", question: ARRIVAL, expiresInHours: 48 };
  const first = await prepareParticipantQuestion(s.sonoma, input, s.as(s.casey));
  await assert.rejects(cancelParticipantQuestion(s.sonoma, { questionId: first.questionId }, s.as(s.robin)), CommandAccessError, "only the asker discards");
  const discarded = await cancelParticipantQuestion(s.sonoma, { questionId: first.questionId }, s.as(s.casey));
  assert.equal((discarded as { discarded?: boolean }).discarded, true);
  assert.equal((await s.db.db.select().from(participantQuestions).where(eq(participantQuestions.id, first.questionId))).length, 0);
  const again = await prepareParticipantQuestion(s.sonoma, input, s.as(s.casey));
  assert.equal(again.replayed, false); assert.notEqual(again.questionId, first.questionId);
}));


test("review R2: answering and withdrawing use the same trip-before-question lock order", { skip }, withSeed(async s => {
  const { questionId } = await askTaylor(s);
  await publishParticipantQuestion(s.sonoma, { commandId: randomUUID(), questionId, expectedVersion: 1 }, s.as(s.casey));
  await answerParticipantQuestion(s.sonoma, questionId, { submissionId: randomUUID(), body: "3:10 PM", expectedAnswerRevision: 0 }, s.as(s.taylor));
  let release!: () => void, ready!: (pid: number) => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const acquired = new Promise<number>(resolve => { ready = resolve; });
  // Withdrawal holds the trip, then locks the question. An answer must not hold the question while waiting for the trip FK.
  const approval = s.db.db.transaction(async tx => {
    await tx.select().from(commons).where(eq(commons.id, s.sonoma)).for("update");
    const [row] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
    ready(row.pid); await held;
    await tx.select().from(participantQuestions).where(eq(participantQuestions.id, questionId)).for("update");
  }).then(value => ({ value }), error => ({ error }));
  const pid = await acquired, monitor = createDatabase(databaseUrl);
  let settled = false;
  const correction = answerParticipantQuestion(s.sonoma, questionId, { submissionId: randomUUID(), body: "Correction: 5:45 PM", expectedAnswerRevision: 1 }, s.as(s.taylor))
    .then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  try {
    let blocked = false;
    for (let i = 0; i < 100 && !settled; i++) {
      const [row] = await monitor.db.execute<{ blocked: boolean }>(sql`select exists(select 1 from pg_stat_activity where datname=current_database() and ${pid} = any(pg_blocking_pids(pid))) as blocked`);
      if (row.blocked) { blocked = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, "answer waits for the trip write");
    assert.equal(settled, false);
  } finally { release(); await approval; await monitor.close(); await correction; }
  const withdrawal = await approval;
  assert.ok("value" in withdrawal, "withdrawal must not deadlock against an answer");
  const result = await correction;
  assert.ok("value" in result); assert.equal(result.value.revision, 2);
}));
