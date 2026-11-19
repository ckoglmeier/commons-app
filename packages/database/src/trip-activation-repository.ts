import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { createDatabase } from "./client";
import type { TripActivationStatus, TripInviteState } from "./trip-activation-types";
import type { CommandTransaction } from "./event-command";
import {
  auditEvents, commons, eventCreationAccess, eventCreationDraftPeople, eventCreationDrafts, expenseShares, expenses, invitationDeliveryAttempts, invitations, memberships,
  operatorAuditEvents, people, pollDeliveries, polls, tripActivationPayments, tripActivationRefunds,
} from "./schema";

/*
 * Draft → approval → $20 → first invite (docs/BETA-REWORK.md BR-02).
 *
 * A trip needs activation only when `commons.activation_draft_id` is set, which happens only when a trip is committed
 * from a draft created while COMMONS_BETA_REWORK_ENABLED was on. Everything that exists at cutover stays null and
 * is exempt forever. Every invitation, delivery and token-reveal path calls the gate inside its own transaction.
 *
 * Nothing in this file calls a payment provider. Callers verify signed evidence before recording it.
 */

export const TRIP_FEE_CENTS = 2000;
export type { TripActivationStatus, TripInviteState };


export type TripInviteGate = {
  state: TripInviteState;
  /** Create, send, queue or reveal a new invitation or link. */
  mayInvite: boolean;
  /** Someone already holding a link may preview or claim it. Revocation stops new invites, not ones already out. */
  mayEnter: boolean;
  draftId: string | null;
  organizerId: string | null;
};

const EXEMPT: TripInviteGate = { state: "exempt", mayInvite: true, mayEnter: true, draftId: null, organizerId: null };

const ACTIVATION_MESSAGES: Record<TripInviteState, string> = {
  exempt: "", allowed: "",
  approval_revoked: "Inviting is paused on this account. People already on the trip keep their access.",
  payment_required: "Your trip is private. The $20 trip fee comes before the first invitation.",
  payment_processing: "Payment confirmation is still arriving. Nothing has been sent yet.",
  refund_hold: "A refund was recorded before anyone was invited, so inviting is on hold until Commons reviews it.",
};

/** The refusal every gated path raises. Routes map `code` to a 409 with the state. */
export class TripActivationRequiredError extends Error {
  readonly code = "activation_required";
  constructor(public readonly state: TripInviteState) {
    super(ACTIVATION_MESSAGES[state] || "This trip isn’t ready for invitations.");
    this.name = "TripActivationRequiredError";
  }
}

export class TripActivationError extends Error {
  constructor(
    public readonly code: "draft_not_found" | "approval_required" | "already_invited" | "evidence_rejected" | "evidence_pending" | "not_found",
    message: string,
  ) { super(message); this.name = "TripActivationError"; }
}

type Reader = Pick<CommandTransaction, "select">;

const isActiveRefundStatus = (status: string) => status === "pending" || status === "succeeded";

async function evaluateDraftGate(db: Reader, draftId: string, options: { lock?: boolean } = {}): Promise<TripInviteGate> {
  const [draft] = await db.select({ organizerId: eventCreationDrafts.createdByPersonId }).from(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId));
  // A flagged trip whose draft cannot be read stays closed.
  if (!draft) return { state: "payment_required", mayInvite: false, mayEnter: false, draftId, organizerId: null };
  const accessQuery = db.select({ status: eventCreationAccess.status }).from(eventCreationAccess).where(eq(eventCreationAccess.personId, draft.organizerId));
  const paymentQuery = db.select({ status: tripActivationPayments.status }).from(tripActivationPayments).where(eq(tripActivationPayments.draftId, draftId));
  const [access] = await (options.lock ? accessQuery.for("share") : accessQuery);
  const [payment] = await (options.lock ? paymentQuery.for("share") : paymentQuery);
  const refunds = payment ? await db.select({ status: tripActivationRefunds.status, afterActivation: tripActivationRefunds.afterActivation, resolvedAt: tripActivationRefunds.resolvedAt })
    .from(tripActivationRefunds).where(eq(tripActivationRefunds.draftId, draftId)) : [];
  const base = { draftId, organizerId: draft.organizerId };
  if (refunds.some(refund => isActiveRefundStatus(refund.status) && !refund.afterActivation && !refund.resolvedAt)) {
    return { ...base, state: "refund_hold", mayInvite: false, mayEnter: false };
  }
  // Account fee exemptions never override an operator revocation or unresolved refund.
  const revoked = access?.status === "revoked";
  const [account] = await db.select({ doNotCharge: people.doNotCharge }).from(people).where(eq(people.id, draft.organizerId));
  if (account?.doNotCharge && !revoked) return { ...base, state: "exempt", mayInvite: true, mayEnter: true };
  if (payment?.status === "paid") {
    return revoked ? { ...base, state: "approval_revoked", mayInvite: false, mayEnter: true } : { ...base, state: "allowed", mayInvite: true, mayEnter: true };
  }
  return { ...base, state: revoked ? "approval_revoked" : payment?.status === "processing" ? "payment_processing" : "payment_required", mayInvite: false, mayEnter: false };
}

/** Read the gate for a trip. Pass `lock` inside a transaction so a concurrent refund or revocation serializes with the invite. */
export async function readTripInviteGate(db: Reader, commonsId: string, options: { lock?: boolean } = {}): Promise<TripInviteGate> {
  const [trip] = await db.select({ draftId: commons.activationDraftId }).from(commons).where(eq(commons.id, commonsId));
  if (!trip?.draftId) return EXEMPT;
  return evaluateDraftGate(db, trip.draftId, options);
}

/** The gate for a draft that may not be a trip yet, used by commit. */
export async function readDraftInviteGate(db: Reader, draftId: string, options: { lock?: boolean } = {}) {
  return evaluateDraftGate(db, draftId, options);
}

export async function assertTripMayInvite(tx: Reader, commonsId: string) {
  const gate = await readTripInviteGate(tx, commonsId, { lock: true });
  if (!gate.mayInvite) throw new TripActivationRequiredError(gate.state);
}

export async function assertTripMayEnter(tx: Reader, commonsId: string) {
  const gate = await readTripInviteGate(tx, commonsId, { lock: true });
  if (!gate.mayEnter) throw new TripActivationRequiredError(gate.state);
}

/** Does this audience reach anyone beyond people already active on the trip? Messaging existing members is never an invitation. */
export async function audienceReachesOutsiders(tx: Reader, commonsId: string, audience: { personIds: string[]; guestEmails: string[] } | null | undefined) {
  if (!audience) return true;
  if (audience.guestEmails.length) return true;
  if (!audience.personIds.length) return false;
  const active = await tx.select({ personId: memberships.personId }).from(memberships)
    .where(and(eq(memberships.commonsId, commonsId), inArray(memberships.personId, audience.personIds), eq(memberships.status, "active")));
  return new Set(active.map(row => row.personId)).size !== new Set(audience.personIds).size;
}

/** Has an invitation actually reached someone? Queued is not delivered. */
async function invitationHasReachedSomeone(tx: Reader, commonsId: string) {
  const [invite] = await tx.select({ id: invitations.id }).from(invitations)
    .where(and(eq(invitations.commonsId, commonsId), or(isNotNull(invitations.sentAt), eq(invitations.status, "accepted")))).limit(1);
  if (invite) return true;
  const [joined] = await tx.select({ id: memberships.id }).from(memberships)
    .where(and(eq(memberships.commonsId, commonsId), eq(memberships.status, "active"), eq(memberships.accessMode, "account"), eq(memberships.role, "member"))).limit(1);
  if (joined) return true;
  // A send in flight may already have landed; a poll email reaches someone too. When unsure, keep access rather than cut it.
  const [inFlight] = await tx.select({ id: invitationDeliveryAttempts.id }).from(invitationDeliveryAttempts)
    .where(and(eq(invitationDeliveryAttempts.commonsId, commonsId), inArray(invitationDeliveryAttempts.status, ["processing", "sent"]))).limit(1);
  if (inFlight) return true;
  const [pollSent] = await tx.select({ id: pollDeliveries.id }).from(pollDeliveries).innerJoin(polls, eq(polls.id, pollDeliveries.pollId))
    .where(and(eq(polls.commonsId, commonsId), inArray(pollDeliveries.status, ["processing", "sent"]))).limit(1);
  return Boolean(pollSent);
}

/**
 * The one path that writes the paid fee to Money, from commit (paid first) or from the webhook (paid after commit).
 * Callers hold the draft and payment row locks. Records exact cents, payer and provenance with no traveler debt: the
 * organizer shares it, if they want to, through the existing expense editor. `feeRecordedAt` makes it once-only, so a
 * replay can't resurrect an expense the organizer deleted. A closed ledger is left closed and reported for follow-up.
 */
export async function recordActivationFeeExpense(tx: CommandTransaction, payment: typeof tripActivationPayments.$inferSelect, commonsId: string): Promise<{ recorded: boolean; reason?: "already_recorded" | "not_paid" | "ledger_closed" }> {
  if (payment.feeRecordedAt) return { recorded: false, reason: "already_recorded" };
  if (payment.status !== "paid" || !payment.paidAt) return { recorded: false, reason: "not_paid" };
  const [trip] = await tx.select({ closedAt: commons.expensesClosedAt }).from(commons).where(eq(commons.id, commonsId)).for("no key update");
  if (trip?.closedAt) return { recorded: false, reason: "ledger_closed" };
  const expenseId = randomUUID();
  const now = new Date();
  const inserted = await tx.insert(expenses).values({
    id: expenseId, commonsId,
    title: "Commons trip fee", amountCents: payment.amountCents, currency: payment.currency,
    paidByPersonId: payment.organizerId, createdByPersonId: payment.organizerId,
    occurredOn: payment.paidAt.toISOString().slice(0, 10),
    category: "Other", status: "confirmed", splitMethod: "equal", balanceMode: "tracking_only",
    source: "import", sourceLabel: "Recorded from the Commons trip fee payment",
    externalId: `commons-trip-fee:${payment.draftId}`,
    note: "The fee for this trip, paid by the organizer. Commons doesn’t move money between travelers. To share this cost, edit the expense and allocate it.",
  }).onConflictDoNothing().returning({ id: expenses.id });
  if (inserted.length) {
    await tx.insert(expenseShares).values({ expenseId, personId: payment.organizerId, amountCents: 0 });
    await tx.insert(auditEvents).values({
      commonsId, commandId: `trip-fee:${payment.draftId}`, actorId: payment.organizerId, actorType: "commons", action: "expense.added",
      resourceType: "expense", resourceId: expenseId, summary: "Recorded the paid Commons trip fee without allocating participant balances.",
    });
  }
  await tx.update(tripActivationPayments).set({ feeRecordedAt: now, feeExpenseId: inserted[0]?.id ?? null, updatedAt: now })
    .where(eq(tripActivationPayments.draftId, payment.draftId));
  return { recorded: inserted.length > 0 };
}

type Options = { databaseUrl?: string; actorPersonId: string };

/** Owner and approval are checked before any provider call. The row's attempt id is the provider idempotency key. */
export async function reserveTripActivation(draftId: string, options: Options) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [draft] = await tx.select().from(eventCreationDrafts).where(and(
        eq(eventCreationDrafts.id, draftId), eq(eventCreationDrafts.createdByPersonId, options.actorPersonId),
      )).for("update");
      if (!draft || !draft.betaActivationRequired) throw new TripActivationError("draft_not_found", "That private trip is no longer available.");
      const [access] = await tx.select({ status: eventCreationAccess.status }).from(eventCreationAccess).where(eq(eventCreationAccess.personId, options.actorPersonId));
      if (access?.status === "revoked") throw new TripActivationError("approval_required", "This account can’t pay for a trip right now.");
      const [account] = await tx.select({ doNotCharge: people.doNotCharge }).from(people).where(eq(people.id, options.actorPersonId)).for("share");
      if (account?.doNotCharge) throw new TripActivationError("not_found", "This account does not pay Commons trip fees.");
      await tx.insert(tripActivationPayments).values({ draftId, organizerId: options.actorPersonId }).onConflictDoNothing();
      const [payment] = await tx.select().from(tripActivationPayments).where(eq(tripActivationPayments.draftId, draftId));
      const refunds = await tx.select({ status: tripActivationRefunds.status, resolvedAt: tripActivationRefunds.resolvedAt, afterActivation: tripActivationRefunds.afterActivation })
        .from(tripActivationRefunds).where(eq(tripActivationRefunds.draftId, draftId));
      return { payment, committedEventId: draft.committedEventId, refundHold: refunds.some(row => isActiveRefundStatus(row.status) && !row.afterActivation && !row.resolvedAt) };
    });
  } finally { await database.close(); }
}

export async function attachTripCheckout(draftId: string, attemptId: string, session: { id: string; url: string }, options: Options) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [payment] = await tx.select().from(tripActivationPayments).where(and(
        eq(tripActivationPayments.draftId, draftId), eq(tripActivationPayments.organizerId, options.actorPersonId), eq(tripActivationPayments.attemptId, attemptId),
      )).for("update");
      if (!payment || (payment.sessionId && payment.sessionId !== session.id)) throw new TripActivationError("evidence_rejected", "This checkout attempt changed. Try again.");
      const [saved] = await tx.update(tripActivationPayments).set({ sessionId: session.id, checkoutUrl: session.url, failureCode: null, updatedAt: new Date() })
        .where(eq(tripActivationPayments.draftId, draftId)).returning();
      return saved;
    });
  } finally { await database.close(); }
}

/** Only after the provider confirms this exact session expired unpaid. A new attempt gets a new idempotency key. */
export async function replaceExpiredTripCheckout(draftId: string, sessionId: string, options: Options) {
  const database = createDatabase(options.databaseUrl);
  try {
    const [saved] = await database.db.update(tripActivationPayments).set({ attemptId: randomUUID(), sessionId: null, checkoutUrl: null, status: "pending", failureCode: "expired", updatedAt: new Date() }).where(and(
      eq(tripActivationPayments.draftId, draftId), eq(tripActivationPayments.organizerId, options.actorPersonId),
      eq(tripActivationPayments.sessionId, sessionId), inArray(tripActivationPayments.status, ["pending", "processing"]),
    )).returning();
    if (saved) return saved;
    const [current] = await database.db.select().from(tripActivationPayments).where(and(eq(tripActivationPayments.draftId, draftId), eq(tripActivationPayments.organizerId, options.actorPersonId)));
    if (!current) throw new TripActivationError("draft_not_found", "That private trip is no longer available.");
    return current;
  } finally { await database.close(); }
}

export async function readTripCheckoutBySession(sessionId: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select().from(tripActivationPayments).where(eq(tripActivationPayments.sessionId, sessionId));
    return row ?? null;
  } finally { await database.close(); }
}

/**
 * Lock order matches invite paths: trip, then draft, then payment. Invite paths hold the trip while the gate
 * share-locks the payment, so taking the trip first here means a webhook can't deadlock against an invite attempt.
 */
async function lockActivation(tx: CommandTransaction, draftId: string) {
  const [peek] = await tx.select({ tripId: eventCreationDrafts.committedEventId }).from(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId));
  // NO KEY UPDATE: serializes with invite paths without blocking the foreign-key locks a claim or lease takes.
  if (peek?.tripId) await tx.select({ id: commons.id }).from(commons).where(eq(commons.id, peek.tripId)).for("no key update");
  const [draft] = await tx.select().from(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId)).for("update");
  // Committed since the peek: take the trip before the payment. Invite paths never hold a draft lock, so this can't cycle with them.
  if (draft?.committedEventId && draft.committedEventId !== peek?.tripId) await tx.select({ id: commons.id }).from(commons).where(eq(commons.id, draft.committedEventId)).for("no key update");
  const [payment] = await tx.select().from(tripActivationPayments).where(eq(tripActivationPayments.draftId, draftId)).for("update");
  return { draft, payment };
}

export type VerifiedTripPayment = { sessionId: string; eventId: string; amountCents: number; currency: string; taxAmountCents: number | null; paymentIntentId: string };

/** Caller has verified the provider signature and matched the session to this row. Idempotent and order-independent. */
export async function recordVerifiedTripPayment(evidence: VerifiedTripPayment, databaseUrl?: string) {
  if (evidence.amountCents !== TRIP_FEE_CENTS || evidence.currency !== "USD"
    || (evidence.taxAmountCents !== null && (!Number.isSafeInteger(evidence.taxAmountCents) || evidence.taxAmountCents < 0 || evidence.taxAmountCents > evidence.amountCents))) {
    throw new TripActivationError("evidence_rejected", "Invalid trip fee evidence.");
  }
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [located] = await tx.select({ draftId: tripActivationPayments.draftId }).from(tripActivationPayments).where(eq(tripActivationPayments.sessionId, evidence.sessionId));
      if (!located) throw new TripActivationError("evidence_rejected", "Unknown checkout session.");
      const { draft, payment } = await lockActivation(tx, located.draftId);
      if (!draft || !payment || payment.sessionId !== evidence.sessionId) throw new TripActivationError("evidence_rejected", "This session is no longer the current checkout.");
      let saved = payment;
      if (payment.status === "paid") {
        if (payment.paymentIntentId !== evidence.paymentIntentId) throw new TripActivationError("evidence_rejected", "Payment receipt changed.");
      } else {
        [saved] = await tx.update(tripActivationPayments).set({
          status: "paid", paymentIntentId: evidence.paymentIntentId, taxAmountCents: evidence.taxAmountCents, paidEventId: evidence.eventId,
          paidAt: new Date(), failureCode: null, updatedAt: new Date(),
        }).where(eq(tripActivationPayments.draftId, payment.draftId)).returning();
      }
      const fee = draft.committedEventId ? await recordActivationFeeExpense(tx, saved, draft.committedEventId) : { recorded: false };
      return { payment: saved, fee };
    });
  } finally { await database.close(); }
}

/** The provider says the session completed but funds aren't confirmed. Never a claim of payment. */
export async function recordTripPaymentProcessing(sessionId: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    await database.db.update(tripActivationPayments).set({ status: "processing", failureCode: null, updatedAt: new Date() })
      .where(and(eq(tripActivationPayments.sessionId, sessionId), eq(tripActivationPayments.status, "pending")));
  } finally { await database.close(); }
}

/** Expired or failed sessions release the attempt. A late event about an older session changes nothing, and paid stays paid. */
export async function recordTripCheckoutEnded(sessionId: string, failureCode: "expired" | "async_failed", databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    await database.db.update(tripActivationPayments).set({ attemptId: randomUUID(), sessionId: null, checkoutUrl: null, status: "pending", failureCode, updatedAt: new Date() })
      .where(and(eq(tripActivationPayments.sessionId, sessionId), inArray(tripActivationPayments.status, ["pending", "processing"])));
  } finally { await database.close(); }
}

export type VerifiedTripRefund = { refundId: string; eventId: string; paymentIntentId: string; amountCents: number; status: "pending" | "succeeded" | "failed" | "canceled"; eventCreatedAt: Date };

/**
 * Record provider refund evidence. Before any invitation has reached anyone, it holds inviting for a person to resolve.
 * Afterwards it keeps everyone's access and asks for reconciliation. It never edits the expense, its shares, any
 * reimbursement or a closed ledger: editing an expense doesn't refund a card, and a refund doesn't rewrite a ledger.
 */
export async function recordVerifiedTripRefund(evidence: VerifiedTripRefund, databaseUrl?: string) {
  if (!Number.isSafeInteger(evidence.amountCents) || evidence.amountCents <= 0 || evidence.amountCents > TRIP_FEE_CENTS) {
    throw new TripActivationError("evidence_rejected", "Invalid refund evidence.");
  }
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [located] = await tx.select({ draftId: tripActivationPayments.draftId }).from(tripActivationPayments).where(eq(tripActivationPayments.paymentIntentId, evidence.paymentIntentId));
      if (!located) {
        // The payment event may still be on its way, so redeliver while any checkout is unconfirmed. Otherwise this refund isn't ours.
        const [unconfirmed] = await tx.select({ id: tripActivationPayments.draftId }).from(tripActivationPayments)
          .where(and(inArray(tripActivationPayments.status, ["pending", "processing"]), isNotNull(tripActivationPayments.sessionId))).limit(1);
        if (unconfirmed) throw new TripActivationError("evidence_pending", "The payment for this refund isn’t recorded yet.");
        return null;
      }
      const { draft, payment } = await lockActivation(tx, located.draftId);
      if (!draft || !payment) throw new TripActivationError("evidence_pending", "The payment for this refund isn’t recorded yet.");
      const rows = await tx.select().from(tripActivationRefunds).where(eq(tripActivationRefunds.draftId, payment.draftId));
      const prior = rows.find(row => row.refundId === evidence.refundId);
      if (prior && prior.amountCents !== evidence.amountCents) throw new TripActivationError("evidence_rejected", "Refund evidence changed.");
      const [elsewhere] = await tx.select({ draftId: tripActivationRefunds.draftId }).from(tripActivationRefunds).where(eq(tripActivationRefunds.refundId, evidence.refundId));
      if (elsewhere && elsewhere.draftId !== payment.draftId) throw new TripActivationError("evidence_rejected", "Refund evidence changed.");
      const otherActive = rows.filter(row => row.refundId !== evidence.refundId && isActiveRefundStatus(row.status)).reduce((sum, row) => sum + row.amountCents, 0);
      if (isActiveRefundStatus(evidence.status) && otherActive + evidence.amountCents > payment.amountCents) throw new TripActivationError("evidence_rejected", "Refund total exceeds the payment.");
      const now = new Date();
      if (prior) {
        // Delayed or duplicate: an older event never overwrites a newer status.
        if (evidence.eventCreatedAt < prior.providerEventAt || prior.status === evidence.status) return prior;
        // Becoming active now: classify against what has reached people now, not when it was first seen.
        const reclassified = isActiveRefundStatus(evidence.status) && !isActiveRefundStatus(prior.status) && draft.committedEventId
          ? { afterActivation: await invitationHasReachedSomeone(tx, draft.committedEventId) } : {};
        const [updated] = await tx.update(tripActivationRefunds).set({ status: evidence.status, eventId: evidence.eventId, providerEventAt: evidence.eventCreatedAt, updatedAt: now, ...reclassified })
          .where(eq(tripActivationRefunds.refundId, evidence.refundId)).returning();
        return updated;
      }
      const afterActivation = draft.committedEventId ? await invitationHasReachedSomeone(tx, draft.committedEventId) : false;
      const [saved] = await tx.insert(tripActivationRefunds).values({
        refundId: evidence.refundId, draftId: payment.draftId, status: evidence.status, amountCents: evidence.amountCents,
        eventId: evidence.eventId, providerEventAt: evidence.eventCreatedAt, afterActivation,
      }).returning();
      if (draft.committedEventId) {
        await tx.insert(auditEvents).values({
          commonsId: draft.committedEventId, commandId: `trip-refund:${evidence.refundId}`, actorId: payment.organizerId, actorType: "commons",
          action: "expense.refund_review_required", resourceType: "trip_activation", resourceId: payment.draftId,
          summary: `Commons fee refund recorded: $${(evidence.amountCents / 100).toFixed(2)}. Saved expenses and reimbursements have not changed.`,
        }).onConflictDoNothing();
      }
      return saved;
    });
  } finally { await database.close(); }
}

/** A person decides a pre-activation refund hold after talking to the organizer. Provider-side actions stay in the provider. */
export async function resolveActivationRefundHold(input: { draftId: string; actorPersonId: string; reason: string }, databaseUrl?: string) {
  const reason = input.reason.trim();
  if (!reason) throw new TripActivationError("not_found", "Add a reason before resolving this hold.");
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const { payment } = await lockActivation(tx, input.draftId);
      if (!payment) throw new TripActivationError("not_found", "That payment record is unavailable.");
      const now = new Date();
      const updated = await tx.update(tripActivationRefunds).set({ resolvedAt: now, resolvedByPersonId: input.actorPersonId, updatedAt: now }).where(and(
        eq(tripActivationRefunds.draftId, input.draftId), eq(tripActivationRefunds.afterActivation, false), isNull(tripActivationRefunds.resolvedAt),
      )).returning({ refundId: tripActivationRefunds.refundId });
      if (!updated.length) throw new TripActivationError("not_found", "No refund hold is open on this trip.");
      await tx.insert(operatorAuditEvents).values({ actorPersonId: input.actorPersonId, action: "trip_activation.refund_hold_resolved", resourceType: "trip_activation", resourceId: input.draftId, reason });
      return updated.length;
    });
  } finally { await database.close(); }
}

/** Safe retry for a paid fee that could not be written earlier (the ledger was closed). Never duplicates. */
export async function retryActivationFeeExpense(input: { draftId: string; actorPersonId: string }, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const { draft, payment } = await lockActivation(tx, input.draftId);
      if (!draft || !payment || !draft.committedEventId) throw new TripActivationError("not_found", "That trip has no payment to record yet.");
      const result = await recordActivationFeeExpense(tx, payment, draft.committedEventId);
      await tx.insert(operatorAuditEvents).values({ actorPersonId: input.actorPersonId, action: "trip_activation.fee_expense_retry", resourceType: "trip_activation", resourceId: input.draftId, reason: result.reason ?? (result.recorded ? "recorded" : null) });
      return result;
    });
  } finally { await database.close(); }
}


/** Owner-only summary for the UI. Anyone else gets null, never another person's payment state. */
export async function readTripActivationStatus(target: { draftId: string } | { tripId: string }, options: Options): Promise<TripActivationStatus | null> {
  const database = createDatabase(options.databaseUrl);
  try {
    const db = database.db;
    let draftId: string;
    let tripId: string | null = null;
    if ("tripId" in target) {
      const [trip] = await db.select({ draftId: commons.activationDraftId }).from(commons).where(eq(commons.id, target.tripId));
      if (!trip) return null;
      if (!trip.draftId) {
        const [member] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.commonsId, target.tripId), eq(memberships.personId, options.actorPersonId), eq(memberships.status, "active")));
        if (!member) return null;
      }
      if (!trip.draftId) return { required: false, state: "exempt", mayInvite: true, draftId: null, tripId: target.tripId, feeCents: TRIP_FEE_CENTS, checkoutOpen: false, failureCode: null, refundedCents: 0, reconciliationNeeded: false, going: true, savedPeople: [], unsentInvitees: [] };
      draftId = trip.draftId; tripId = target.tripId;
    } else draftId = target.draftId;
    const [draft] = await db.select({ organizerId: eventCreationDrafts.createdByPersonId, required: eventCreationDrafts.betaActivationRequired, committedEventId: eventCreationDrafts.committedEventId })
      .from(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId));
    if (!draft) return null;
    if (draft.organizerId !== options.actorPersonId) {
      const permittedTripId = tripId ?? draft.committedEventId;
      if (!permittedTripId) return null;
      const [organizer] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.commonsId, permittedTripId), eq(memberships.personId, options.actorPersonId), eq(memberships.role, "organizer"), eq(memberships.status, "active")));
      if (!organizer) return null;
    }
    tripId ??= draft.committedEventId;
    if (!draft.required) return { required: false, state: "exempt", mayInvite: true, draftId, tripId, feeCents: TRIP_FEE_CENTS, checkoutOpen: false, failureCode: null, refundedCents: 0, reconciliationNeeded: false, going: true, savedPeople: [], unsentInvitees: [] };
    const ownsDraft = draft.organizerId === options.actorPersonId;
    const gate = await evaluateDraftGate(db, draftId);
    const [stageRow] = tripId ? await db.select({ goingAt: commons.goingAt }).from(commons).where(eq(commons.id, tripId)) : [];
    const [payment] = await db.select({ sessionId: tripActivationPayments.sessionId, failureCode: tripActivationPayments.failureCode, status: tripActivationPayments.status }).from(tripActivationPayments).where(eq(tripActivationPayments.draftId, draftId));
    const refunds = await db.select({ status: tripActivationRefunds.status, amountCents: tripActivationRefunds.amountCents, afterActivation: tripActivationRefunds.afterActivation }).from(tripActivationRefunds).where(eq(tripActivationRefunds.draftId, draftId));
    const active = refunds.filter(row => isActiveRefundStatus(row.status));
    return { required: gate.state !== "exempt", state: gate.state, mayInvite: gate.mayInvite, draftId: ownsDraft ? draftId : null, tripId, feeCents: gate.state === "exempt" ? 0 : TRIP_FEE_CENTS,
      checkoutOpen: gate.state !== "exempt" && Boolean(payment?.sessionId && payment.status !== "paid"), failureCode: payment?.failureCode ?? null,
      refundedCents: active.reduce((sum, row) => sum + row.amountCents, 0), reconciliationNeeded: active.some(row => row.afterActivation), going: Boolean(stageRow?.goingAt),
      savedPeople: ownsDraft && tripId ? (await draftPeopleStillToInvite(db, draftId, tripId)).map(row => ({ name: row.displayName, hasEmail: Boolean(row.email) })) : [],
      unsentInvitees: ownsDraft && tripId ? (await db.select({ name: invitations.recipientName }).from(invitations)
        .where(and(eq(invitations.commonsId, tripId), eq(invitations.status, "pending"), inArray(invitations.deliveryState, ["not_sent", "failed"])))).map(row => row.name) : [] };
  } finally { await database.close(); }
}

export async function tripIdForActivationDraft(draftId: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [draft] = await database.db.select({ tripId: eventCreationDrafts.committedEventId }).from(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId));
    return draft?.tripId ?? null;
  } finally { await database.close(); }
}

/**
 * The people on a draft who are not yet on its trip. A personId alone can't answer this: someone carried from a prior trip has one before
 * they've been invited here. Having a membership or an invitation on this trip is what counts, so a retry creates nothing new.
 */
export async function draftPeopleStillToInvite(db: Pick<ReturnType<typeof createDatabase>["db"], "select">, draftId: string, tripId: string) {
  const saved = await db.select().from(eventCreationDraftPeople)
    .where(and(eq(eventCreationDraftPeople.draftId, draftId), eq(eventCreationDraftPeople.included, true)))
    .orderBy(eventCreationDraftPeople.position);
  const known = saved.flatMap(person => person.personId ? [person.personId] : []);
  if (!known.length) return saved;
  const [members, invited] = await Promise.all([
    db.select({ personId: memberships.personId }).from(memberships).where(and(eq(memberships.commonsId, tripId), inArray(memberships.personId, known))),
    db.select({ personId: invitations.provisionalPersonId }).from(invitations).where(and(eq(invitations.commonsId, tripId), inArray(invitations.provisionalPersonId, known))),
  ]);
  const onTrip = new Set([...members.map(row => row.personId), ...invited.map(row => row.personId)]);
  return saved.filter(person => !person.personId || !onTrip.has(person.personId));
}

/** Operator metadata only. Call behind the server-side operator boundary. No private brief, people or plan content. */
export async function listOperatorTripPayments(databaseUrl?: string, page = 0) {
  if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new TripActivationError("not_found", "Invalid payment page.");
  const database = createDatabase(databaseUrl);
  try {
    const rows = await database.db.select({
      draftId: tripActivationPayments.draftId, organizerId: tripActivationPayments.organizerId, organizerName: people.displayName,
      tripName: eventCreationDrafts.proposedName, tripId: eventCreationDrafts.committedEventId, status: tripActivationPayments.status,
      failureCode: tripActivationPayments.failureCode, amountCents: tripActivationPayments.amountCents, taxAmountCents: tripActivationPayments.taxAmountCents,
      paymentIntentId: tripActivationPayments.paymentIntentId, paidAt: tripActivationPayments.paidAt, createdAt: tripActivationPayments.createdAt,
      feeRecordedAt: tripActivationPayments.feeRecordedAt, feeExpenseId: tripActivationPayments.feeExpenseId,
      expenseId: expenses.id, expenseStatus: expenses.status, expenseAmountCents: expenses.amountCents, expenseBalanceMode: expenses.balanceMode,
      ledgerClosedAt: commons.expensesClosedAt,
    }).from(tripActivationPayments)
      .innerJoin(eventCreationDrafts, eq(eventCreationDrafts.id, tripActivationPayments.draftId))
      .innerJoin(people, eq(people.id, tripActivationPayments.organizerId))
      .leftJoin(commons, eq(commons.id, eventCreationDrafts.committedEventId))
      .leftJoin(expenses, eq(expenses.id, tripActivationPayments.feeExpenseId))
      .orderBy(desc(tripActivationPayments.createdAt), desc(tripActivationPayments.draftId)).limit(51).offset(page * 50);
    const visible = rows.slice(0, 50);
    const refunds = visible.length ? await database.db.select().from(tripActivationRefunds).where(inArray(tripActivationRefunds.draftId, visible.map(row => row.draftId))) : [];
    return { hasMore: rows.length > 50, rows: visible.map(row => {
      const own = refunds.filter(refund => refund.draftId === row.draftId);
      const active = own.filter(refund => isActiveRefundStatus(refund.status));
      return { ...row,
        refundedCents: active.reduce((sum, refund) => sum + refund.amountCents, 0),
        refundCount: active.length,
        refundPending: active.some(refund => refund.status === "pending"),
        refundHoldOpen: active.some(refund => !refund.afterActivation && !refund.resolvedAt),
        refundHoldResolved: active.some(refund => !refund.afterActivation && Boolean(refund.resolvedAt)),
        reconciliationNeeded: active.some(refund => refund.afterActivation),
      };
    }) };
  } finally { await database.close(); }
}
