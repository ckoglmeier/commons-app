import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  auditEvents, betaOrganizerInvites, commons, eventCreationAccess, eventCreationDraftPeople, eventCreationDrafts, expenseShares, expenses,
  groupInvitations, identities, invitationDeliveryAttempts, invitations, memberships, people, pollDeliveries, polls, tripActivationPayments, tripActivationRefunds,
} from "./schema";
import { commitEventCreationDraft, createEventCreationDraft, getEventCreationDraft, updateEventCreationDraft } from "./event-creation-repository";
import {
  addCommonsPerson, claimCommonsInvitation, getCommonsInvitationLink, getCommonsInvitationPreview, inviteSavedDraftPeople, leaseInvitationDeliveryAttempt,
  listPendingCommonsInvitationsForIdentity, queueCommonsInvitationDeliveries, revalidateInvitationDeliveryAttempt, rotateCommonsInvitationLink,
} from "./onboarding-repository";
import { getGroupInvitation, getGroupInvitationPreview, joinGroupInvitation, manageGroupInvitation } from "./group-invitation-repository";
import { decideEventCreationAccess, queueOperatorInvitationRetry, requestEventCreationAccess } from "./operator-repository";
import { queueInvitationEntryRecovery } from "./invitation-entry";
import { createCommonsPoll, getPublicPollByToken } from "./poll-repository";
import { leasePollDelivery } from "./poll-delivery-repository";
import { personHasPilotAccess, tripPilotAccess } from "./trip-capability-repository";
import {
  attachTripCheckout, listOperatorTripPayments, readTripActivationStatus, readTripInviteGate, recordTripCheckoutEnded, recordTripPaymentProcessing,
  recordVerifiedTripPayment, recordVerifiedTripRefund, replaceExpiredTripCheckout, reserveTripActivation, resolveActivationRefundHold, retryActivationFeeExpense,
  TripActivationError, TripActivationRequiredError,
} from "./trip-activation-repository";
import { claimBetaOrganizerInvite } from "./beta-organizer-invites";
import { hashNormalizedEmail, hashOpaqueToken, protectOpaqueToken } from "./tokens";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const url = process.env.TEST_DATABASE_URL ?? "";

function guard() {
  assert.equal(new URL(url).hostname, "127.0.0.1");
  assert.ok(new URL(url).pathname.endsWith("_test"));
}

const activationRefused = (error: unknown) => error instanceof TripActivationRequiredError;

async function person(name = "Organizer") {
  const database = createDatabase(url);
  try {
    const id = randomUUID(), authUserId = randomUUID();
    await database.db.insert(people).values({ id, authUserId, displayName: name, doNotCharge: false });
    return { id, authUserId, email: `${id}@example.test` };
  } finally { await database.close(); }
}

async function operator() { return (await person("Operator")).id; }

async function flaggedDraft(owner: string, withPeople: { displayName: string; email: string | null }[] = []) {
  const draft = await createEventCreationDraft({ sourceKind: "description", title: "Synthetic coast trip", timezone: "UTC" }, { databaseUrl: url, actorPersonId: owner, betaActivationRequired: true, entryContext: { source: "template", template: "coast" } });
  if (withPeople.length) {
    const database = createDatabase(url);
    try {
      await database.db.insert(eventCreationDraftPeople).values(withPeople.map((row, position) => ({ id: randomUUID(), draftId: draft.id, displayName: row.displayName, email: row.email, message: null, source: "description", included: true, needsContact: !row.email, position })));
    } finally { await database.close(); }
  }
  return getEventCreationDraft(draft.id, { databaseUrl: url, actorPersonId: owner });
}

async function approve(personId: string, email: string, actor: string, beta = true) {
  await requestEventCreationAccess({ personId, email }, url);
  await decideEventCreationAccess({ personId, status: "approved", actorPersonId: actor, ...(beta ? { grantsPilotCapabilities: false } : {}) }, url);
}

let counter = 0;
const unique = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A session id and intent look like Stripe's test identifiers. All synthetic. */
async function checkout(draftId: string, owner: string) {
  const reserved = await reserveTripActivation(draftId, { databaseUrl: url, actorPersonId: owner });
  const sessionId = unique("cs_test");
  await attachTripCheckout(draftId, reserved.payment.attemptId, { id: sessionId, url: `https://checkout.stripe.com/c/${sessionId}` }, { databaseUrl: url, actorPersonId: owner });
  return { sessionId, attemptId: reserved.payment.attemptId };
}

async function pay(draftId: string, owner: string, tax: number | null = null) {
  const { sessionId } = await checkout(draftId, owner);
  const paymentIntentId = unique("pi");
  await recordVerifiedTripPayment({ sessionId, eventId: unique("evt"), amountCents: 2000, currency: "USD", taxAmountCents: tax, paymentIntentId }, url);
  return { sessionId, paymentIntentId };
}

const commit = (draft: { id: string; version: number }, owner: string, privateOnly?: boolean) =>
  commitEventCreationDraft(draft.id, { commandId: randomUUID(), expectedVersion: draft.version, ...(privateOnly ? { privateOnly: true } : {}) }, { databaseUrl: url, actorPersonId: owner });

async function feeExpenses(tripId: string) {
  const database = createDatabase(url);
  try { return await database.db.select().from(expenses).where(and(eq(expenses.commonsId, tripId), eq(expenses.title, "Commons trip fee"))); }
  finally { await database.close(); }
}

test("a private organizer-only trip commits free, without approval, payment, or Coordinator", { skip }, async () => {
  guard();
  const owner = await person(), other = await person("Stranger");
  const draft = await flaggedDraft(owner.id);
  assert.equal(draft.betaActivationRequired, true);
  await assert.rejects(getEventCreationDraft(draft.id, { databaseUrl: url, actorPersonId: other.id }), /no longer available/, "drafts stay private between accounts");
  const trip = await commit(draft, owner.id);
  const database = createDatabase(url);
  try {
    const [row] = await database.db.select().from(commons).where(eq(commons.id, trip.eventId));
    assert.equal(row.activationDraftId, draft.id);
    assert.equal((await database.db.select().from(invitations).where(eq(invitations.commonsId, trip.eventId))).length, 0);
    assert.equal((await database.db.select().from(tripActivationPayments).where(eq(tripActivationPayments.draftId, draft.id))).length, 0);
  } finally { await database.close(); }
  assert.equal((await feeExpenses(trip.eventId)).length, 0);
  assert.equal(await readTripActivationStatus({ tripId: trip.eventId }, { databaseUrl: url, actorPersonId: other.id }), null, "another account learns nothing");
  const status = await readTripActivationStatus({ tripId: trip.eventId }, { databaseUrl: url, actorPersonId: owner.id });
  assert.equal(status?.state, "payment_required", "there's no approval step");
});

test("a client cannot change the activation flag or entry context through a draft update", { skip }, async () => {
  guard();
  const owner = await person();
  const draft = await flaggedDraft(owner.id);
  const updated = await updateEventCreationDraft(draft.id, {
    expectedVersion: draft.version, proposedName: "Renamed", startsOn: null, endsOn: null, locationName: null,
    brief: { ...draft.brief, betaActivationRequired: false }, betaActivationRequired: false, entryContext: { source: "homepage" },
  }, { databaseUrl: url, actorPersonId: owner.id });
  assert.equal(updated.betaActivationRequired, true);
  assert.deepEqual(updated.entryContext, { source: "template", template: "coast" });
});

test("prior-trip drafts carry the flag", { skip }, async () => {
  guard();
  const owner = await person();
  const first = await commit(await flaggedDraft(owner.id), owner.id);
  const again = await createEventCreationDraft({ sourceKind: "prior_event", sourceEventId: first.eventId, timezone: "UTC" }, { databaseUrl: url, actorPersonId: owner.id, betaActivationRequired: true });
  assert.equal(again.betaActivationRequired, true);
});

test("someone carried from a prior trip is still invited after a private commit and payment", { skip }, async () => {
  guard();
  const owner = await person(), carried = await person("Carried Traveler");
  const email = `carried-${randomUUID().slice(0, 8)}@example.invalid`;
  const draft = await flaggedDraft(owner.id);
  const database = createDatabase(url);
  try {
    await database.db.insert(eventCreationDraftPeople).values({ id: randomUUID(), draftId: draft.id, personId: carried.id, displayName: "Carried Traveler", email, message: null, source: "prior_event", included: true, needsContact: false, position: 0 } as never);
    const fresh = await getEventCreationDraft(draft.id, { databaseUrl: url, actorPersonId: owner.id });
    const trip = await commit(fresh, owner.id, true);
    const before = await readTripActivationStatus({ tripId: trip.eventId }, { databaseUrl: url, actorPersonId: owner.id });
    assert.deepEqual(before?.savedPeople, [{ name: "Carried Traveler", hasEmail: true }], "they are listed as still to invite");
    await database.db.update(commons).set({ activationDraftId: null }).where(eq(commons.id, trip.eventId));
    await inviteSavedDraftPeople(draft.id, { databaseUrl: url, actorPersonId: owner.id });
    await inviteSavedDraftPeople(draft.id, { databaseUrl: url, actorPersonId: owner.id });
    const rows = await database.db.select().from(invitations).where(eq(invitations.commonsId, trip.eventId));
    assert.equal(rows.length, 1, "invited once, however many retries");
  } finally { await database.close(); }
});

test("people on an unpaid draft are refused at commit, and privateOnly leaves them out and uncontacted", { skip }, async () => {
  guard();
  const owner = await person();
  const draft = await flaggedDraft(owner.id, [{ displayName: "Sam", email: "sam@example.test" }, { displayName: "Jo", email: null }]);
  await assert.rejects(commit(draft, owner.id), /come before inviting/);
  const trip = await commit(draft, owner.id, true);
  const database = createDatabase(url);
  try {
    assert.equal((await database.db.select().from(invitations).where(eq(invitations.commonsId, trip.eventId))).length, 0);
    assert.equal((await database.db.select().from(memberships).where(eq(memberships.commonsId, trip.eventId))).length, 1);
  } finally { await database.close(); }
  const status = await readTripActivationStatus({ tripId: trip.eventId }, { databaseUrl: url, actorPersonId: owner.id });
  assert.deepEqual(status?.savedPeople, [{ name: "Sam", hasEmail: true }, { name: "Jo", hasEmail: false }]);
  await assert.rejects(inviteSavedDraftPeople(draft.id, { databaseUrl: url, actorPersonId: owner.id }), activationRefused);
});

test("every invitation path refuses while the trip is unpaid", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator();
  const trip = await commit(await flaggedDraft(owner.id), owner.id);
  const id = trip.eventId, options = { databaseUrl: url, actorPersonId: owner.id };
  await approve(owner.id, owner.email, op); // Approved but unpaid is still closed.
  const addInput = { displayName: "Guest", email: "guest@example.test", role: "member", accessMode: "account" };
  await assert.rejects(addCommonsPerson(id, addInput, options), activationRefused, "add traveler");
  await assert.rejects(queueCommonsInvitationDeliveries(id, null, options), activationRefused, "queue");
  await assert.rejects(manageGroupInvitation(id, { commandId: randomUUID(), expectedVersion: 0, action: "create", scopeAccepted: true, expiresInDays: 14 }, options), activationRefused, "group link");
  const pollBase = { title: "Which week?", intro: null, ballotMode: "transparent", questions: [{ id: randomUUID(), kind: "text", prompt: "Which week works?" }] };
  assert.ok(await createCommonsPoll(id, { ...pollBase, commandId: randomUUID() }, options), "a link poll is free on an unpaid trip");
  await assert.rejects(createCommonsPoll(id, { ...pollBase, commandId: randomUUID(), audience: { personIds: [], guestEmails: ["g@example.test"] } }, options), activationRefused, "guest-email poll");

  // Rows planted directly, as if an older path had produced them: they still can't reach anyone.
  const database = createDatabase(url), token = `tok${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
  try {
    const guest = await person("Planted");
    await database.db.insert(memberships).values({ commonsId: id, personId: guest.id, role: "member", status: "invited" });
    const [invite] = await database.db.insert(invitations).values({ commonsId: id, provisionalPersonId: guest.id, createdByPersonId: owner.id, recipientName: "Planted", recipientEmail: guest.email, tokenHash: hashOpaqueToken(token), tokenValue: protectOpaqueToken(token), tokenVersion: 1, status: "pending", deliveryState: "not_sent" }).returning();
    await assert.rejects(queueOperatorInvitationRetry({ invitationId: invite.id, actorPersonId: op }, url), activationRefused, "operator retry");
    await assert.rejects(queueInvitationEntryRecovery(token, null, url), activationRefused, "entry recovery");
    await assert.rejects(rotateCommonsInvitationLink(id, invite.id, options), activationRefused, "rotate link");
    await assert.rejects(getCommonsInvitationLink(id, invite.id, options), activationRefused, "reveal link");
    assert.equal(await getCommonsInvitationPreview(token, url), null, "preview");
    await assert.rejects(claimCommonsInvitation(token, { authUserId: guest.authUserId, email: guest.email, displayName: "Planted" }, url), /no longer active/, "claim");
    const pending = await listPendingCommonsInvitationsForIdentity({ authUserId: guest.authUserId, email: guest.email }, url);
    assert.equal(pending.length, 0, "account pending list");

    const [attempt] = await database.db.insert(invitationDeliveryAttempts).values({ commonsId: id, invitationId: invite.id, tokenVersion: 1, status: "queued" }).returning();
    assert.equal(await leaseInvitationDeliveryAttempt(attempt.id, url), null, "lease");
    const [cancelled] = await database.db.select().from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.id, attempt.id));
    assert.equal(cancelled.status, "cancelled");
    const [state] = await database.db.select().from(invitations).where(eq(invitations.id, invite.id));
    assert.equal(state.deliveryState, "failed", "queued is not left claiming to be on its way");
    assert.equal(state.deliveryErrorCode, "activation_required");

    const shareToken = `share${randomUUID().replaceAll("-", "")}`;
    const [poll] = await database.db.insert(polls).values({ commonsId: id, createdByPersonId: owner.id, commandId: randomUUID(), title: "Planted link poll", intro: null, ballotMode: "transparent", questions: [], audience: null, shareTokenHash: hashOpaqueToken(shareToken), shareTokenValue: protectOpaqueToken(shareToken) }).returning();
    assert.ok(await getPublicPollByToken(shareToken, url), "anyone with the link can answer on an unpaid trip");
    await database.db.insert(pollDeliveries).values({ pollId: poll.id, recipientEmail: "x@example.test", personId: null });
    const leased = await leasePollDelivery(url, poll.id);
    assert.equal(leased?.skipped, true, "poll delivery lease cancels");

    const groupToken = `g_${randomUUID().replaceAll("-", "").slice(0, 32)}`;
    await database.db.insert(groupInvitations).values({ id: randomUUID(), commonsId: id, createdByPersonId: owner.id, tokenHash: hashOpaqueToken(groupToken), protectedToken: protectOpaqueToken(groupToken), version: 1, expiresAt: new Date(Date.now() + 86_400_000) });
    assert.equal(await getGroupInvitationPreview(groupToken, url), null, "group preview");
    assert.equal((await getGroupInvitation(id, options))?.token, null, "group token not revealed");
  } finally { await database.close(); }
});

test("an existing trip is exempt forever and keeps inviting without any activation record", { skip }, async () => {
  guard();
  const owner = await person();
  const legacy = await createEventCreationDraft({ sourceKind: "description", title: "Legacy trip", timezone: "UTC" }, { databaseUrl: url, actorPersonId: owner.id });
  assert.equal(legacy.betaActivationRequired, false);
  const trip = await commit(legacy, owner.id);
  const database = createDatabase(url);
  try {
    assert.equal((await readTripInviteGate(database.db, trip.eventId)).state, "exempt");
    const [row] = await database.db.select({ draft: commons.activationDraftId }).from(commons).where(eq(commons.id, trip.eventId));
    assert.equal(row.draft, null);
  } finally { await database.close(); }
  const added = await addCommonsPerson(trip.eventId, { displayName: "Guest", email: `${randomUUID()}@example.test`, role: "member", accessMode: "account" }, { databaseUrl: url, actorPersonId: owner.id });
  assert.ok(added.invitationId);
  // A draft with people commits exactly as on main when the flag was off.
  const withPeople = await createEventCreationDraft({ sourceKind: "description", title: "Legacy with people", timezone: "UTC" }, { databaseUrl: url, actorPersonId: owner.id });
  const database2 = createDatabase(url);
  try { await database2.db.insert(eventCreationDraftPeople).values({ id: randomUUID(), draftId: withPeople.id, displayName: "Kit", email: `${randomUUID()}@example.test`, message: null, source: "description", included: true, needsContact: false, position: 0 }); }
  finally { await database2.close(); }
  const committed = await commit(await getEventCreationDraft(withPeople.id, { databaseUrl: url, actorPersonId: owner.id }), owner.id);
  assert.equal(committed.unsentInvitationCount, 1);
  assert.equal((await feeExpenses(committed.eventId)).length, 0);
});

test("a beta approval grants no pilot capability, and existing pilot grants are untouched", { skip }, async () => {
  guard();
  const op = await operator(), beta = await person("Beta"), pilot = await person("Pilot");
  const old = await commit(await createEventCreationDraft({ sourceKind: "description", title: "Older trip", timezone: "UTC" }, { databaseUrl: url, actorPersonId: beta.id }), beta.id);
  await approve(beta.id, beta.email, op);
  assert.equal(await personHasPilotAccess(beta.id, [], url), false);
  assert.equal((await tripPilotAccess(old.eventId, [], url))?.pilot, false, "older trips do not gain Coordinator");
  await approve(pilot.id, pilot.email, op, false);
  assert.equal(await personHasPilotAccess(pilot.id, [], url), true);
  await decideEventCreationAccess({ personId: pilot.id, status: "approved", actorPersonId: op, grantsPilotCapabilities: false }, url);
  assert.equal(await personHasPilotAccess(pilot.id, [], url), true, "re-approving does not downgrade an explicit pilot");
  // A pilot organizer's new trip under activation is still Trip · Plan · Money.
  const flagged = await commit(await flaggedDraft(pilot.id), pilot.id);
  assert.equal((await tripPilotAccess(flagged.eventId, [], url))?.pilot, false);
});

test("approval then payment before commit: one trip, one fee, intended invitations, exact cents, no debt", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator();
  const draft = await flaggedDraft(owner.id, [{ displayName: "Sam", email: `${randomUUID()}@example.test` }]);
  await approve(owner.id, owner.email, op);
  await assert.rejects(commit(draft, owner.id), /come before inviting/, "approved but unpaid");
  await pay(draft.id, owner.id, 137);
  const [first, second] = await Promise.all([commit(draft, owner.id), commit(draft, owner.id)]);
  assert.equal(first.eventId, second.eventId, "concurrent commits make one trip");
  const again = await commit(draft, owner.id);
  assert.equal(again.eventId, first.eventId, "retry replays");
  const fees = await feeExpenses(first.eventId);
  assert.equal(fees.length, 1);
  assert.equal(fees[0].amountCents, 2000);
  assert.equal(fees[0].currency, "USD");
  assert.equal(fees[0].paidByPersonId, owner.id);
  assert.equal(fees[0].balanceMode, "tracking_only");
  assert.equal(fees[0].sourceLabel, "Recorded from the Commons trip fee payment");
  const database = createDatabase(url);
  try {
    const shares = await database.db.select().from(expenseShares).where(eq(expenseShares.expenseId, fees[0].id));
    assert.deepEqual(shares.map(row => row.amountCents), [0], "no traveler debt until the organizer allocates");
    const invites = await database.db.select().from(invitations).where(eq(invitations.commonsId, first.eventId));
    assert.equal(invites.length, 1);
    assert.equal(invites[0].deliveryState, "not_sent", "commit itself contacts nobody");
    const status = await readTripActivationStatus({ tripId: first.eventId }, { databaseUrl: url, actorPersonId: owner.id });
    assert.deepEqual(status?.savedPeople, [], "people invited at commit aren't offered as saved again");
    assert.deepEqual(status?.unsentInvitees, ["Sam"], "not yet sent stays visible");
    const [payment] = await database.db.select().from(tripActivationPayments).where(eq(tripActivationPayments.draftId, draft.id));
    assert.equal(payment.taxAmountCents, 137);
  } finally { await database.close(); }
  const queued = await queueCommonsInvitationDeliveries(first.eventId, null, { databaseUrl: url, actorPersonId: owner.id });
  assert.equal(queued.length, 1, "a paid trip can queue");
  assert.equal(await revalidateInvitationDeliveryAttempt(queued[0].deliveryAttemptId, 0, url), false, "unleased attempt is not deliverable");
  // Later invitations do not charge again.
  await addCommonsPerson(first.eventId, { displayName: "Another", email: `${randomUUID()}@example.test`, role: "member", accessMode: "account" }, { databaseUrl: url, actorPersonId: owner.id });
  assert.equal((await feeExpenses(first.eventId)).length, 1);
});

test("payment after commit records the fee from the webhook exactly once, and duplicates and replays add nothing", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator();
  const draft = await flaggedDraft(owner.id, [{ displayName: "Sam", email: `${randomUUID()}@example.test` }]);
  const trip = await commit(draft, owner.id, true);
  await approve(owner.id, owner.email, op);
  const { sessionId } = await checkout(draft.id, owner.id);
  const evidence = { sessionId, eventId: unique("evt"), amountCents: 2000, currency: "USD", taxAmountCents: null, paymentIntentId: unique("pi") };
  await recordTripPaymentProcessing(sessionId, url);
  let status = await readTripActivationStatus({ tripId: trip.eventId }, { databaseUrl: url, actorPersonId: owner.id });
  assert.equal(status?.state, "payment_processing", "pending confirmation is not paid");
  assert.equal(status?.mayInvite, false);
  await Promise.all([recordVerifiedTripPayment(evidence, url), recordVerifiedTripPayment(evidence, url)]);
  await recordVerifiedTripPayment({ ...evidence, eventId: unique("evt") }, url);
  await recordTripPaymentProcessing(sessionId, url);
  await recordTripCheckoutEnded(sessionId, "expired", url);
  status = await readTripActivationStatus({ tripId: trip.eventId }, { databaseUrl: url, actorPersonId: owner.id });
  assert.equal(status?.state, "allowed", "a late, out-of-order event never unpays");
  const fees = await feeExpenses(trip.eventId);
  assert.equal(fees.length, 1);
  assert.equal(fees[0].amountCents, 2000);
  assert.equal(fees[0].paidByPersonId, owner.id);

  // Saved people are invited once, however many times it is retried.
  await inviteSavedDraftPeople(draft.id, { databaseUrl: url, actorPersonId: owner.id });
  await inviteSavedDraftPeople(draft.id, { databaseUrl: url, actorPersonId: owner.id });
  const database = createDatabase(url);
  try {
    assert.equal((await database.db.select().from(invitations).where(eq(invitations.commonsId, trip.eventId))).length, 1);
    // An organizer who deletes the expense isn't overruled by a replay.
    await database.db.delete(expenses).where(eq(expenses.id, fees[0].id));
    await recordVerifiedTripPayment({ ...evidence, eventId: unique("evt") }, url);
    assert.equal((await feeExpenses(trip.eventId)).length, 0);
  } finally { await database.close(); }
});

test("wrong amount, wrong receipt and unknown sessions are refused and record nothing", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator();
  const draft = await flaggedDraft(owner.id);
  await approve(owner.id, owner.email, op);
  const { sessionId } = await checkout(draft.id, owner.id);
  const good = { sessionId, eventId: unique("evt"), amountCents: 2000, currency: "USD", taxAmountCents: null, paymentIntentId: unique("pi") };
  await assert.rejects(recordVerifiedTripPayment({ ...good, amountCents: 1999 }, url), TripActivationError);
  await assert.rejects(recordVerifiedTripPayment({ ...good, currency: "EUR" }, url), TripActivationError);
  await assert.rejects(recordVerifiedTripPayment({ ...good, taxAmountCents: 2001 }, url), TripActivationError);
  await assert.rejects(recordVerifiedTripPayment({ ...good, sessionId: unique("cs_test") }, url), /Unknown checkout session/);
  assert.equal((await readTripActivationStatus({ draftId: draft.id }, { databaseUrl: url, actorPersonId: owner.id }))?.state, "payment_required");
  await recordVerifiedTripPayment(good, url);
  await assert.rejects(recordVerifiedTripPayment({ ...good, paymentIntentId: unique("pi") }, url), /receipt changed/);
});

test("concurrent checkout shares one attempt, and an expired session is replaced without losing the newer one", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator(), options = { databaseUrl: url, actorPersonId: owner.id };
  const draft = await flaggedDraft(owner.id);
  await approve(owner.id, owner.email, op);
  const [a, b] = await Promise.all([reserveTripActivation(draft.id, options), reserveTripActivation(draft.id, options)]);
  assert.equal(a.payment.attemptId, b.payment.attemptId, "same provider idempotency key");
  const oldSession = unique("cs_test");
  await attachTripCheckout(draft.id, a.payment.attemptId, { id: oldSession, url: `https://checkout.stripe.com/c/${oldSession}` }, options);
  const replaced = await replaceExpiredTripCheckout(draft.id, oldSession, options);
  assert.notEqual(replaced.attemptId, a.payment.attemptId);
  assert.equal(replaced.sessionId, null);
  assert.equal(replaced.failureCode, "expired");
  const newSession = unique("cs_test");
  await attachTripCheckout(draft.id, replaced.attemptId, { id: newSession, url: `https://checkout.stripe.com/c/${newSession}` }, options);
  await recordTripCheckoutEnded(oldSession, "expired", url); // Delayed event about the old session.
  const reread = await reserveTripActivation(draft.id, options);
  assert.equal(reread.payment.sessionId, newSession, "a late event about an old session changes nothing");
  await assert.rejects(recordVerifiedTripPayment({ sessionId: oldSession, eventId: unique("evt"), amountCents: 2000, currency: "USD", taxAmountCents: null, paymentIntentId: unique("pi") }, url), /Unknown checkout session/);
  await recordTripCheckoutEnded(newSession, "async_failed", url);
  const failed = await readTripActivationStatus({ draftId: draft.id }, options);
  assert.equal(failed?.failureCode, "async_failed");
  assert.equal(failed?.state, "payment_required");
});

test("a refund before anyone is invited holds inviting until a person resolves it", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator(), options = { databaseUrl: url, actorPersonId: owner.id };
  const draft = await flaggedDraft(owner.id, [{ displayName: "Sam", email: `${randomUUID()}@example.test` }]);
  await approve(owner.id, owner.email, op);
  const { paymentIntentId } = await pay(draft.id, owner.id);
  const refund = { refundId: unique("re"), eventId: unique("evt"), paymentIntentId, amountCents: 500, status: "succeeded" as const, eventCreatedAt: new Date() };
  await recordVerifiedTripRefund(refund, url);
  await recordVerifiedTripRefund({ ...refund, eventId: unique("evt") }, url);
  await assert.rejects(commit(draft, owner.id), /come before inviting/, "people can't commit past a hold");
  const trip = await commit(draft, owner.id, true);
  const database = createDatabase(url);
  try { assert.equal((await readTripInviteGate(database.db, trip.eventId)).state, "refund_hold"); }
  finally { await database.close(); }
  await assert.rejects(addCommonsPerson(trip.eventId, { displayName: "G", email: `${randomUUID()}@example.test`, role: "member", accessMode: "account" }, options), activationRefused);
  await assert.rejects(reserveTripActivation(draft.id, options).then(row => { if (row.refundHold) throw new TripActivationRequiredError("refund_hold"); }), activationRefused, "no second payment around the hold");
  const payments = await listOperatorTripPayments(url);
  const row = payments.rows.find(item => item.draftId === draft.id)!;
  assert.equal(row.refundedCents, 500);
  assert.equal(row.refundHoldOpen, true);
  assert.equal(row.taxAmountCents, null, "unknown tax stays unknown, never zero");
  await resolveActivationRefundHold({ draftId: draft.id, actorPersonId: op, reason: "Goodwill partial refund, organizer confirmed." }, url);
  const database2 = createDatabase(url);
  try { assert.equal((await readTripInviteGate(database2.db, trip.eventId)).state, "allowed"); }
  finally { await database2.close(); }
});

test("a refund after people were invited keeps access, flags reconciliation and rewrites nothing, partial or full", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator(), options = { databaseUrl: url, actorPersonId: owner.id };
  const draft = await flaggedDraft(owner.id, [{ displayName: "Sam", email: `${randomUUID()}@example.test` }]);
  await approve(owner.id, owner.email, op);
  const { paymentIntentId } = await pay(draft.id, owner.id);
  const trip = await commit(draft, owner.id);
  const database = createDatabase(url);
  try {
    await database.db.update(invitations).set({ sentAt: new Date(), deliveryState: "sent" }).where(eq(invitations.commonsId, trip.eventId));
    const [before] = await feeExpenses(trip.eventId);
    const beforeMembers = await database.db.select().from(memberships).where(eq(memberships.commonsId, trip.eventId));
    const first = { refundId: unique("re"), eventId: unique("evt"), paymentIntentId, amountCents: 500, status: "succeeded" as const, eventCreatedAt: new Date(Date.now() - 1000) };
    await recordVerifiedTripRefund(first, url);
    const full = { refundId: unique("re"), eventId: unique("evt"), paymentIntentId, amountCents: 1500, status: "pending" as const, eventCreatedAt: new Date() };
    await recordVerifiedTripRefund(full, url);
    await recordVerifiedTripRefund({ ...full, eventId: unique("evt"), status: "succeeded", eventCreatedAt: new Date(Date.now() + 1000) }, url);
    await recordVerifiedTripRefund({ ...full, eventId: unique("evt"), status: "pending", eventCreatedAt: new Date(Date.now() - 5000) }, url); // Late and out of order.
    const [saved] = await database.db.select().from(tripActivationRefunds).where(eq(tripActivationRefunds.refundId, full.refundId));
    assert.equal(saved.status, "succeeded", "an older event never overwrites a newer status");
    await assert.rejects(recordVerifiedTripRefund({ refundId: unique("re"), eventId: unique("evt"), paymentIntentId, amountCents: 1, status: "succeeded", eventCreatedAt: new Date() }, url), /exceeds/);
    const [after] = await feeExpenses(trip.eventId);
    assert.deepEqual({ a: after.amountCents, s: after.status, m: after.balanceMode, l: after.sourceLabel }, { a: before.amountCents, s: before.status, m: before.balanceMode, l: before.sourceLabel }, "the expense is not rewritten");
    assert.equal((await database.db.select().from(memberships).where(eq(memberships.commonsId, trip.eventId))).length, beforeMembers.length);
    const status = await readTripActivationStatus({ tripId: trip.eventId }, options);
    assert.equal(status?.state, "allowed");
    assert.equal(status?.reconciliationNeeded, true);
    assert.equal(status?.refundedCents, 2000);
    const audit = await database.db.select().from(auditEvents).where(and(eq(auditEvents.commonsId, trip.eventId), eq(auditEvents.action, "expense.refund_review_required")));
    assert.equal(audit.length, 2);
    // A refund that later fails stops counting.
    await recordVerifiedTripRefund({ ...first, eventId: unique("evt"), status: "failed", eventCreatedAt: new Date(Date.now() + 2000) }, url);
    assert.equal((await readTripActivationStatus({ tripId: trip.eventId }, options))?.refundedCents, 1500);
  } finally { await database.close(); }
  const other = await flaggedDraft(owner.id);
  await checkout(other.id, owner.id); // An unconfirmed checkout: this refund may be ahead of its payment.
  await assert.rejects(recordVerifiedTripRefund({ refundId: unique("re"), eventId: unique("evt"), paymentIntentId: unique("pi"), amountCents: 100, status: "succeeded", eventCreatedAt: new Date() }, url), (error: unknown) => error instanceof TripActivationError && error.code === "evidence_pending", "a refund ahead of its payment is redelivered, not dropped");
});

test("revoked approval stops new invites and group links, and keeps members and links already out", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator(), options = { databaseUrl: url, actorPersonId: owner.id };
  const guestPerson = await person("Sam");
  const draft = await flaggedDraft(owner.id, [{ displayName: "Sam", email: guestPerson.email }]);
  await approve(owner.id, owner.email, op);
  await pay(draft.id, owner.id);
  const trip = await commit(draft, owner.id);
  const link = await manageGroupInvitation(trip.eventId, { commandId: randomUUID(), expectedVersion: 0, action: "create", scopeAccepted: true, expiresInDays: 14 }, options);
  assert.ok(link?.token);
  const joiner = await person("Joiner");
  await joinGroupInvitation(link.token!, { authUserId: joiner.authUserId, email: joiner.email, displayName: "Joiner" }, { commandId: randomUUID(), tripId: trip.eventId, linkId: link.id, version: link.version }, url);
  const queued = await queueCommonsInvitationDeliveries(trip.eventId, null, options);
  await decideEventCreationAccess({ personId: owner.id, status: "revoked", actorPersonId: op, grantsPilotCapabilities: false }, url);
  await assert.rejects(addCommonsPerson(trip.eventId, { displayName: "New", email: `${randomUUID()}@example.test`, role: "member", accessMode: "account" }, options), (error: unknown) => error instanceof TripActivationRequiredError && error.state === "approval_revoked");
  assert.equal(await getGroupInvitationPreview(link.token!, url), null, "the reusable link stops");
  assert.equal(await leaseInvitationDeliveryAttempt(queued[0].deliveryAttemptId, url), null, "an unsent queued invitation is not sent");
  const database = createDatabase(url);
  try {
    const members = await database.db.select().from(memberships).where(and(eq(memberships.commonsId, trip.eventId), eq(memberships.personId, joiner.id)));
    assert.equal(members[0].status, "active", "existing members stay");
    assert.ok((await readTripInviteGate(database.db, trip.eventId)).mayEnter, "personal links already issued still work");
  } finally { await database.close(); }
  await manageGroupInvitation(trip.eventId, { commandId: randomUUID(), expectedVersion: link.version, action: "revoke" }, options).catch(() => assert.fail("disabling a link is always allowed"));
});

test("a fee that met a closed ledger stays out until a safe retry, which never duplicates", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator();
  const draft = await flaggedDraft(owner.id);
  const trip = await commit(draft, owner.id);
  await approve(owner.id, owner.email, op);
  const database = createDatabase(url);
  try {
    await database.db.update(commons).set({ expensesClosedAt: new Date() }).where(eq(commons.id, trip.eventId));
    await pay(draft.id, owner.id);
    assert.equal((await feeExpenses(trip.eventId)).length, 0, "a closed ledger isn't rewritten");
    assert.equal((await retryActivationFeeExpense({ draftId: draft.id, actorPersonId: op }, url)).reason, "ledger_closed");
    await database.db.update(commons).set({ expensesClosedAt: null }).where(eq(commons.id, trip.eventId));
    assert.equal((await retryActivationFeeExpense({ draftId: draft.id, actorPersonId: op }, url)).recorded, true);
    assert.equal((await retryActivationFeeExpense({ draftId: draft.id, actorPersonId: op }, url)).recorded, false);
    assert.equal((await feeExpenses(trip.eventId)).length, 1);
  } finally { await database.close(); }
});

test("requesting approval saves only the person's own draft as the return point", { skip }, async () => {
  guard();
  const owner = await person(), other = await person("Other");
  const draft = await flaggedDraft(owner.id);
  await assert.rejects(requestEventCreationAccess({ personId: other.id, email: other.email, resumeDraftId: draft.id }, url), /no longer available/);
  const row = await requestEventCreationAccess({ personId: owner.id, email: owner.email, resumeDraftId: draft.id }, url);
  assert.equal(row.resumeDraftId, draft.id);
  assert.equal(row.grantsPilotCapabilities, true, "the column default alone grants nothing: status is still requested");
  const database = createDatabase(url);
  try {
    const [saved] = await database.db.select().from(eventCreationAccess).where(eq(eventCreationAccess.personId, owner.id));
    assert.equal(saved.status, "requested");
    const [stillDraft] = await database.db.select({ status: eventCreationDrafts.status }).from(eventCreationDrafts).where(eq(eventCreationDrafts.id, draft.id));
    assert.equal(stillDraft.status, "reviewing");
  } finally { await database.close(); }
});

test("a claimed beta invite on a pending request grants no pilot access; an existing pilot keeps theirs", { skip }, async () => {
  guard();
  const op = await operator(), asker = await person("Asker");
  await requestEventCreationAccess({ personId: asker.id, email: asker.email }, url);
  const database = createDatabase(url);
  try {
    await database.db.insert(identities).values({ personId: asker.id, kind: "email", normalizedHash: hashNormalizedEmail(asker.email), state: "claimed" });
    await database.db.insert(betaOrganizerInvites).values({ email: asker.email, invitedByPersonId: op, sentAt: new Date() });
  } finally { await database.close(); }
  assert.equal(await claimBetaOrganizerInvite(asker.id, asker.email, url, false), true);
  assert.equal(await personHasPilotAccess(asker.id, [], url), false);
});

test("a refund that becomes active is classified against who has been reached by then", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator();
  const draft = await flaggedDraft(owner.id, [{ displayName: "Sam", email: `${randomUUID()}@example.test` }]);
  await approve(owner.id, owner.email, op);
  const { paymentIntentId } = await pay(draft.id, owner.id);
  const trip = await commit(draft, owner.id);
  const refund = { refundId: unique("re"), eventId: unique("evt"), paymentIntentId, amountCents: 500, status: "failed" as "failed" | "succeeded", eventCreatedAt: new Date(Date.now() - 1000) };
  await recordVerifiedTripRefund(refund, url);
  const database = createDatabase(url);
  try {
    await database.db.update(invitations).set({ sentAt: new Date(), deliveryState: "sent" }).where(eq(invitations.commonsId, trip.eventId));
    await recordVerifiedTripRefund({ ...refund, eventId: unique("evt"), status: "succeeded", eventCreatedAt: new Date() }, url);
    assert.equal((await readTripInviteGate(database.db, trip.eventId)).mayEnter, true, "people already reached keep access");
  } finally { await database.close(); }
});

test("messaging active members is not an invitation; a non-member gets no status for an exempt trip", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator(), stranger = await person("Stranger"), options = { databaseUrl: url, actorPersonId: owner.id };
  const member = await person("Member");
  const trip = await commit(await flaggedDraft(owner.id), owner.id);
  const database = createDatabase(url);
  try { await database.db.insert(memberships).values({ commonsId: trip.eventId, personId: member.id, role: "member", status: "active" }); }
  finally { await database.close(); }
  await approve(owner.id, owner.email, op);
  const poll = await createCommonsPoll(trip.eventId, { commandId: randomUUID(), title: "Members only", ballotMode: "transparent", audience: { personIds: [member.id], guestEmails: [] }, questions: [{ id: randomUUID(), kind: "text", prompt: "Which week?" }] }, options);
  assert.ok(poll, "an unpaid trip can still ask people already on it");
  const legacy = await commit(await createEventCreationDraft({ sourceKind: "description", title: "Legacy", timezone: "UTC" }, options), owner.id);
  assert.equal(await readTripActivationStatus({ tripId: legacy.eventId }, { databaseUrl: url, actorPersonId: stranger.id }), null);
  assert.equal((await readTripActivationStatus({ tripId: legacy.eventId }, options))?.state, "exempt");
});

test("paying needs no approval; a revoked account can't pay, invite or make a link poll", { skip }, async () => {
  guard();
  const owner = await person(), op = await operator(), options = { databaseUrl: url, actorPersonId: owner.id };
  const trip = await commit(await flaggedDraft(owner.id), owner.id);
  const status = await readTripActivationStatus({ tripId: trip.eventId }, options);
  assert.equal(status?.state, "payment_required");
  await reserveTripActivation(status!.draftId!, options);
  await decideEventCreationAccess({ personId: owner.id, status: "revoked", actorPersonId: op, requesterEmail: owner.email, grantsPilotCapabilities: false }, url).catch(async () => {
    const database = createDatabase(url);
    try {
      await database.db.insert(identities).values({ personId: owner.id, kind: "email", normalizedHash: hashNormalizedEmail(owner.email), state: "claimed" });
    } finally { await database.close(); }
    await decideEventCreationAccess({ personId: owner.id, status: "revoked", actorPersonId: op, requesterEmail: owner.email, grantsPilotCapabilities: false }, url);
  });
  await assert.rejects(reserveTripActivation(status!.draftId!, options), (error: unknown) => error instanceof TripActivationError && error.code === "approval_required");
  await assert.rejects(createCommonsPoll(trip.eventId, { commandId: randomUUID(), title: "Paused", ballotMode: "transparent", questions: [{ id: randomUUID(), kind: "text", prompt: "Which week?" }] }, options), activationRefused);
});
