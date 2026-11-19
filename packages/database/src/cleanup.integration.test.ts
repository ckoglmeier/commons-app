import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { reservePollInference } from "./poll-inference-repository";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError } from "./event-command";
import { getEventAttendance, setEventAttendance } from "./attendance-repository";
import { approvePollDecision } from "./poll-decision-repository";
import { getPollDeliveryReview, queuePollDeliveries, leasePollDelivery, completePollDelivery, revalidatePollDelivery } from "./poll-delivery-repository";
import {
    addCommonsPerson, claimCommonsInvitation, completeInvitationDeliveryAttempt, getCommonsInvitationLink,
    leaseInvitationDeliveryAttempt, queueCommonsInvitationDeliveries, saveCommonsSetupTravelers, updateCommonsPendingInvitation
} from "./onboarding-repository";
import { createCommonsPoll, getCommonsPollDetail, getPendingPollInvitation, getPublicPollByToken, revokePollRecipient, submitPublicPollResponse, updateCommonsPollStatus } from "./poll-repository";
import { getPublicPollCoverAssetByPublicId } from "./scoped-cover-repository";
import { addCommonsItineraryItem, deleteCommonsMoment, getCommonsSnapshot, updateCommonsItineraryItem, updateCommonsParticipation, updateCommonsTargetBudget } from "./pilot-repository";
import { completePhotoDeletion, expireEventDraftSources, leasePhotoDeletion } from "./maintenance-repository";
import { commitEventCreationDraft } from "./event-creation-repository";
import { hashNormalizedEmail } from "./tokens";
import { listCommonsPollDrafts, saveCommonsPollDraft } from "./poll-draft-repository";
import {
    commons, identities, invitationDeliveryAttempts, invitations,
    eventCreationDraftPeople, eventCreationDrafts, itineraryItems, memberships, moments,
    participation, people, photoDeletions, pollDeliveries, pollResponses, polls
} from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("AI work is draft-owner and organizer scoped, version-bound, and limited before provider work", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const draft = await saveCommonsPollDraft(f.slug, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: { title: "Dinner", intro: "Choose time, place and food", settledFacts: "Saturday", ballotMode: "transparent", questions: [] } }, f.options);
    const request = { draftId: draft.id, version: draft.version };
    await assert.rejects(reservePollInference(f.slug, request, { ...f.options, actorPersonId: f.member }), CommandAccessError);
    await assert.rejects(reservePollInference(f.slug, { ...request, version: draft.version + 1 }, f.options), CommandConflictError);
    const results: Array<PromiseSettledResult<Awaited<ReturnType<typeof reservePollInference>>>> = [];
    for(let batch=0;batch<17;batch++) results.push(...await Promise.allSettled(Array.from({length:6},()=>reservePollInference(f.slug,request,f.options))));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 100);
    assert.equal(results.filter(result => result.status === "rejected").length, 2);
    const success = results.find(result => result.status === "fulfilled");
    assert.ok(success && success.status === "fulfilled");
    assert.deepEqual(success.value, { goal: "Choose time, place and food", settledFacts: "Saturday" });
    const snapshot = await getCommonsSnapshot(f.slug, f.options);
    assert.doesNotMatch(JSON.stringify(snapshot), /poll_inference|Choose time, place and food/);
  } finally { await f.close(); }
});

test("creator without an invitation resolves verified email and revalidates before sending", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const email = `${f.org}@example.test`;
    const [creator] = await f.database.db.select().from(people).where(eq(people.id, f.org));
    await f.database.db.insert(identities).values({ personId: f.org, kind: "email", state: "claimed", normalizedHash: hashNormalizedEmail(email) });
    let current: string | null = email;
    const resolver = async (id: string) => { assert.equal(id, creator.authUserId); return current; };
    const options = { ...f.options, resolveVerifiedEmail: resolver };
    const audience = { personIds: [f.org], guestEmails: [] };
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Creator delivery", ballotMode: "transparent", questions: [{ id: randomUUID(), kind: "text", prompt: "Test?" }] }, options);
    const review = await getPollDeliveryReview(f.slug, poll.id, options, audience);
    assert.deepEqual(review.recipients.map(row => row.email), [email]);
    assert.deepEqual(review.missingPersonIds, []);
    current = "unclaimed@example.test";
    assert.deepEqual((await getPollDeliveryReview(f.slug, poll.id, options, audience)).missingPersonIds, [f.org]);
    await assert.rejects(queuePollDeliveries(f.slug, poll.id, { commandId: randomUUID(), approved: true, fingerprint: review.fingerprint, audience }, options));
    current = null;
    assert.deepEqual((await getPollDeliveryReview(f.slug, poll.id, options, audience)).recipients, []);
    current = email;
    const command = { commandId: randomUUID(), approved: true, fingerprint: review.fingerprint, audience };
    await queuePollDeliveries(f.slug, poll.id, command, options);
    await queuePollDeliveries(f.slug, poll.id, command, options);
    const leased = await leasePollDelivery(f.url, poll.id, resolver);
    assert.ok(leased && !leased.skipped);
    assert.equal(leased.email, email);
    assert.equal(await revalidatePollDelivery(leased.id, leased.attempt, f.url, resolver), true);
    current = null;
    assert.equal(await revalidatePollDelivery(leased.id, leased.attempt, f.url, resolver), false);
    current = email;
    await f.database.db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.commonsId, f.event), eq(memberships.personId, f.org)));
    assert.equal(await revalidatePollDelivery(leased.id, leased.attempt, f.url, resolver), false);
    assert.equal((await f.database.db.select().from(pollDeliveries).where(eq(pollDeliveries.pollId, poll.id))).length, 1);
  } finally { await f.close(); }
});

test("poll delivery queue is reviewed, retry-safe, lease-fenced, and revoked before sending", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const email = "delivery-guest@example.test";
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Private ask", ballotMode: "transparent",
      audience: { personIds: [f.member], guestEmails: [email] }, questions: [{ id: randomUUID(), kind: "text", prompt: "What works?" }] }, f.options);
    const review = await getPollDeliveryReview(f.slug, poll.id, f.options);
    assert.deepEqual(review.recipients.map(row => row.email), [email]);
    assert.deepEqual(review.missingPersonIds, [f.member]);
    const request = { commandId: randomUUID(), fingerprint: review.fingerprint, approved: true };
    await assert.rejects(queuePollDeliveries(f.slug, poll.id, { ...request, fingerprint: "f".repeat(64) }, f.options), { code: "invalid_response" });
    await assert.rejects(queuePollDeliveries(f.slug, poll.id, request, { databaseUrl: f.url, actorPersonId: f.member }), { code: "actor_not_authorized" });
    await queuePollDeliveries(f.slug, poll.id, request, f.options);
    await queuePollDeliveries(f.slug, poll.id, request, f.options);
    assert.equal((await f.database.db.select().from(pollDeliveries).where(eq(pollDeliveries.pollId, poll.id))).length, 1);
    const first = await leasePollDelivery(f.url); assert.ok(first && !first.skipped);
    assert.equal(await revalidatePollDelivery(first.id, first.attempt, f.url), true);
    await f.database.db.update(pollDeliveries).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(pollDeliveries.id, first.id));
    const replacement = await leasePollDelivery(f.url); assert.ok(replacement && !replacement.skipped);
    await completePollDelivery(first.id, first.attempt, { sent: true, providerMessageId: "stale" }, f.url);
    assert.equal((await getPollDeliveryReview(f.slug, poll.id, f.options)).recipients[0].status, "processing");
    await revokePollRecipient(f.slug, poll.id, { commandId: randomUUID(), kind: "email", recipient: email, fingerprint: poll.audienceReview!.fingerprint }, f.options);
    assert.equal(await revalidatePollDelivery(replacement.id, replacement.attempt, f.url), false);
    await f.database.db.update(pollDeliveries).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(pollDeliveries.id, replacement.id));
    assert.deepEqual(await leasePollDelivery(f.url), { skipped: true });
    assert.equal((await f.database.db.select().from(pollDeliveries).where(eq(pollDeliveries.id, first.id)))[0].status, "cancelled");
  } finally { await f.close(); }
});

test("poll delivery isolates request drains, stops after three failures, and never resends a sent job", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Delivery retry", ballotMode: "transparent", audience: { personIds: [], guestEmails: ["retry@example.test", "sent@example.test"] }, questions: [{ id: randomUUID(), kind: "text", prompt: "What works?" }] }, f.options);
    const review = await getPollDeliveryReview(f.slug, poll.id, f.options);
    const queue = () => queuePollDeliveries(f.slug, poll.id, { commandId: randomUUID(), fingerprint: review.fingerprint, approved: true }, f.options);
    await queue();
    assert.equal(await leasePollDelivery(f.url, randomUUID()), null);
    for (let index = 0; index < 4; index += 1) {
      const job = await leasePollDelivery(f.url, poll.id); assert.ok(job && !job.skipped);
      const sent = job.email.startsWith("sent");
      assert.equal(await completePollDelivery(job.id, job.attempt, sent ? { sent: true, providerMessageId: "accepted" } : { sent: false, errorCode: "provider_unavailable" }, f.url), true);
      await queue();
    }
    assert.equal(await leasePollDelivery(f.url, poll.id), null);
    const final = await getPollDeliveryReview(f.slug, poll.id, f.options);
    assert.equal(final.recipients.find(item => item.email.startsWith("sent"))?.status, "sent");
    assert.equal(final.recipients.find(item => item.email.startsWith("retry"))?.errorCode, "operator_review_required");
  } finally { await f.close(); }
});

test("decision approval binds evidence, resolves needs, requires shared scope, and creates one Plan idea", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const questionId = randomUUID(), optionId = randomUUID();
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Housing", ballotMode: "transparent", questions: [{ id: questionId, kind: "choice", prompt: "Which?", selectionMode: "multiple", options: [{ id: optionId, label: "House" }, { id: randomUUID(), label: "Hotel" }] }] }, f.options);
    const ballot = await submitPublicPollResponse(poll.shareToken, { respondentName: "Guest", answers: [{ questionId, optionIds: [optionId], context: { kind: "need", text: "Ground-floor room" } }] }, f.url);
    let closed = await updateCommonsPollStatus(f.slug, poll.id, { commandId: randomUUID(), status: "closed" }, f.options);
    const request = { commandId: randomUUID(), summary: "Explore the house with a ground-floor room", target: "plan_idea", selected: [{ questionId, optionId }], needResolutions: [], uncertaintyAcknowledged: true, audienceExpansionApproved: false, evidenceFingerprint: closed.evidenceFingerprint };
    await assert.rejects(approvePollDecision(f.slug, poll.id, request, f.options), { code: "invalid_response" });
    await updateCommonsPollStatus(f.slug, poll.id, { commandId: randomUUID(), status: "open" }, f.options);
    await submitPublicPollResponse(poll.shareToken, { respondentName: "Guest", receiptToken: ballot.receiptToken, answers: [{ questionId, optionIds: [optionId], context: { kind: "need", text: "Two ground-floor beds" } }] }, f.url);
    closed = await updateCommonsPollStatus(f.slug, poll.id, { commandId: randomUUID(), status: "closed" }, f.options);
    const approved = { ...request, audienceExpansionApproved: true, needResolutions: [{ responseId: closed.responses[0].id, questionId, resolution: "Organizer will verify two ground-floor beds before booking; this remains an Idea." }] };
    await assert.rejects(approvePollDecision(f.slug, poll.id, approved, f.options), { code: "invalid_response" });
    approved.evidenceFingerprint = closed.evidenceFingerprint;
    await assert.rejects(approvePollDecision(f.slug, poll.id, { ...approved, audienceExpansionApproved: false }, f.options), { code: "invalid_response" });
    const saved = await approvePollDecision(f.slug, poll.id, approved, f.options);
    assert.equal(saved.decision?.target, "plan_idea");
    const publicOutcome = await getPublicPollByToken(poll.shareToken, f.url);
    assert.equal(publicOutcome?.decision?.summary, approved.summary);
    assert.doesNotMatch(JSON.stringify(publicOutcome), /Two ground-floor beds|Organizer will verify|needResolutions|evidenceFingerprint/);
    assert.equal((await approvePollDecision(f.slug, poll.id, approved, f.options)).decision?.id, saved.decision?.id);
    const plans = await f.database.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, f.event));
    assert.equal(plans.length, 1); assert.equal(plans[0].status, "idea"); assert.equal(plans[0].startsAt, null);
    await assert.rejects(updateCommonsPollStatus(f.slug, poll.id, { commandId: randomUUID(), status: "open" }, f.options), { code: "invalid_response" });
    const follow = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Final quote", ballotMode: "transparent", sourcePollId: poll.id,
      audience: { personIds: [f.member], guestEmails: [] }, questions: poll.questions }, f.options);
    assert.equal(follow.responseCount, 0);
    assert.equal((await f.database.db.select().from(polls).where(eq(polls.id, follow.id)))[0].sourcePollId, poll.id);
  } finally { await f.close(); }
});

test("written-only decisions preserve review, privacy, authorization, and retry boundaries", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const questionId = randomUUID();
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Dinner needs", ballotMode: "transparent", questions: [{ id: questionId, kind: "text", prompt: "What should we plan around?" }] }, f.options);
    await submitPublicPollResponse(poll.shareToken, { respondentName: "Guest", answers: [{ questionId, optionIds: [], text: "Early dinner", context: { kind: "need", text: "Private dietary detail" } }] }, f.url);
    const base = { commandId: randomUUID(), summary: "Find an early dinner option", target: "record", selected: [], needResolutions: [], uncertaintyAcknowledged: true, audienceExpansionApproved: false, evidenceFingerprint: "f".repeat(64) };
    await assert.rejects(approvePollDecision(f.slug, poll.id, base, f.options), { code: "invalid_response" });
    const closed = await updateCommonsPollStatus(f.slug, poll.id, { commandId: randomUUID(), status: "closed" }, f.options);
    const request = { ...base, evidenceFingerprint: closed.evidenceFingerprint, needResolutions: [{ responseId: closed.responses[0].id, questionId, resolution: "Check privately before confirming" }] };
    await assert.rejects(approvePollDecision(f.slug, poll.id, { ...request, needResolutions: [] }, f.options), { code: "invalid_response" });
    await assert.rejects(approvePollDecision(f.slug, poll.id, { ...request, evidenceFingerprint: "f".repeat(64) }, f.options), { code: "invalid_response" });
    await assert.rejects(approvePollDecision(f.slug, poll.id, request, { ...f.options, actorPersonId: f.member }), { code: "actor_not_authorized" });
    await assert.rejects(approvePollDecision(f.slug, poll.id, { ...request, target: "plan_idea" }, f.options), { code: "invalid_response" });
    const saved = await approvePollDecision(f.slug, poll.id, request, f.options);
    assert.equal((await approvePollDecision(f.slug, poll.id, request, f.options)).decision?.id, saved.decision?.id);
    assert.equal(saved.decision?.summary, request.summary);
    const publicPoll = await getPublicPollByToken(poll.shareToken, f.url);
    assert.doesNotMatch(JSON.stringify(publicPoll), /Private dietary detail|Check privately|needResolutions|evidenceFingerprint/);
    assert.equal((await f.database.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, f.event))).length, 0);
    const choice = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Choose dinner", ballotMode: "transparent", questions: [{ id: randomUUID(), kind: "choice", prompt: "Where?", selectionMode: "single", options: [{ id: randomUUID(), label: "Cafe" }, { id: randomUUID(), label: "Park" }] }] }, f.options);
    const closedChoice = await updateCommonsPollStatus(f.slug, choice.id, { commandId: randomUUID(), status: "closed" }, f.options);
    await assert.rejects(approvePollDecision(f.slug, choice.id, { ...base, commandId: randomUUID(), evidenceFingerprint: closedChoice.evidenceFingerprint }, f.options), { code: "invalid_response" });
  } finally { await f.close(); }
});

test("selected audiences enforce account identity, response-only scope, safe revision, and recipient revocation", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const member = { authUserId: f.auth, email: f.email };
    const guest = { authUserId: randomUUID(), email: "response-only@example.test" };
    const outsider = { authUserId: randomUUID(), email: "outsider@example.test" };
    const questionId = randomUUID();
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Selected people only", ballotMode: "transparent",
      audience: { personIds: [f.member], guestEmails: [guest.email] }, questions: [{ id: questionId, kind: "text", prompt: "Ideas?", required: false }] }, f.options);
    assert.equal(await getPublicPollByToken(poll.shareToken, f.url), null);
    assert.equal(await getPublicPollByToken(poll.shareToken, f.url, outsider), null);
    assert.equal((await getPublicPollByToken(poll.shareToken, f.url, member))?.identityBound, true);
    assert.equal((await getPublicPollByToken(poll.shareToken, f.url, guest))?.identityBound, true);
    assert.equal((await getCommonsSnapshot(f.slug, { databaseUrl: f.url, actorPersonId: f.member }))?.state.pollRequests?.filter(row => row.id === poll.id).length, 1);
    const otherPoll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Private subset question", ballotMode: "transparent",
      audience: { personIds: [], guestEmails: [guest.email] }, questions: [{ id: randomUUID(), kind: "text", prompt: "Only for this guest?" }] }, f.options);
    assert.equal((await getCommonsSnapshot(f.slug, { databaseUrl: f.url, actorPersonId: f.member }))?.state.pollRequests?.some(row => row.id === otherPoll.id), false);
    assert.equal((await getCommonsSnapshot(f.slug, f.options))?.state.pollRequests?.some(row => row.id === otherPoll.id), true);
    await f.database.db.update(commons).set({ coverOriginalStoragePath: `${f.event}/cover/test.jpg`, coverMimeType: "image/jpeg" }).where(eq(commons.id, f.event));
    assert.equal(await getPublicPollCoverAssetByPublicId(poll.publicId, f.url, outsider), null);
    assert.ok(await getPublicPollCoverAssetByPublicId(poll.publicId, f.url, guest));
    const body = { respondentName: "Guest", answers: [{ questionId, optionIds: [], text: "A quiet place" }], newReceiptToken: randomUUID() + randomUUID() };
    await assert.rejects(submitPublicPollResponse(poll.shareToken, body, f.url, outsider), { code: "poll_not_found" });
    const first = await submitPublicPollResponse(poll.shareToken, body, f.url, guest);
    await submitPublicPollResponse(poll.shareToken, body, f.url, guest);
    assert.equal(first.poll?.responseCount, 1);
    assert.equal((await getPublicPollByToken(poll.shareToken, f.url, member))?.ownResponse, null);
    assert.equal((await getPublicPollByToken(poll.shareToken, f.url, guest))?.ownResponse?.answers[0].text, "A quiet place");
    assert.equal((await f.database.db.select().from(people).where(eq(people.authUserId, guest.authUserId))).length, 0); // response-only never creates an account/person or event membership
    const revised = { ...body, answers: [{ questionId, optionIds: [], text: "A shaded patio" }] };
    await assert.rejects(submitPublicPollResponse(poll.shareToken, revised, f.url, guest), { code: "invalid_response" });
    await submitPublicPollResponse(poll.shareToken, { ...revised, expectedResponseUpdatedAt: first.poll?.ownResponse?.updatedAt }, f.url, guest);
    assert.equal((await getPublicPollByToken(poll.shareToken, f.url, guest))?.responseCount, 1);
    await revokePollRecipient(f.slug, poll.id, { commandId: randomUUID(), kind: "email", recipient: guest.email, fingerprint: poll.audienceReview!.fingerprint }, f.options);
    assert.equal(await getPublicPollByToken(poll.shareToken, f.url, guest), null);
    assert.equal(await getPublicPollCoverAssetByPublicId(poll.publicId, f.url, guest), null);
    await assert.rejects(submitPublicPollResponse(poll.shareToken, body, f.url, guest), { code: "poll_not_found" });
    await setEventAttendance(f.slug, { commandId: randomUUID(), state: "declined", reviewedDates: "unset/unset" }, { databaseUrl: f.url, actorPersonId: f.member });
    assert.equal(await getPublicPollByToken(poll.shareToken, f.url, member), null);
    assert.equal((await getCommonsPollDetail(f.slug, poll.id, f.options)).responses.length, 1);
  } finally { await f.close(); }
});

test("selected invitation requires relationship confirmation and a fresh invitation after decline", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const email = `${randomUUID()}@example.test`, authUserId = randomUUID();
    const invited = await addCommonsPerson(f.slug, { displayName: "Invited respondent", email }, f.options);
    assert.ok(invited.invitationId);
    const [invitation] = await f.database.db.select().from(invitations).where(eq(invitations.id, invited.invitationId));
    const personId = invitation.provisionalPersonId;
    f.extra.push(personId);
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Help shape this trip", ballotMode: "transparent",
      audience: { personIds: [personId], guestEmails: [] }, questions: [{ id: randomUUID(), kind: "text", prompt: "What could work?" }] }, f.options);
    const viewer = { authUserId, email };
    assert.equal(await getPublicPollByToken(poll.shareToken, f.url, viewer), null);
    assert.equal(await getPendingPollInvitation(poll.publicId, { ...viewer, email: "wrong@example.test" }, f.url), null);
    const token = await getPendingPollInvitation(poll.publicId, viewer, f.url);
    assert.ok(token);
    await claimCommonsInvitation(token, viewer, f.url);
    assert.ok(await getPublicPollByToken(poll.shareToken, f.url, viewer));
    assert.equal((await getEventAttendance(f.slug, { databaseUrl: f.url, actorPersonId: personId })).people.find(row => row.personId === personId)?.state, "helping");
    await setEventAttendance(f.slug, { commandId: randomUUID(), state: "declined", reviewedDates: "unset/unset" }, { databaseUrl: f.url, actorPersonId: personId });
    assert.equal(await getPublicPollByToken(poll.shareToken, f.url, viewer), null);
    assert.equal(await getPendingPollInvitation(poll.publicId, viewer, f.url), null);
    await assert.rejects(claimCommonsInvitation(token, viewer, f.url));
    const fresh = await addCommonsPerson(f.slug, { displayName: "Invited respondent", email }, f.options);
    assert.ok(fresh.invitationId);
    const freshLink = await getCommonsInvitationLink(f.slug, fresh.invitationId, f.options);
    assert.notEqual(freshLink.token, token);
    await claimCommonsInvitation(freshLink.token, viewer, f.url);
    assert.equal((await getEventAttendance(f.slug, { databaseUrl: f.url, actorPersonId: personId })).people.find(row => row.personId === personId)?.state, "helping");
  } finally { await f.close(); }
});

test("attendance is date-bound, decline removes access without deleting history, and retries cannot restore access", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const options = { databaseUrl: f.url, actorPersonId: f.member };
    assert.equal((await getEventAttendance(f.slug, options)).people.find(row => row.personId === f.member)?.state, "helping");
    await assert.rejects(setEventAttendance(f.slug, { commandId: randomUUID(), state: "attending", reviewedDates: "unset/unset" }, options), { code: "attendance_review_required" });
    await f.database.db.update(commons).set({ startsOn: "2027-03-20", endsOn: "2027-03-26" }).where(eq(commons.id, f.event));
    const yes = { commandId: randomUUID(), state: "attending", reviewedDates: "2027-03-20/2027-03-26" };
    await setEventAttendance(f.slug, yes, options);
    assert.equal((await getEventAttendance(f.slug, options)).people.find(row => row.personId === f.member)?.state, "attending");
    await f.database.db.update(commons).set({ endsOn: "2027-03-27" }).where(eq(commons.id, f.event));
    assert.equal((await getEventAttendance(f.slug, options)).people.find(row => row.personId === f.member)?.state, "needs_confirmation");
    await setEventAttendance(f.slug, yes, options); // exact retry succeeds, but never reconfirms the changed dates
    await assert.rejects(setEventAttendance(f.slug, { ...yes, commandId: randomUUID() }, options), { code: "attendance_review_required" });
    await assert.rejects(setEventAttendance(f.otherSlug, { ...yes, commandId: randomUUID() }, options), { code: "actor_not_authorized" });
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Before leaving", ballotMode: "transparent", questions: [{ id: randomUUID(), kind: "text", prompt: "Ideas?", required: false }] }, options);
    const decline = { commandId: randomUUID(), state: "declined", reviewedDates: "2027-03-20/2027-03-27" };
    await setEventAttendance(f.slug, decline, options);
    await setEventAttendance(f.slug, decline, options);
    await assert.rejects(setEventAttendance(f.slug, { ...decline, state: "attending" }, options), { code: "actor_not_authorized" });
    await assert.rejects(getEventAttendance(f.slug, options), { code: "actor_not_authorized" });
    await assert.rejects(getCommonsPollDetail(f.slug, poll.id, options), { code: "poll_not_found" });
    assert.equal((await getEventAttendance(f.slug, f.options)).people.find(row => row.personId === f.member)?.state, "declined");
    assert.equal((await getCommonsPollDetail(f.slug, poll.id, f.options)).createdByName, "Original Name");
    await assert.rejects(setEventAttendance(f.slug, { ...decline, commandId: randomUUID() }, f.options), { code: "attendance_review_required" });
  } finally { await f.close(); }
});

test("unfinished recipient selection saves privately but cannot publish", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const draft = await saveCommonsPollDraft(f.slug, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0,
      data: { title: "Follow-up", intro: null, ballotMode: "transparent", audience: { personIds: [], guestEmails: [] },
        questions: [{ id: randomUUID(), kind: "text", prompt: "What works?", required: false }] } }, f.options);
    assert.deepEqual((await listCommonsPollDrafts(f.slug, f.options))[0].data.audience, { personIds: [], guestEmails: [] });
    assert.equal((await listCommonsPollDrafts(f.slug, { ...f.options, actorPersonId: f.member })).length, 0);
    await assert.rejects(createCommonsPoll(f.slug, { ...draft.data, commandId: randomUUID(), draftId: draft.id, draftVersion: draft.version }, f.options));
    assert.equal((await f.database.db.select().from(polls).where(eq(polls.commonsId, f.event))).length, 0);
  } finally { await f.close(); }
});

test("poll working drafts are private, retry-safe, version-bound and publish exactly once", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const draftId = randomUUID();
    const data = { title: "Dinner", intro: "Choose date and place", ballotMode: "transparent", questions: [
      { id: randomUUID(), kind: "text", prompt: "What dates?", required: false },
    ] };
    const save = { id: draftId, commandId: randomUUID(), expectedVersion: 0, data };
    const original = await saveCommonsPollDraft(f.slug, save, f.options);
    assert.equal((await saveCommonsPollDraft(f.slug, save, f.options)).version, 1);
    assert.equal((await listCommonsPollDrafts(f.slug, { databaseUrl: f.url, actorPersonId: f.member })).length, 0);
    assert.equal((await listCommonsPollDrafts(f.otherSlug, f.options)).length, 0);
    await assert.rejects(saveCommonsPollDraft(f.slug, save, { databaseUrl: f.url, actorPersonId: f.member }), { code: "actor_not_authorized" });
    const competing = await Promise.allSettled(["Dinner together", "Dinner with friends"].map(title => saveCommonsPollDraft(f.slug,
      { ...save, commandId: randomUUID(), expectedVersion: 1, data: { ...data, title } }, f.options)));
    assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(competing.filter(result => result.status === "rejected").length, 1);
    const revised = (await listCommonsPollDrafts(f.slug, f.options))[0];
    assert.equal(revised.version, 2);
    await assert.rejects(saveCommonsPollDraft(f.slug, { ...save, commandId: randomUUID(), expectedVersion: 1 }, f.options), { code: "command_conflict" });
    await assert.rejects(createCommonsPoll(f.slug, { ...original.data, commandId: randomUUID(), draftId, draftVersion: 1 }, f.options), { code: "invalid_response" });
    await assert.rejects(createCommonsPoll(f.slug, { ...revised.data, title: "Changed without saving", commandId: randomUUID(), draftId, draftVersion: 2 }, f.options), { code: "invalid_response" });
    const publish = { ...revised.data, commandId: randomUUID(), draftId, draftVersion: 2 };
    const poll = await createCommonsPoll(f.slug, publish, f.options);
    assert.equal((await createCommonsPoll(f.slug, publish, f.options)).id, poll.id);
    await assert.rejects(createCommonsPoll(f.slug, { ...publish, commandId: randomUUID() }, f.options), { code: "invalid_response" });
    assert.equal((await listCommonsPollDrafts(f.slug, f.options))[0].publishedPollId, poll.id);
    await assert.rejects(saveCommonsPollDraft(f.slug, { ...save, expectedVersion: 2, commandId: randomUUID() }, f.options), { code: "command_conflict" });
    await f.database.db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.commonsId, f.event), eq(memberships.personId, f.org)));
    await assert.rejects(listCommonsPollDrafts(f.slug, f.options), { code: "actor_not_authorized" });
  } finally { await f.close(); }
});

test("Fieldnotes private context survives retry and revision but never reaches member or public results", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const questionId = randomUUID(), optionId = randomUUID();
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Dinner options", ballotMode: "transparent",
      questions: [{ id: questionId, kind: "choice", prompt: "Where?", selectionMode: "multiple", required: true,
        options: [{ id: optionId, label: "Patio" }, { id: randomUUID(), label: "Dining room" }] }] }, f.options);
    const input = { respondentName: "Morgan", newReceiptToken: randomUUID() + randomUUID(), answers: [
      { questionId, optionIds: [optionId], text: null, context: { kind: "need", text: "Step-free entrance" } },
    ] };
    const first = await submitPublicPollResponse(poll.shareToken, input, f.url);
    await submitPublicPollResponse(poll.shareToken, input, f.url);
    assert.equal((await getPublicPollByToken(poll.shareToken, f.url))?.responseCount, 1);
    const organizer = await getCommonsPollDetail(f.slug, poll.id, f.options);
    assert.equal(organizer.responses[0].answers?.[0].context?.text, "Step-free entrance");
    const member = await getCommonsPollDetail(f.slug, poll.id, { databaseUrl: f.url, actorPersonId: f.member });
    assert.equal(member.responses[0].answers?.[0].context, undefined);
    assert.doesNotMatch(JSON.stringify(first.poll), /Step-free/);
    await assert.rejects(getCommonsPollDetail(f.otherSlug, poll.id, f.options), { code: "poll_not_found" });
    await submitPublicPollResponse(poll.shareToken, { ...input, receiptToken: first.receiptToken,
      answers: [{ questionId, optionIds: [optionId], text: null }] }, f.url);
    assert.equal((await getCommonsPollDetail(f.slug, poll.id, f.options)).responses[0].answers?.[0].context, undefined);
    const secret = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Secret", ballotMode: "secret", questions: poll.questions }, f.options);
    await assert.rejects(submitPublicPollResponse(secret.shareToken, { ...input, newReceiptToken: randomUUID() + randomUUID() }, f.url), { code: "invalid_response" });
  } finally { await f.close(); }
});
async function fixture() {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "An explicit TEST_DATABASE_URL is required.");
  const database = createDatabase(url);
  const org = randomUUID(), member = randomUUID(), auth = randomUUID();
  const event = randomUUID(), otherEvent = randomUUID();
  const slug = `cleanup-${event}`, otherSlug = `cleanup-${otherEvent}`;
  const email = `${member}@example.test`;
  await database.db.insert(people).values([
    { id: org, displayName: "Organizer", authUserId: randomUUID() },
    { id: member, displayName: "Original Name", authUserId: auth },
  ]);
  await database.db.insert(identities).values({ personId: member, kind: "email", state: "claimed", normalizedHash: hashNormalizedEmail(email) });
  await database.db.insert(commons).values([
    { id: event, slug, name: "Test event", timezone: "UTC", createdByPersonId: org },
    { id: otherEvent, slug: otherSlug, name: "Other event", timezone: "UTC", createdByPersonId: org },
  ]);
  await database.db.insert(memberships).values([
    { commonsId: event, personId: org, role: "organizer", status: "active" },
    { commonsId: otherEvent, personId: org, role: "organizer", status: "active" },
    { commonsId: event, personId: member, role: "member", status: "active" },
  ]);
  const extra: string[] = [];
  return { database, url, org, member, auth, event, otherEvent, slug, otherSlug, email, extra,
    options: { databaseUrl: url, actorPersonId: org },
    async close() {
      await database.db.delete(commons).where(inArray(commons.id, [event, otherEvent]));
      await database.db.delete(people).where(inArray(people.id, [org, member, ...extra]));
      await database.close();
    },
  };
}

test("database roles cannot bypass repository privacy while Storage membership still works", { skip: !run }, async () => {
  const f = await fixture();
  const client = postgres(f.url, { max: 1 });
  try {
    const asRole = (role: "anon" | "authenticated", auth: string, query: string) => client.begin(async tx => {
      await tx`SELECT set_config('request.jwt.claim.sub', ${auth}, true)`;
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      return tx.unsafe(query);
    });
    for (const table of ["travel_plans", "audit_events", "invitations", "people", "messages", "poll_drafts", "poll_decisions", "poll_deliveries"]) {
      await assert.rejects(asRole("authenticated", f.auth, `SELECT * FROM public.${table}`), { code: "42501" });
    }
    await assert.rejects(asRole("authenticated", f.auth, "UPDATE public.participation SET revision = 999"), { code: "42501" });
    await assert.rejects(asRole("anon", "", "SELECT id FROM public.commons"), { code: "42501" });
    const events = await asRole("authenticated", f.auth, "SELECT id FROM public.commons");
    assert.deepEqual(events.map(row => row.id), [f.event]);
    const ownPath = `${f.slug}/photo.jpg`;
    const otherPath = `${f.otherSlug}/photo.jpg`;
    await client`INSERT INTO storage.objects (bucket_id, name) VALUES ('commons-moments', ${ownPath}), ('commons-moments', ${otherPath})`;
    const photos = await asRole("authenticated", f.auth, "SELECT name FROM storage.objects");
    assert.deepEqual(photos.map(row => row.name), [ownPath]);
    await f.database.db.update(memberships).set({ status: "removed" })
      .where(and(eq(memberships.commonsId, f.event), eq(memberships.personId, f.member)));
    assert.equal((await asRole("authenticated", f.auth, "SELECT name FROM storage.objects")).length, 0);
    assert.equal((await asRole("authenticated", randomUUID(), "SELECT id FROM public.commons")).length, 0);
    await client`DELETE FROM storage.objects WHERE name IN (${ownPath}, ${otherPath})`;
  } finally { await client.end(); await f.close(); }
});

test("setup preserves joined membership and invitation edits cannot rename a global person", { skip: !run }, async () => {
  const f = await fixture();
  try {
    await saveCommonsSetupTravelers(f.slug, { travelers: [{ displayName: "Changed name", email: f.email }] }, f.options);
    const [member] = await f.database.db.select().from(memberships)
      .where(and(eq(memberships.commonsId, f.event), eq(memberships.personId, f.member)));
    assert.equal(member.status, "active");
    const invite = await addCommonsPerson(f.otherSlug, { displayName: "Invitation name", email: f.email }, f.options);
    assert.ok(invite.invitationId);
    await updateCommonsPendingInvitation(f.otherSlug, invite.invitationId, { displayName: "Recipient label", email: f.email }, f.options);
    const [global] = await f.database.db.select().from(people).where(eq(people.id, f.member));
    assert.equal(global.displayName, "Original Name");
    await assert.rejects(updateCommonsPendingInvitation(f.otherSlug, invite.invitationId,
      { displayName: "Recipient label", email: "replacement@example.test" }, f.options), { code: "identity_conflict" });
  } finally { await f.close(); }
});

test("a conflicting claim leaves participant references and access intact", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const email = `${randomUUID()}@example.test`;
    const invitation = await addCommonsPerson(f.slug, { displayName: "Other participant", email }, f.options);
    assert.ok(invitation.invitationId);
    const [row] = await f.database.db.select().from(invitations).where(eq(invitations.id, invitation.invitationId));
    f.extra.push(row.provisionalPersonId);
    const [item] = await f.database.db.insert(itineraryItems).values({ commonsId: f.event, title: "Walk", timezone: "UTC", audience: "everyone", provenanceLabel: "Test" }).returning();
    await f.database.db.insert(participation).values({ itineraryItemId: item.id, personId: row.provisionalPersonId, status: "in", source: "web" });
    const link = await getCommonsInvitationLink(f.slug, row.id, f.options);
    await assert.rejects(claimCommonsInvitation(link.token, { authUserId: f.auth, email }, f.url), { code: "identity_conflict" });
    assert.equal((await f.database.db.select().from(participation).where(eq(participation.personId, row.provisionalPersonId))).length, 1);
    const [pending] = await f.database.db.select().from(invitations).where(eq(invitations.id, row.id));
    assert.equal(pending.status, "pending");
  } finally { await f.close(); }
});

test("concurrent and replayed commands cannot duplicate work or overwrite newer poll and budget state", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const command = { commandId: randomUUID(), amountCents: 10000 };
    await Promise.all([updateCommonsTargetBudget(f.slug, command, f.options), updateCommonsTargetBudget(f.slug, command, f.options)]);
    await updateCommonsTargetBudget(f.slug, { commandId: randomUUID(), amountCents: 20000 }, f.options);
    await updateCommonsTargetBudget(f.slug, command, f.options);
    assert.equal((await f.database.db.select().from(commons).where(eq(commons.id, f.event)))[0].targetBudgetCents, 20000);
    await assert.rejects(updateCommonsTargetBudget(f.slug, { ...command, amountCents: 30000 }, f.options), CommandConflictError);
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Choose", ballotMode: "transparent",
      questions: [{ id: randomUUID(), kind: "choice", prompt: "Day", selectionMode: "single", options: [{ id: randomUUID(), label: "Friday" }, { id: randomUUID(), label: "Saturday" }] }],
    }, f.options);
    const close = { commandId: randomUUID(), status: "closed" };
    await updateCommonsPollStatus(f.slug, poll.id, close, f.options);
    await updateCommonsPollStatus(f.slug, poll.id, { commandId: randomUUID(), status: "open" }, f.options);
    await updateCommonsPollStatus(f.slug, poll.id, close, f.options);
    assert.equal((await f.database.db.select().from(polls).where(eq(polls.id, poll.id)))[0].status, "open");
    await f.database.db.update(memberships).set({ status: "removed" }).where(and(eq(memberships.commonsId, f.event), eq(memberships.personId, f.org)));
    await assert.rejects(updateCommonsTargetBudget(f.slug, command, f.options), CommandAccessError);
  } finally { await f.close(); }
});

test("organizer estimates preserve a participant's own response", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const [item] = await f.database.db.insert(itineraryItems).values({ commonsId: f.event, title: "Walk", timezone: "UTC", audience: "everyone", provenanceLabel: "Test" }).returning();
    await f.database.db.insert(participation).values({ itineraryItemId: item.id, personId: f.member, status: "skip", source: "web" });
    const command = { commandId: randomUUID(), title: "Walk", date: null, time: null, participantScope: "everyone",
      expectedCostCents: 5000, expectedCostBasis: "total", expectedParticipantIds: [f.member], occurredAt: new Date().toISOString() };
    await updateCommonsItineraryItem(f.slug, item.id, command, f.options);
    await updateCommonsItineraryItem(f.slug, item.id, { ...command, commandId: randomUUID(), expectedParticipantIds: [] }, f.options);
    const [response] = await f.database.db.select().from(participation).where(and(eq(participation.itineraryItemId, item.id), eq(participation.personId, f.member)));
    assert.equal(response.status, "skip"); assert.equal(response.source, "web");
  } finally { await f.close(); }
});

test("Just me saves only the authenticated attendee, survives reload and retries, and remains shared", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const options = { ...f.options, actorPersonId: f.member };
    for (const scheduled of [false, true]) {
      const command = { commandId: randomUUID(), title: scheduled ? "Spa appointment" : "Spa idea", date: scheduled ? "2027-03-21" : null, time: scheduled ? "15:00" : null,
        participantScope: "self", expectedCostCents: 27_500, expectedCostBasis: scheduled ? "total" : "per_person", expectedParticipantIds: [f.org], occurredAt: new Date().toISOString() };
      const snapshot = await addCommonsItineraryItem(f.slug, command, options);
      const item = snapshot!.state.itinerary.find((item) => item.title === command.title)!;
      assert.ok(item);
      assert.equal(item.participantScope, "subgroup");
      assert.equal(item.status, scheduled ? "planned" : "idea");
      assert.deepEqual(item.participantIds, [f.member]);
      assert.deepEqual(item.expectedParticipantIds, [f.member]);
      assert.equal(snapshot!.state.participation[item.id], "in");
      const retry = await addCommonsItineraryItem(f.slug, command, options);
      assert.equal(retry!.state.itinerary.filter((entry) => entry.title === command.title).length, 1);
      const shared = await getCommonsSnapshot(f.slug, f.options);
      assert.deepEqual(shared!.state.itinerary.find((entry) => entry.id === item.id)?.participantIds, [f.member]);
      assert.equal(shared!.state.participation[item.id], undefined);
      const edit = { ...command, commandId: randomUUID(), title: `${command.title} updated`, expectedParticipantIds: [] };
      await updateCommonsItineraryItem(f.slug, item.id, edit, options);
      await updateCommonsItineraryItem(f.slug, item.id, edit, options);
      const reloaded = await getCommonsSnapshot(f.slug, options);
      assert.deepEqual(reloaded!.state.itinerary.find((entry) => entry.id === item.id)?.participantIds, [f.member]);
      assert.deepEqual(reloaded!.state.itinerary.find((entry) => entry.id === item.id)?.expectedParticipantIds, [f.member]);
    }
    await assert.rejects(addCommonsItineraryItem(f.otherSlug, { commandId: randomUUID(), title: "Unauthorized", date: null, time: null, participantScope: "self", occurredAt: new Date().toISOString() }, options), { code: "actor_not_authorized" });
  } finally { await f.close(); }
});

test("Just me replaces estimates but never erases another traveler's response", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const command = { commandId: randomUUID(), title: "Spa", date: null, time: null, participantScope: "everyone", expectedCostCents: 27_500, expectedCostBasis: "per_person", expectedParticipantIds: [f.org, f.member], occurredAt: new Date().toISOString() };
    const initial = await addCommonsItineraryItem(f.slug, command, f.options);
    const item = initial!.state.itinerary.find((entry) => entry.title === "Spa")!;
    const self = { ...command, commandId: randomUUID(), participantScope: "self" };
    const solo = await updateCommonsItineraryItem(f.slug, item.id, self, f.options);
    assert.deepEqual(solo!.state.itinerary.find((entry) => entry.id === item.id)?.expectedParticipantIds, [f.org]);
    assert.deepEqual(solo!.state.itinerary.find((entry) => entry.id === item.id)?.participantIds, [f.org]);
    const open = await updateCommonsItineraryItem(f.slug, item.id, { ...command, commandId: randomUUID(), participantScope: "optional", expectedParticipantIds: [f.org] }, f.options);
    assert.equal(open!.state.itinerary.find((entry) => entry.id === item.id)?.participantScope, "optional");
    assert.deepEqual(open!.state.itinerary.find((entry) => entry.id === item.id)?.participantIds, [f.org]);
    for (const response of ["maybe", "in"] as const) {
      await updateCommonsParticipation(f.slug, item.id, { commandId: randomUUID(), response, occurredAt: new Date().toISOString() }, { ...f.options, actorPersonId: f.member });
      await assert.rejects(updateCommonsItineraryItem(f.slug, item.id, { ...self, commandId: randomUUID(), title: "Should not save" }, f.options), { code: "actor_not_authorized" });
      const unchanged = await getCommonsSnapshot(f.slug, { ...f.options, actorPersonId: f.member });
      assert.equal(unchanged!.state.participation[item.id], response);
      assert.equal(unchanged!.state.itinerary.find((entry) => entry.id === item.id)?.title, "Spa");
    }
  } finally { await f.close(); }
});

test("expired invitation workers cannot overwrite a replacement lease or sent result", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const invite = await addCommonsPerson(f.slug, { displayName: "Invitee", email: `${randomUUID()}@example.test` }, f.options);
    assert.ok(invite.invitationId);
    const [row] = await f.database.db.select().from(invitations).where(eq(invitations.id, invite.invitationId));
    f.extra.push(row.provisionalPersonId);
    const [queued] = await queueCommonsInvitationDeliveries(f.slug, row.id, f.options);
    const first = await leaseInvitationDeliveryAttempt(queued.deliveryAttemptId, f.url);
    assert.ok(first);
    await f.database.db.update(invitationDeliveryAttempts).set({ leaseExpiresAt: new Date(0) }).where(eq(invitationDeliveryAttempts.id, first.deliveryAttemptId));
    const second = await leaseInvitationDeliveryAttempt(first.deliveryAttemptId, f.url);
    assert.ok(second);
    assert.notEqual(first.leaseAttempt, second.leaseAttempt);
    assert.equal(await completeInvitationDeliveryAttempt(first.deliveryAttemptId, { leaseAttempt: first.leaseAttempt, sent: false }, f.url), false);
    assert.equal(await completeInvitationDeliveryAttempt(second.deliveryAttemptId, { leaseAttempt: second.leaseAttempt, sent: true }, f.url), true);
    assert.equal(await completeInvitationDeliveryAttempt(second.deliveryAttemptId, { leaseAttempt: second.leaseAttempt, sent: false }, f.url), false);
    assert.equal((await f.database.db.select().from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.id, first.deliveryAttemptId)))[0].status, "sent");
  } finally { await f.close(); }
});

test("a lost first ballot response can be retried once without duplicating or overwriting a revision", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const q = randomUUID(), a = randomUUID(), b = randomUUID();
    const poll = await createCommonsPoll(f.slug, { commandId: randomUUID(), title: "Retry poll", ballotMode: "secret",
      questions: [{ id: q, kind: "choice", prompt: "Day", selectionMode: "single", options: [{ id: a, label: "Friday" }, { id: b, label: "Saturday" }] }],
    }, f.options);
    const original = { respondentName: "Traveler", newReceiptToken: randomUUID() + randomUUID(), answers: [{ questionId: q, optionIds: [a], text: null }] };
    const results = await Promise.all([submitPublicPollResponse(poll.shareToken, original, f.url), submitPublicPollResponse(poll.shareToken, original, f.url)]);
    assert.equal(results[0].receiptToken, results[1].receiptToken);
    await submitPublicPollResponse(poll.shareToken, { respondentName: "Traveler", receiptToken: results[0].receiptToken,
      answers: [{ questionId: q, optionIds: [b], text: null }] }, f.url);
    await assert.rejects(submitPublicPollResponse(poll.shareToken, original, f.url), { code: "invalid_response" });
    const rows = await f.database.db.select().from(pollResponses).where(eq(pollResponses.pollId, poll.id));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].answers[0].optionIds, [b]);
  } finally { await f.close(); }
});

test("photo deletion is atomic, blocks known Storage paths immediately and fences worker retries", { skip: !run }, async () => {
  const f = await fixture(), client = postgres(f.url, { max: 1 });
  const path = `${f.slug}/deleted-photo.jpg`;
  try {
    const [moment] = await f.database.db.insert(moments).values({ commonsId: f.event, caption: "Photo", storagePath: path,
      mimeType: "image/jpeg", addedByPersonId: f.org, altText: "Test photo", occurredAt: new Date(), source: "web", sourceLabel: "Test" }).returning();
    await client`INSERT INTO storage.objects (bucket_id, name) VALUES ('commons-moments', ${path})`;
    const command = { commandId: randomUUID() };
    await deleteCommonsMoment(f.slug, moment.id, command, f.options);
    await deleteCommonsMoment(f.slug, moment.id, command, f.options);
    assert.equal((await f.database.db.select().from(moments).where(eq(moments.id, moment.id))).length, 0);
    assert.equal((await f.database.db.select().from(photoDeletions).where(eq(photoDeletions.storagePath, path))).length, 1);
    const visible = await client.begin(async tx => {
      await tx`SELECT set_config('request.jwt.claim.sub', ${f.auth}, true)`;
      await tx.unsafe('SET LOCAL ROLE authenticated');
      return tx`SELECT name FROM storage.objects WHERE name = ${path}`;
    });
    assert.equal(visible.length, 0);
    const first = await leasePhotoDeletion(f.url); assert.ok(first);
    const later = new Date(Date.now() + 6 * 60_000);
    const second = await leasePhotoDeletion(f.url, later); assert.ok(second);
    assert.equal(await completePhotoDeletion(first.id, first.leaseAttempt, true, f.url, later), false);
    assert.equal(await completePhotoDeletion(second.id, second.leaseAttempt, false, f.url, later), true);
    const retryTime = new Date(later.getTime() + 6 * 60_000);
    const third = await leasePhotoDeletion(f.url, retryTime); assert.ok(third);
    assert.equal(await completePhotoDeletion(third.id, third.leaseAttempt, true, f.url, retryTime), true);
    assert.equal((await f.database.db.select().from(photoDeletions).where(eq(photoDeletions.id, third.id)))[0].status, "deleted");
  } finally {
    await client`DELETE FROM storage.objects WHERE name = ${path}`;
    await f.database.db.delete(photoDeletions).where(eq(photoDeletions.storagePath, path));
    await client.end(); await f.close();
  }
});

test("committing a draft preserves a traveler without contact details and expires only the retained source", { skip: !run }, async () => {
  const f = await fixture();
  let createdId: string | undefined;
  try {
    const [draft] = await f.database.db.insert(eventCreationDrafts).values({ createdByPersonId: f.org, sourceKind: "description",
      description: "Private source", proposedName: "Test trip", timezone: "UTC", supported: true, status: "reviewing" }).returning();
    await f.database.db.insert(eventCreationDraftPeople).values({ id: randomUUID(), source: "manual", draftId: draft.id, displayName: "Managed traveler", email: null, included: true, needsContact: true, position: 0 });
    const result = await commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version }, f.options);
    createdId = result.eventId;
    const participants = await f.database.db.select().from(memberships).where(eq(memberships.commonsId, createdId));
    const traveler = participants.find(row => row.personId !== f.org); assert.ok(traveler);
    f.extra.push(traveler.personId);
    assert.equal(traveler.accessMode, "managed"); assert.equal(traveler.status, "active");
    await f.database.db.update(eventCreationDrafts).set({ sourceDeleteAfter: new Date(0) }).where(eq(eventCreationDrafts.id, draft.id));
    assert.equal(await expireEventDraftSources(f.url), 1);
    const [expired] = await f.database.db.select().from(eventCreationDrafts).where(eq(eventCreationDrafts.id, draft.id));
    assert.equal(expired.description, null); assert.equal(expired.proposedName, "Test trip");
  } finally {
    if (createdId) await f.database.db.delete(commons).where(eq(commons.id, createdId));
    await f.close();
  }
});


test("duration survives scheduling, moving and unscheduling; clearing is explicit", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const base = { title: "Massage", date: null, time: null, participantScope: "everyone", occurredAt: new Date().toISOString() };
    await addCommonsItineraryItem(f.slug, { ...base, commandId: randomUUID(), durationMinutes: 90 }, f.options);
    const [item] = await f.database.db.select().from(itineraryItems).where(eq(itineraryItems.commonsId, f.event));
    const read = async () => (await f.database.db.select().from(itineraryItems).where(eq(itineraryItems.id, item.id)))[0];
    assert.equal(item.durationMinutes, 90); assert.equal(item.startsAt, null); assert.equal(item.endsAt, null);
    for (const date of ["2027-03-14", "2027-03-15"]) {
      await updateCommonsItineraryItem(f.slug, item.id, { ...base, commandId: randomUUID(), date, time: "23:30" }, f.options);
      const saved = await read();
      assert.equal(saved.durationMinutes, 90);
      assert.equal(saved.endsAt!.valueOf() - saved.startsAt!.valueOf(), 90 * 60_000);
    }
    await updateCommonsItineraryItem(f.slug, item.id, { ...base, commandId: randomUUID() }, f.options);
    assert.equal((await read()).durationMinutes, 90); assert.equal((await read()).endsAt, null);
    const snapshot = await getCommonsSnapshot(f.slug, f.options);
    assert.ok(snapshot);
    assert.equal(snapshot.state.itinerary.find(entry => entry.id === item.id)?.durationMinutes, 90);
    await updateCommonsItineraryItem(f.slug, item.id, { ...base, commandId: randomUUID(), date: "2027-03-15", time: "12:00", durationMinutes: null }, f.options);
    assert.equal((await read()).durationMinutes, null); assert.equal((await read()).endsAt, null);
  } finally { await f.close(); }
});
