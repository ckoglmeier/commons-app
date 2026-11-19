import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { hashNormalizedPhone, hashOpaqueToken, normalizePhone, protectOpaqueToken, revealOpaqueToken } from "./tokens";
import { readTripInviteGate } from "./trip-activation-repository";
import {
  commons, identities, memberships, messagingBookingIntakes, messagingConsents, messagingMessages, messagingMoneyIntakes, messagingPhones, messagingQuestions, messagingWebhookEvents, people, polls,
} from "./schema";

/*
 * Persistence for traveler messaging. Provider-neutral and policy-free: it stores what the web service decides. Nothing here sends a message.
 * Every function is a no-op for callers that never run (the whole feature is behind COMMONS_BETA_REWORK_ENABLED in the web layer).
 */
type Options = { databaseUrl?: string; now?: Date };
type Tx = Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0];
async function run<T>(options: Options, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(fn); } finally { await database.close(); }
}
const clock = (options: Options) => options.now ?? new Date();

/**
 * Texting follows the trip fee: a trip may text when it has paid, or when it needs no fee (older trips and fee-exempt organizers), which is exactly
 * when it may invite. Unpaid, payment still arriving, a refund on hold, or an operator pause: nothing new goes out and no reply acts on the trip.
 * Saved consent stays, so texting resumes by itself once the fee is settled.
 */
async function textingFunded(tx: Tx, commonsId: string) { return (await readTripInviteGate(tx, commonsId)).mayInvite; }
export async function tripTextingFunded(commonsId: string, options: Options = {}) { return run(options, tx => textingFunded(tx, commonsId)); }

export type MessageStatus = "received" | "processed" | "ignored" | "held" | "queued" | "sending" | "sent" | "delivered" | "undelivered" | "failed" | "suppressed" | "cancelled";
export type MessageRow = typeof messagingMessages.$inferSelect;
export type QuestionRow = typeof messagingQuestions.$inferSelect;
export type BookingIntakeRow = typeof messagingBookingIntakes.$inferSelect;

/*
 * A web address is the in-Commons stand-in for a phone number: the same conversation, consent, quiet hours and funding checks, with no phone. It is
 * derived from the person, so it belongs to them by construction and needs no verification. Nothing outside Commons can send to or from it.
 */
const WEB_PREFIX = "web:";
export const webAddressFor = (personId: string) => `${WEB_PREFIX}${personId}`;
export const isWebAddress = (address: string) => address.startsWith(WEB_PREFIX);
const webOwner = (address: string) => isWebAddress(address) ? address.slice(WEB_PREFIX.length) : null;

export const phoneHashOf = (e164: string) => isWebAddress(e164) ? hashOpaqueToken(e164) : hashNormalizedPhone(e164);
export const normalizeE164 = normalizePhone;

/** Who an address belongs to, if it is verified: the person a web address names, or whoever verified the phone number. */
async function addressOwner(tx: Tx, address: string): Promise<string | null> {
  const owner = webOwner(address);
  if (owner) return owner;
  const [identity] = await tx.select({ personId: identities.personId, verifiedAt: identities.verifiedAt, state: identities.state }).from(identities).where(and(eq(identities.kind, "phone"), eq(identities.normalizedHash, phoneHashOf(address))));
  return identity?.verifiedAt && ["channel_verified", "claimed"].includes(identity.state) ? identity.personId : null;
}
/** The same check from a stored hash, for the send-time recheck. A web hash matches only the web address of the person the message is for. */
async function hashOwnedBy(tx: Tx, phoneHash: string, personId: string) {
  if (phoneHash === phoneHashOf(webAddressFor(personId))) return true;
  const [identity] = await tx.select({ personId: identities.personId, verifiedAt: identities.verifiedAt }).from(identities).where(and(eq(identities.kind, "phone"), eq(identities.normalizedHash, phoneHash)));
  return Boolean(identity?.verifiedAt) && identity!.personId === personId;
}

// ---- Numbers, identity and opt-out -------------------------------------------------------------------------------------------------------------------

/** The person who verified this number. Phone identities are unique per number, so a number resolves to at most one person. */
export async function resolveVerifiedPerson(e164: string, options: Options = {}) {
  return run(options, async tx => {
    const owner = await addressOwner(tx, e164);
    if (!owner) return null;
    const [person] = await tx.select({ id: people.id, displayName: people.displayName }).from(people).where(eq(people.id, owner));
    return person ? { personId: person.id, displayName: person.displayName } : null;
  });
}

export async function getPhoneState(e164: string, options: Options = {}) {
  return run(options, async tx => { const [row] = await tx.select().from(messagingPhones).where(eq(messagingPhones.phoneHash, phoneHashOf(e164))); return row ?? null; });
}

export async function touchPhone(e164: string, patch: { inbound?: boolean; handoffSent?: boolean }, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options), hash = phoneHashOf(e164);
    const [row] = await tx.insert(messagingPhones).values({ phoneHash: hash, phoneProtected: protectOpaqueToken(e164), lastInboundAt: patch.inbound ? now : null, handoffSentAt: patch.handoffSent ? now : null, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: messagingPhones.phoneHash, set: { ...(patch.inbound ? { lastInboundAt: now } : {}), ...(patch.handoffSent ? { handoffSentAt: now } : {}), updatedAt: now } }).returning();
    return row!;
  });
}

export async function phoneNumberFor(phoneHash: string, options: Options = {}) {
  return run(options, async tx => { const [row] = await tx.select({ protectedValue: messagingPhones.phoneProtected }).from(messagingPhones).where(eq(messagingPhones.phoneHash, phoneHash)); return row ? revealOpaqueToken(row.protectedValue) : null; });
}

/** STOP: the number is suppressed across every trip and every granted consent on it is revoked (reason "stop"). Web access is untouched. */
export async function optOutPhone(e164: string, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options), hash = phoneHashOf(e164);
    await tx.insert(messagingPhones).values({ phoneHash: hash, phoneProtected: protectOpaqueToken(e164), optedOut: true, optedOutAt: now, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: messagingPhones.phoneHash, set: { optedOut: true, optedOutAt: now, updatedAt: now } });
    await tx.update(messagingConsents).set({ status: "revoked", revokedAt: now, revokedReason: "stop", updatedAt: now }).where(and(eq(messagingConsents.phoneHash, hash), eq(messagingConsents.status, "granted")));
    // Whatever was waiting on an answer, or queued to go out, is dropped: STOP applies to queued welcomes for other trips as well.
    const people_ = await tx.select({ personId: messagingConsents.personId }).from(messagingConsents).where(eq(messagingConsents.phoneHash, hash));
    const personIds = [...new Set(people_.map(row => row.personId))];
    if (personIds.length) await tx.update(messagingQuestions).set({ status: "cancelled", resolvedAt: now, updatedAt: now }).where(and(inArray(messagingQuestions.personId, personIds), eq(messagingQuestions.status, "open")));
    await tx.update(messagingMessages).set({ status: "suppressed", statusDetail: "opted_out", updatedAt: now }).where(and(eq(messagingMessages.phoneHash, hash), eq(messagingMessages.direction, "outbound"), inArray(messagingMessages.status, ["queued", "sending"])));
  });
}

/**
 * START: lifts the suppression and restores only what STOP itself revoked, for memberships that are still active. A trip the person never
 * enrolled in, or joined since, stays off until they choose it. The consent is recorded as a reply where START was sent: a phone or a thread
 * in Commons. Returns the trips restored.
 */
export async function reenrollPhone(e164: string, wording: string, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options), hash = phoneHashOf(e164);
    await tx.update(messagingPhones).set({ optedOut: false, reenrolledAt: now, updatedAt: now }).where(eq(messagingPhones.phoneHash, hash));
    const revoked = await tx.select().from(messagingConsents).where(and(eq(messagingConsents.phoneHash, hash), eq(messagingConsents.status, "revoked"), eq(messagingConsents.revokedReason, "stop")));
    const restored = new Set<string>();
    for (const consent of revoked) {
      const [member] = await tx.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.commonsId, consent.commonsId), eq(memberships.personId, consent.personId)));
      if (member?.status !== "active") continue;
      await tx.update(messagingConsents).set({ status: "granted", wording, method: isWebAddress(e164) ? "web_reply" : "sms_reply", grantedAt: now, revokedAt: null, revokedReason: null, updatedAt: now }).where(eq(messagingConsents.id, consent.id));
      restored.add(consent.commonsId);
    }
    return [...restored];
  });
}

// ---- Consent and enrollment -----------------------------------------------------------------------------------------------------------------------

export class MessagingEnrollmentError extends Error {
  constructor(readonly code: "membership_required" | "number_not_verified" | "invalid_number" | "trip_not_funded", message: string) { super(message); }
}

/**
 * The authenticated person turns on texts for one trip. The number must be exactly the one they verified; verification alone never enrolls, and
 * a number belonging to someone else is refused. Granting also lifts a prior opt-out only when the person is doing it themselves, on the web.
 */
export async function enrollPersonInTrip(input: { personId: string; commonsId: string; e164: string; wording: string }, options: Options = {}) {
  let e164: string;
  if (isWebAddress(input.e164)) e164 = input.e164;
  else try { e164 = normalizePhone(input.e164); } catch { throw new MessagingEnrollmentError("invalid_number", "Enter the mobile number with its country code, like +14155550123."); }
  const web = isWebAddress(e164);
  return run(options, async tx => {
    const now = clock(options), hash = phoneHashOf(e164);
    const [member] = await tx.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.commonsId, input.commonsId), eq(memberships.personId, input.personId)));
    if (member?.status !== "active") throw new MessagingEnrollmentError("membership_required", web ? "Join the trip before turning on messages." : "Join the trip before turning on texts.");
    if (!await textingFunded(tx, input.commonsId)) throw new MessagingEnrollmentError("trip_not_funded", web ? "Messages start once this trip's fee is paid." : "Texting starts once this trip's fee is paid.");
    // Moving a trip to another address (phone to web, or back) replaces the consent below; a person's address must still be their own.
    if (await addressOwner(tx, e164) !== input.personId) throw new MessagingEnrollmentError("number_not_verified", "Verify this mobile number in your account first.");
    await tx.insert(messagingPhones).values({ phoneHash: hash, phoneProtected: protectOpaqueToken(e164), optedOut: false, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: messagingPhones.phoneHash, set: { optedOut: false, reenrolledAt: now, updatedAt: now } });
    for (const scope of ["conversation", "updates"] as const) {
      await tx.insert(messagingConsents).values({ personId: input.personId, commonsId: input.commonsId, phoneHash: hash, scope, status: "granted", wording: input.wording, method: "web_enrollment", grantedAt: now, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [messagingConsents.personId, messagingConsents.commonsId, messagingConsents.scope], set: { phoneHash: hash, status: "granted", wording: input.wording, method: "web_enrollment", grantedAt: now, revokedAt: null, revokedReason: null, updatedAt: now } });
    }
    return { phoneHash: hash };
  });
}

export async function withdrawFromTrip(input: { personId: string; commonsId: string; reason: string }, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options);
    await tx.update(messagingConsents).set({ status: "revoked", revokedAt: now, revokedReason: input.reason.slice(0, 40), updatedAt: now }).where(and(eq(messagingConsents.personId, input.personId), eq(messagingConsents.commonsId, input.commonsId), eq(messagingConsents.status, "granted")));
    await tx.update(messagingQuestions).set({ status: "cancelled", resolvedAt: now, updatedAt: now }).where(and(eq(messagingQuestions.personId, input.personId), eq(messagingQuestions.commonsId, input.commonsId), eq(messagingQuestions.status, "open")));
    await tx.update(messagingMessages).set({ status: "suppressed", statusDetail: "withdrawn", updatedAt: now }).where(and(eq(messagingMessages.personId, input.personId), eq(messagingMessages.commonsId, input.commonsId), eq(messagingMessages.direction, "outbound"), inArray(messagingMessages.status, ["queued", "sending"])));
  });
}

export async function enrollmentStatus(personId: string, commonsId: string, options: Options = {}) {
  return run(options, async tx => {
    const rows = await tx.select().from(messagingConsents).where(and(eq(messagingConsents.personId, personId), eq(messagingConsents.commonsId, commonsId)));
    const conversation = rows.find(row => row.scope === "conversation");
    const [phone] = conversation ? await tx.select().from(messagingPhones).where(eq(messagingPhones.phoneHash, conversation.phoneHash)) : [];
    const onWeb = Boolean(conversation && conversation.phoneHash === phoneHashOf(webAddressFor(personId)));
    return { enrolled: conversation?.status === "granted" && !phone?.optedOut, optedOut: Boolean(phone?.optedOut), grantedAt: conversation?.status === "granted" ? conversation.grantedAt : null, onWeb };
  });
}

export type EnrolledTrip = { id: string; slug: string; name: string; startsOn: string | null; endsOn: string | null; timezone: string; status: string; currency: string; role: "organizer" | "member"; membershipId: string;
  /** False while the trip fee is unpaid or on hold: the consent stands, but nothing is sent and no reply acts on the trip. */
  funded: boolean };

/**
 * The trips a number may act on: an active membership, a granted conversation consent for this exact number, a number that is still the person's
 * verified one, and no opt-out. Anything else is invisible to a reply, however the message is worded.
 */
export async function enrolledTripsForNumber(e164: string, options: Options = {}): Promise<{ personId: string | null; displayName: string | null; optedOut: boolean; trips: EnrolledTrip[] }> {
  return run(options, async tx => {
    const hash = phoneHashOf(e164);
    const [phone] = await tx.select().from(messagingPhones).where(eq(messagingPhones.phoneHash, hash));
    const owner = await addressOwner(tx, e164);
    if (!owner) return { personId: null, displayName: null, optedOut: Boolean(phone?.optedOut), trips: [] };
    const identity = { personId: owner };
    const [person] = await tx.select({ displayName: people.displayName }).from(people).where(eq(people.id, identity.personId));
    if (phone?.optedOut) return { personId: identity.personId, displayName: person?.displayName ?? null, optedOut: true, trips: [] };
    const rows = await tx.select({ id: commons.id, slug: commons.slug, name: commons.name, startsOn: commons.startsOn, endsOn: commons.endsOn, timezone: commons.timezone, status: commons.status, currency: commons.currency, role: memberships.role, membershipId: memberships.id })
      .from(messagingConsents)
      .innerJoin(memberships, and(eq(memberships.commonsId, messagingConsents.commonsId), eq(memberships.personId, messagingConsents.personId)))
      .innerJoin(commons, eq(commons.id, messagingConsents.commonsId))
      .where(and(eq(messagingConsents.personId, identity.personId), eq(messagingConsents.phoneHash, hash), eq(messagingConsents.scope, "conversation"), eq(messagingConsents.status, "granted"), eq(memberships.status, "active"), ne(commons.status, "archived")))
      .orderBy(asc(commons.startsOn), asc(commons.name));
    const trips: EnrolledTrip[] = [];
    for (const row of rows) trips.push({ ...row, funded: await textingFunded(tx, row.id) });
    return { personId: identity.personId, displayName: person?.displayName ?? null, optedOut: false, trips };
  });
}

/** Recheck at the moment of sending: same conditions as above for one person and trip, plus the updates scope for proactive messages. */
export async function sendEligibility(input: { personId: string; commonsId: string | null; phoneHash: string; scope: "conversation" | "updates" }, options: Options = {}) {
  return run(options, async tx => {
    const [phone] = await tx.select().from(messagingPhones).where(eq(messagingPhones.phoneHash, input.phoneHash));
    if (phone?.optedOut) return { ok: false as const, reason: "opted_out" };
    if (!await hashOwnedBy(tx, input.phoneHash, input.personId)) return { ok: false as const, reason: "number_changed" };
    if (!input.commonsId) return { ok: true as const };
    const [member] = await tx.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.commonsId, input.commonsId), eq(memberships.personId, input.personId)));
    if (member?.status !== "active") return { ok: false as const, reason: "membership_ended" };
    const [consent] = await tx.select({ status: messagingConsents.status, phoneHash: messagingConsents.phoneHash }).from(messagingConsents).where(and(eq(messagingConsents.personId, input.personId), eq(messagingConsents.commonsId, input.commonsId), eq(messagingConsents.scope, input.scope)));
    if (consent?.status !== "granted" || consent.phoneHash !== input.phoneHash) return { ok: false as const, reason: "no_consent" };
    if (!await textingFunded(tx, input.commonsId)) return { ok: false as const, reason: "trip_not_funded" };
    return { ok: true as const };
  });
}

// ---- Messages ---------------------------------------------------------------------------------------------------------------------------------------

/** Dedupe a provider delivery. True the first time; a redelivery (same provider event) is reported as a duplicate and does nothing. */
export async function claimWebhookEvent(input: { provider: string; eventKey: string; kind: "inbound" | "status" }, options: Options = {}) {
  return run(options, async tx => {
    const [row] = await tx.insert(messagingWebhookEvents).values({ ...input, receivedAt: clock(options) }).onConflictDoNothing().returning({ id: messagingWebhookEvents.id });
    if (row) return { duplicate: false as const, eventId: row.id };
    // A crash between claiming and recording must not lose an inbound text: the provider's retry finishes it. Recording is itself deduplicated.
    const [existing] = await tx.select({ id: messagingWebhookEvents.id, outcome: messagingWebhookEvents.outcome }).from(messagingWebhookEvents)
      .where(and(eq(messagingWebhookEvents.provider, input.provider), eq(messagingWebhookEvents.eventKey, input.eventKey))).limit(1);
    return input.kind === "inbound" && existing && !existing.outcome ? { duplicate: false as const, eventId: existing.id } : { duplicate: true as const, eventId: null };
  });
}
export async function finishWebhookEvent(eventId: string, outcome: string, messageId: string | null, options: Options = {}) {
  return run(options, async tx => { await tx.update(messagingWebhookEvents).set({ outcome: outcome.slice(0, 60), messageId }).where(eq(messagingWebhookEvents.id, eventId)); });
}

export async function recordInbound(input: { provider: string; providerMessageId: string; e164: string; personId: string | null; body: string; media: Array<{ url: string; contentType: string }> }, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options), hash = phoneHashOf(input.e164);
    const [row] = await tx.insert(messagingMessages).values({ direction: "inbound", provider: input.provider, providerMessageId: input.providerMessageId, phoneHash: hash, personId: input.personId, purpose: "inbound", body: input.body.slice(0, 4000), mediaCount: input.media.length, media: input.media, status: "received", createdAt: now, updatedAt: now })
      .onConflictDoNothing().returning();
    if (row) return { message: row, created: true };
    const [existing] = await tx.select().from(messagingMessages).where(and(eq(messagingMessages.provider, input.provider), eq(messagingMessages.direction, "inbound"), eq(messagingMessages.providerMessageId, input.providerMessageId)));
    return { message: existing!, created: false };
  });
}
export async function markInbound(id: string, status: "processed" | "ignored" | "held", detail: string | null, patch: { personId?: string | null; commonsId?: string | null } = {}, options: Options = {}) {
  return run(options, async tx => { await tx.update(messagingMessages).set({ status, statusDetail: detail?.slice(0, 80) ?? null, ...(patch.personId !== undefined ? { personId: patch.personId } : {}), ...(patch.commonsId !== undefined ? { commonsId: patch.commonsId } : {}), updatedAt: clock(options) }).where(eq(messagingMessages.id, id)); });
}
export async function getMessage(id: string, options: Options = {}) { return run(options, async tx => (await tx.select().from(messagingMessages).where(eq(messagingMessages.id, id)))[0] ?? null); }

/** Inbound messages that were stored but never finished (a crash between receipt and processing). Reprocessing is idempotent. */
export async function unprocessedInbound(olderThanMs: number, options: Options = {}) {
  return run(options, async tx => tx.select({ id: messagingMessages.id }).from(messagingMessages).where(and(eq(messagingMessages.direction, "inbound"), eq(messagingMessages.status, "received"), lte(messagingMessages.createdAt, new Date(clock(options).getTime() - olderThanMs)))).limit(50));
}

export type EnqueueInput = { provider: string; idempotencyKey: string; e164: string; personId: string | null; commonsId: string | null; purpose: string; body: string; questionId?: string | null; segments: number; notBefore?: Date; proactive?: boolean };
/** One row per stable key: queueing the same welcome or reminder twice returns the first. */
export async function enqueueOutbound(input: EnqueueInput, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options), hash = phoneHashOf(input.e164);
    const [row] = await tx.insert(messagingMessages).values({ direction: "outbound", provider: input.provider, idempotencyKey: input.idempotencyKey, phoneHash: hash, personId: input.personId, commonsId: input.commonsId, purpose: input.purpose, body: input.body.slice(0, 4000), status: "queued", nextAttemptAt: input.notBefore ?? now, segments: input.segments, questionId: input.questionId ?? null, createdAt: now, updatedAt: now })
      .onConflictDoNothing().returning();
    if (row) return { message: row, created: true };
    const [existing] = await tx.select().from(messagingMessages).where(eq(messagingMessages.idempotencyKey, input.idempotencyKey));
    return { message: existing!, created: false };
  });
}

/** Take due messages for sending. SKIP LOCKED lets two workers run without sending the same message twice. */
/** `providers` limits the claim, so web messages still go out while an SMS provider is paused or absent. */
export async function claimDueOutbound(limit: number, options: Options & { providers?: string[] } = {}) {
  return run(options, async tx => {
    const now = clock(options);
    const due = await tx.select({ id: messagingMessages.id }).from(messagingMessages)
      .where(and(eq(messagingMessages.direction, "outbound"), options.providers ? inArray(messagingMessages.provider, options.providers) : undefined, or(and(eq(messagingMessages.status, "queued"), lte(messagingMessages.nextAttemptAt, now)), and(eq(messagingMessages.status, "sending"), lte(messagingMessages.leaseUntil, now)))))
      .orderBy(asc(messagingMessages.nextAttemptAt), asc(messagingMessages.createdAt)).limit(limit).for("update", { skipLocked: true });
    if (!due.length) return [];
    const claimed = await tx.update(messagingMessages).set({ status: "sending", leaseUntil: new Date(now.getTime() + 120_000), attempts: sql`${messagingMessages.attempts} + 1`, updatedAt: now }).where(inArray(messagingMessages.id, due.map(row => row.id))).returning();
    // UPDATE ... RETURNING has no defined order. A reply and the question it introduces must reach the person in the order they were written.
    const position = new Map(due.map((row, index) => [row.id, index]));
    return claimed.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  });
}

export async function recordSendResult(id: string, result:
  | { ok: true; providerMessageId: string; status: "sent" | "queued" | "delivered" }
  | { ok: false; retryAt: Date | null; detail: string }
  | { suppressed: string; retryAt?: Date | null }, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options);
    if ("ok" in result && result.ok) {
      await tx.update(messagingMessages).set({ status: result.status === "delivered" ? "delivered" : "sent", providerMessageId: result.providerMessageId, sentAt: now, deliveredAt: result.status === "delivered" ? now : null, leaseUntil: null, statusDetail: null, updatedAt: now }).where(eq(messagingMessages.id, id));
    } else if ("ok" in result) {
      await tx.update(messagingMessages).set(result.retryAt ? { status: "queued", nextAttemptAt: result.retryAt, statusDetail: result.detail.slice(0, 120), leaseUntil: null, updatedAt: now } : { status: "failed", failedAt: now, statusDetail: result.detail.slice(0, 120), leaseUntil: null, updatedAt: now }).where(eq(messagingMessages.id, id));
    } else if (result.retryAt) {
      // Deferred, not dropped: quiet hours or cadence. The attempt that was counted is given back.
      await tx.update(messagingMessages).set({ status: "queued", nextAttemptAt: result.retryAt, statusDetail: result.suppressed.slice(0, 120), leaseUntil: null, attempts: sql`greatest(${messagingMessages.attempts} - 1, 0)`, updatedAt: now }).where(eq(messagingMessages.id, id));
    } else {
      await tx.update(messagingMessages).set({ status: "suppressed", statusDetail: result.suppressed.slice(0, 120), leaseUntil: null, updatedAt: now }).where(eq(messagingMessages.id, id));
    }
  });
}

const rank: Record<string, number> = { queued: 0, sending: 1, sent: 2, undelivered: 3, failed: 3, delivered: 4 };
/** A provider callback. Out-of-order or repeated callbacks never move a message backwards; "delivered" is only ever set by the carrier's report. */
export async function applyStatusCallback(input: { provider: string; providerMessageId: string; status: "sent" | "delivered" | "undelivered" | "failed"; errorCode?: string | null }, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options);
    const [row] = await tx.select().from(messagingMessages).where(and(eq(messagingMessages.provider, input.provider), eq(messagingMessages.direction, "outbound"), eq(messagingMessages.providerMessageId, input.providerMessageId))).for("update");
    if (!row) return { found: false as const, changed: false };
    if ((rank[input.status] ?? 0) <= (rank[row.status] ?? 0) && !(["undelivered", "failed"].includes(input.status) && ["sent", "sending", "queued"].includes(row.status))) return { found: true as const, changed: false, id: row.id };
    await tx.update(messagingMessages).set({ status: input.status, statusDetail: input.errorCode ?? null, deliveredAt: input.status === "delivered" ? now : row.deliveredAt, failedAt: ["undelivered", "failed"].includes(input.status) ? now : row.failedAt, sentAt: row.sentAt ?? (input.status === "sent" ? now : null), updatedAt: now }).where(eq(messagingMessages.id, row.id));
    return { found: true as const, changed: true, id: row.id };
  });
}

/** Proactive messages sent to this number recently, for cadence limits. Replies to the person are not proactive. */
export async function recentProactive(phoneHash: string, sinceMs: number, options: Options = {}) {
  return run(options, async tx => tx.select({ at: messagingMessages.sentAt, commonsId: messagingMessages.commonsId, questionKey: messagingMessages.idempotencyKey, purpose: messagingMessages.purpose, status: messagingMessages.status }).from(messagingMessages)
    .where(and(eq(messagingMessages.phoneHash, phoneHash), eq(messagingMessages.direction, "outbound"), inArray(messagingMessages.status, ["sent", "delivered", "undelivered", "sending"]), gt(messagingMessages.sentAt, new Date(clock(options).getTime() - sinceMs)), sql`${messagingMessages.purpose} like 'proactive:%'`)).orderBy(desc(messagingMessages.sentAt)));
}

export async function lastOutboundQuestionId(phoneHash: string, options: Options = {}) {
  return run(options, async tx => (await tx.select({ questionId: messagingMessages.questionId }).from(messagingMessages).where(and(eq(messagingMessages.phoneHash, phoneHash), eq(messagingMessages.direction, "outbound"), inArray(messagingMessages.status, ["sent", "delivered", "queued", "sending"]))).orderBy(desc(messagingMessages.createdAt)).limit(1))[0]?.questionId ?? null);
}

/** Operator view: statuses and counts only. No body, no person, no phone: failures are observable without exposing traveler content. */
export async function messagingHealth(options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options);
    const byStatus = await tx.select({ direction: messagingMessages.direction, status: messagingMessages.status, count: sql<number>`count(*)::int` }).from(messagingMessages).groupBy(messagingMessages.direction, messagingMessages.status);
    const failures = await tx.select({ id: messagingMessages.id, purpose: messagingMessages.purpose, status: messagingMessages.status, detail: messagingMessages.statusDetail, attempts: messagingMessages.attempts, at: messagingMessages.updatedAt }).from(messagingMessages)
      .where(and(eq(messagingMessages.direction, "outbound"), inArray(messagingMessages.status, ["failed", "undelivered"]))).orderBy(desc(messagingMessages.updatedAt)).limit(25);
    const [stuck] = await tx.select({ count: sql<number>`count(*)::int` }).from(messagingMessages).where(and(eq(messagingMessages.status, "queued"), lte(messagingMessages.nextAttemptAt, new Date(now.getTime() - 10 * 60_000))));
    const [unprocessed] = await tx.select({ count: sql<number>`count(*)::int` }).from(messagingMessages).where(and(eq(messagingMessages.direction, "inbound"), eq(messagingMessages.status, "received"), lte(messagingMessages.createdAt, new Date(now.getTime() - 60_000))));
    return { byStatus, failures, stuckQueued: stuck?.count ?? 0, unprocessedInbound: unprocessed?.count ?? 0 };
  });
}
/** A send whose outcome is unknown may have reached the person. Check the provider first; a blind retry could text them twice. */
export const UNKNOWN_SEND_OUTCOME = "unknown_outcome_reconcile_before_retry";

/** An explicit operator retry of a failed message. Only a failed or undelivered row can be requeued, and only once per call. */
export async function requeueFailedOutbound(id: string, options: Options = {}, confirm: { checkedProvider?: boolean } = {}) {
  return run(options, async tx => { const rows = await tx.update(messagingMessages).set({ status: "queued", nextAttemptAt: clock(options), failedAt: null, statusDetail: "operator_retry", updatedAt: clock(options) }).where(and(eq(messagingMessages.id, id), eq(messagingMessages.direction, "outbound"), inArray(messagingMessages.status, ["failed", "undelivered"]), confirm.checkedProvider ? undefined : or(isNull(messagingMessages.statusDetail), ne(messagingMessages.statusDetail, UNKNOWN_SEND_OUTCOME)))).returning({ id: messagingMessages.id }); return rows.length === 1; });
}

// ---- Pending questions ------------------------------------------------------------------------------------------------------------------------------

export async function openQuestionsForPerson(personId: string, options: Options = {}) {
  return run(options, async tx => tx.select().from(messagingQuestions).where(and(eq(messagingQuestions.personId, personId), eq(messagingQuestions.status, "open"))).orderBy(desc(messagingQuestions.createdAt)));
}
export async function getQuestion(id: string, options: Options = {}) { return run(options, async tx => (await tx.select().from(messagingQuestions).where(eq(messagingQuestions.id, id)))[0] ?? null); }

/** A newer question of the same kind about the same thing supersedes the old one, so there is only ever one answerable version. */
export async function openQuestion(input: { personId: string; commonsId: string; kind: QuestionRow["kind"]; refId: string; version: string; options?: QuestionRow["options"]; expiresAt: Date; approvalCode?: string | null; heldMessageId?: string | null }, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options);
    await tx.update(messagingQuestions).set({ status: "superseded", resolvedAt: now, updatedAt: now }).where(and(eq(messagingQuestions.personId, input.personId), eq(messagingQuestions.commonsId, input.commonsId), eq(messagingQuestions.kind, input.kind), eq(messagingQuestions.refId, input.refId), eq(messagingQuestions.status, "open")));
    const [row] = await tx.insert(messagingQuestions).values({ personId: input.personId, commonsId: input.commonsId, kind: input.kind, refId: input.refId, version: input.version, options: input.options ?? [], expiresAt: input.expiresAt, approvalCode: input.approvalCode ?? null, heldMessageId: input.heldMessageId ?? null, createdAt: now, updatedAt: now }).returning();
    return row!;
  });
}
export async function closeQuestion(id: string, status: Exclude<QuestionRow["status"], "open">, answer: string | null = null, options: Options = {}) {
  return run(options, async tx => { const rows = await tx.update(messagingQuestions).set({ status, answer: answer?.slice(0, 200) ?? null, resolvedAt: clock(options), updatedAt: clock(options) }).where(and(eq(messagingQuestions.id, id), eq(messagingQuestions.status, "open"))).returning({ id: messagingQuestions.id }); return rows.length === 1; });
}
/** Recent questions of a kind about a trip, any status. A person who answered or deferred one is not asked again straight away. */
export async function recentQuestions(personId: string, commonsId: string, kind: QuestionRow["kind"], sinceMs: number, options: Options = {}) {
  return run(options, async tx => tx.select().from(messagingQuestions).where(and(eq(messagingQuestions.personId, personId), eq(messagingQuestions.commonsId, commonsId), eq(messagingQuestions.kind, kind), gt(messagingQuestions.createdAt, new Date(clock(options).getTime() - sinceMs)))).orderBy(desc(messagingQuestions.createdAt)));
}
/** The number consent was given for, for sending. Null unless the scope is currently granted for an active member. */
export async function consentedNumber(personId: string, commonsId: string, scope: "conversation" | "updates", options: Options = {}) {
  return run(options, async tx => {
    const [consent] = await tx.select({ phoneHash: messagingConsents.phoneHash }).from(messagingConsents)
      .innerJoin(memberships, and(eq(memberships.commonsId, messagingConsents.commonsId), eq(memberships.personId, messagingConsents.personId)))
      .where(and(eq(messagingConsents.personId, personId), eq(messagingConsents.commonsId, commonsId), eq(messagingConsents.scope, scope), eq(messagingConsents.status, "granted"), eq(memberships.status, "active")));
    if (!consent) return null;
    const [phone] = await tx.select({ protectedValue: messagingPhones.phoneProtected, optedOut: messagingPhones.optedOut }).from(messagingPhones).where(eq(messagingPhones.phoneHash, consent.phoneHash));
    return phone && !phone.optedOut ? { phoneHash: consent.phoneHash, e164: revealOpaqueToken(phone.protectedValue) } : null;
  });
}
/** How many organizer shares a trip has sent since a moment. Each recipient's copy is keyed `share:<share id>:<person>`, so shares are counted by id. */
export async function organizerSharesSince(commonsId: string, since: Date, options: Options = {}) {
  return run(options, async tx => {
    const rows = await tx.selectDistinct({ key: sql<string>`split_part(${messagingMessages.idempotencyKey}, ':', 2)` }).from(messagingMessages)
      .where(and(eq(messagingMessages.commonsId, commonsId), eq(messagingMessages.purpose, "proactive:organizer_share"), gt(messagingMessages.createdAt, since)));
    return rows.length;
  });
}
/** Everyone with conversation consent on a trip: the audience for a change notice. Consent is rechecked again at send time. */
export async function consentedMembers(commonsId: string, options: Options = {}) {
  return run(options, async tx => tx.select({ personId: messagingConsents.personId }).from(messagingConsents)
    .innerJoin(memberships, and(eq(memberships.commonsId, messagingConsents.commonsId), eq(memberships.personId, messagingConsents.personId)))
    .where(and(eq(messagingConsents.commonsId, commonsId), eq(messagingConsents.scope, "updates"), eq(messagingConsents.status, "granted"), eq(memberships.status, "active"))));
}
export async function membershipAttendance(personId: string, commonsId: string, options: Options = {}) {
  return run(options, async tx => (await tx.select({ state: memberships.attendanceState, dates: memberships.attendanceDates, role: memberships.role, status: memberships.status, id: memberships.id }).from(memberships).where(and(eq(memberships.personId, personId), eq(memberships.commonsId, commonsId))))[0] ?? null);
}
export async function personAuth(personId: string, options: Options = {}) {
  return run(options, async tx => (await tx.select({ authUserId: people.authUserId, displayName: people.displayName }).from(people).where(eq(people.id, personId)))[0] ?? null);
}
export async function expireQuestions(options: Options = {}) {
  return run(options, async tx => { const rows = await tx.update(messagingQuestions).set({ status: "expired", resolvedAt: clock(options), updatedAt: clock(options) }).where(and(eq(messagingQuestions.status, "open"), lte(messagingQuestions.expiresAt, clock(options)))).returning({ id: messagingQuestions.id }); return rows.length; });
}

// ---- Booking intake -----------------------------------------------------------------------------------------------------------------------------------

export async function intakeBySource(personId: string, commonsId: string, digest: string, options: Options = {}) {
  return run(options, async tx => (await tx.select().from(messagingBookingIntakes).where(and(eq(messagingBookingIntakes.personId, personId), eq(messagingBookingIntakes.commonsId, commonsId), eq(messagingBookingIntakes.sourceDigest, digest))))[0] ?? null);
}
export async function createIntake(input: { personId: string; commonsId: string; source: BookingIntakeRow["source"]; sourceDigest: string; sourceText?: string | null; sourceUrl?: string | null; storagePath?: string | null; mimeType?: string | null; confirmationIntakeId?: string | null; receivedMessageId?: string | null }, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options);
    const [row] = await tx.insert(messagingBookingIntakes).values({ personId: input.personId, commonsId: input.commonsId, source: input.source, sourceDigest: input.sourceDigest, sourceText: input.sourceText ?? null, sourceUrl: input.sourceUrl ?? null, storagePath: input.storagePath ?? null, mimeType: input.mimeType ?? null, confirmationIntakeId: input.confirmationIntakeId ?? null, receivedMessageId: input.receivedMessageId ?? null, createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
    if (row) return { intake: row, created: true };
    const [existing] = await tx.select().from(messagingBookingIntakes).where(and(eq(messagingBookingIntakes.personId, input.personId), eq(messagingBookingIntakes.commonsId, input.commonsId), eq(messagingBookingIntakes.sourceDigest, input.sourceDigest)));
    return { intake: existing!, created: false };
  });
}
export async function getIntake(id: string, options: Options = {}) { return run(options, async tx => (await tx.select().from(messagingBookingIntakes).where(eq(messagingBookingIntakes.id, id)))[0] ?? null); }
/** An intake belongs to exactly one person on one trip; every read by id also names them. */
export async function getOwnIntake(id: string, personId: string, options: Options = {}) { return run(options, async tx => (await tx.select().from(messagingBookingIntakes).where(and(eq(messagingBookingIntakes.id, id), eq(messagingBookingIntakes.personId, personId))))[0] ?? null); }
export async function intakeByReviewToken(tokenHash: string, options: Options = {}) { return run(options, async tx => (await tx.select().from(messagingBookingIntakes).where(eq(messagingBookingIntakes.reviewTokenHash, tokenHash)))[0] ?? null); }
export async function activeIntakeFor(personId: string, commonsId: string, options: Options = {}) {
  return run(options, async tx => (await tx.select().from(messagingBookingIntakes).where(and(eq(messagingBookingIntakes.personId, personId), eq(messagingBookingIntakes.commonsId, commonsId), inArray(messagingBookingIntakes.status, ["needs_info", "awaiting_review"]))).orderBy(desc(messagingBookingIntakes.updatedAt)).limit(1))[0] ?? null);
}

type IntakePatch = Partial<Pick<BookingIntakeRow, "status" | "draft" | "classification" | "matchedPlanId" | "uncertainty" | "reviewTokenHash" | "reviewExpiresAt" | "approvedAt" | "approvedVia" | "savedAt" | "errorCode" | "storagePath" | "mimeType" | "confirmationIntakeId" | "sourceText">>;
/** Compare-and-set on the version. A stale writer (an old extraction finishing late) changes nothing. */
export async function updateIntake(id: string, expectedVersion: number, patch: IntakePatch, options: { bumpVersion?: boolean } & Options = {}) {
  return run(options, async tx => {
    const [row] = await tx.update(messagingBookingIntakes).set({ ...patch, ...(options.bumpVersion ? { version: expectedVersion + 1 } : {}), updatedAt: clock(options) }).where(and(eq(messagingBookingIntakes.id, id), eq(messagingBookingIntakes.version, expectedVersion))).returning();
    return row ?? null;
  });
}
// ---- Planner reads ------------------------------------------------------------------------------------------------------------------------------------

export async function tripInfo(commonsId: string, options: Options = {}) {
  return run(options, async tx => (await tx.select({ id: commons.id, slug: commons.slug, name: commons.name, startsOn: commons.startsOn, endsOn: commons.endsOn, timezone: commons.timezone, status: commons.status, currency: commons.currency }).from(commons).where(eq(commons.id, commonsId)))[0] ?? null);
}
/** Every person with a currently granted conversation consent on an active membership: the planner's candidates. Eligibility is rechecked per message. */
export async function consentedPairs(limit: number, options: Options = {}) {
  return run(options, async tx => tx.selectDistinct({ personId: messagingConsents.personId, commonsId: messagingConsents.commonsId }).from(messagingConsents)
    .innerJoin(memberships, and(eq(memberships.commonsId, messagingConsents.commonsId), eq(memberships.personId, messagingConsents.personId)))
    .innerJoin(commons, eq(commons.id, messagingConsents.commonsId))
    .where(and(eq(messagingConsents.scope, "conversation"), eq(messagingConsents.status, "granted"), eq(memberships.status, "active"), ne(commons.status, "archived"))).limit(limit));
}
/** This person's intakes still moving, in the shape the channel-neutral next-step selector reads. */
export async function openIntakes(personId: string, commonsId: string, options: Options = {}) {
  return run(options, async tx => tx.select().from(messagingBookingIntakes).where(and(eq(messagingBookingIntakes.personId, personId), eq(messagingBookingIntakes.commonsId, commonsId), inArray(messagingBookingIntakes.status, ["received", "extracting", "needs_info", "awaiting_review", "failed"]))));
}
export async function hasQueuedProactive(personId: string, options: Options = {}) {
  return run(options, async tx => (await tx.select({ id: messagingMessages.id }).from(messagingMessages).where(and(eq(messagingMessages.personId, personId), eq(messagingMessages.direction, "outbound"), inArray(messagingMessages.status, ["queued", "sending"]), sql`${messagingMessages.purpose} like 'proactive:%'`)).limit(1)).length > 0);
}

// ---- Money by text -----------------------------------------------------------------------------------------------------------------------------------

export type MoneyIntakeRow = typeof messagingMoneyIntakes.$inferSelect;
/** One intake per inbound message, so a reprocessed message resumes the same report instead of starting a second. */
export async function createMoneyIntake(input: Pick<MoneyIntakeRow, "personId" | "commonsId" | "status" | "sourceText" | "draft" | "missing" | "receivedMessageId">, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options);
    const [row] = await tx.insert(messagingMoneyIntakes).values({ ...input, sourceText: input.sourceText.slice(0, 4000), createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
    if (row) return row;
    const [existing] = await tx.select().from(messagingMoneyIntakes).where(eq(messagingMoneyIntakes.receivedMessageId, input.receivedMessageId!));
    return existing!;
  });
}
export async function getOwnMoneyIntake(id: string, personId: string, options: Options = {}) {
  return run(options, async tx => (await tx.select().from(messagingMoneyIntakes).where(and(eq(messagingMoneyIntakes.id, id), eq(messagingMoneyIntakes.personId, personId))))[0] ?? null);
}
/** Compare-and-set on the version: a late writer changes nothing. A correction bumps the version, which is what invalidates an earlier approval code. */
export async function updateMoneyIntake(id: string, expectedVersion: number, patch: Partial<Pick<MoneyIntakeRow, "status" | "draft" | "missing" | "recordId">>, options: { bumpVersion?: boolean } & Options = {}) {
  return run(options, async tx => {
    const [row] = await tx.update(messagingMoneyIntakes).set({ ...patch, ...(options.bumpVersion ? { version: expectedVersion + 1 } : {}), updatedAt: clock(options) }).where(and(eq(messagingMoneyIntakes.id, id), eq(messagingMoneyIntakes.version, expectedVersion))).returning();
    return row ?? null;
  });
}
/** A new report replaces whatever this person had pending on the trip, so only one summary can be approved at a time. */
export async function supersedeMoneyIntakes(personId: string, commonsId: string, keepId: string | null, options: Options = {}) {
  return run(options, async tx => {
    const now = clock(options);
    const pending = await tx.select({ id: messagingMoneyIntakes.id }).from(messagingMoneyIntakes).where(and(eq(messagingMoneyIntakes.personId, personId), eq(messagingMoneyIntakes.commonsId, commonsId), inArray(messagingMoneyIntakes.status, ["needs_info", "awaiting_review"])));
    const ids = pending.map(row => row.id).filter(id => id !== keepId);
    if (ids.length) await tx.update(messagingMoneyIntakes).set({ status: "superseded", updatedAt: now }).where(inArray(messagingMoneyIntakes.id, ids));
    await tx.update(messagingQuestions).set({ status: "superseded", resolvedAt: now, updatedAt: now }).where(and(eq(messagingQuestions.personId, personId), eq(messagingQuestions.commonsId, commonsId), eq(messagingQuestions.status, "open"), inArray(messagingQuestions.kind, ["money_review", "money_info"])));
    return ids.length;
  });
}

/** Has a message with this stable key ever been queued? For things said once, however its delivery turned out. */
export async function messageKeyExists(key: string, options: Options = {}) {
  return run(options, async tx => (await tx.select({ id: messagingMessages.id }).from(messagingMessages).where(eq(messagingMessages.idempotencyKey, key)).limit(1)).length > 0);
}
export async function tripIdForPoll(pollId: string, options: Options = {}) {
  return run(options, async tx => (await tx.select({ commonsId: polls.commonsId }).from(polls).where(eq(polls.id, pollId)))[0]?.commonsId ?? null);
}

/** Approval is a single atomic transition from awaiting_review at the named version; the second concurrent approval finds nothing to change. */
export async function claimIntakeApproval(id: string, version: number, via: "sms" | "web", options: Options = {}) {
  return run(options, async tx => {
    const [row] = await tx.update(messagingBookingIntakes).set({ approvedAt: clock(options), approvedVia: via, updatedAt: clock(options) }).where(and(eq(messagingBookingIntakes.id, id), eq(messagingBookingIntakes.version, version), eq(messagingBookingIntakes.status, "awaiting_review"), isNull(messagingBookingIntakes.approvedAt))).returning();
    return row ?? null;
  });
}
