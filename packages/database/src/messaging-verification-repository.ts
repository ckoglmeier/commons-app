import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { identities, messagingConsents, messagingMessages, messagingPhones, messagingPhoneVerifications, messagingQuestions } from "./schema";
import { hashNormalizedPhone, hashOpaqueToken, normalizePhone, protectOpaqueToken, readTokenProtectionKey, revealOpaqueToken } from "./tokens";

/*
 * Proving a person controls a mobile number. A verified number is not permission to text it: consent stays per trip, created only by the person on the
 * web. The code is returned once for the caller to send, then only its keyed hash exists. Whether a number belongs to someone else is revealed only
 * after the code proves control of it, so these answers can't be used to look up who has an account.
 */
type Options = { databaseUrl?: string; now?: Date };
type Tx = Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0];
async function run<T>(options: Options, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(fn); } finally { await database.close(); }
}
const clock = (options: Options) => options.now ?? new Date();

export const PHONE_CODE_TTL_MS = 10 * 60_000;
export const PHONE_CODE_MAX_ATTEMPTS = 5;
export const PHONE_VERIFICATION_LIMITS = { perPersonPerHour: 5, perNumberPerHour: 3, overallPerHour: 200 };
const HOUR_MS = 3_600_000;

const codeHash = (verificationId: string, code: string) => createHmac("sha256", readTokenProtectionKey()).update(`${verificationId}:${code}`).digest();

export type PhoneVerificationStart =
  | { ok: true; verificationId: string; code: string; e164: string }
  | { ok: false; reason: "invalid_number" | "opted_out" | "rate_limited" };

/** A new code for this person and number. Any earlier code of theirs stops working. Limits count every code issued, so asking again never resets them. */
export async function startPhoneVerification(input: { personId: string; phone: string; limits?: typeof PHONE_VERIFICATION_LIMITS }, options: Options = {}): Promise<PhoneVerificationStart> {
  let e164: string;
  try { e164 = normalizePhone(input.phone); } catch { return { ok: false, reason: "invalid_number" }; }
  const limits = input.limits ?? PHONE_VERIFICATION_LIMITS, hash = hashNormalizedPhone(e164), now = clock(options);
  return run(options, async tx => {
    // One issue at a time per person and per number, so two quick requests can't both slip under a limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`phone-verify:${input.personId}`}))`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`phone-verify:${hash}`}))`);
    const [phone] = await tx.select({ optedOut: messagingPhones.optedOut }).from(messagingPhones).where(eq(messagingPhones.phoneHash, hash));
    if (phone?.optedOut) return { ok: false as const, reason: "opted_out" as const };
    const since = new Date(now.getTime() - HOUR_MS);
    const count = async (where: ReturnType<typeof and>) => (await tx.select({ value: sql<number>`count(*)::int` }).from(messagingPhoneVerifications).where(where))[0]!.value;
    if (await count(and(eq(messagingPhoneVerifications.personId, input.personId), gte(messagingPhoneVerifications.createdAt, since))) >= limits.perPersonPerHour) return { ok: false as const, reason: "rate_limited" as const };
    if (await count(and(eq(messagingPhoneVerifications.phoneHash, hash), gte(messagingPhoneVerifications.createdAt, since))) >= limits.perNumberPerHour) return { ok: false as const, reason: "rate_limited" as const };
    if (await count(gte(messagingPhoneVerifications.createdAt, since)) >= limits.overallPerHour) return { ok: false as const, reason: "rate_limited" as const };
    await tx.update(messagingPhoneVerifications).set({ consumedAt: now }).where(and(eq(messagingPhoneVerifications.personId, input.personId), isNull(messagingPhoneVerifications.consumedAt)));
    const id = crypto.randomUUID(), code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await tx.insert(messagingPhoneVerifications).values({ id, personId: input.personId, phoneHash: hash, codeHash: codeHash(id, code).toString("hex"), expiresAt: new Date(now.getTime() + PHONE_CODE_TTL_MS), createdAt: now });
    return { ok: true as const, verificationId: id, code, e164 };
  });
}

/** The provider never took the code, so it mustn't stay redeemable. It still counts toward the limits. */
export async function cancelPhoneVerification(verificationId: string, options: Options = {}) {
  await run(options, async tx => { await tx.update(messagingPhoneVerifications).set({ consumedAt: clock(options) }).where(eq(messagingPhoneVerifications.id, verificationId)); });
}

/**
 * A record of the send for delivery receipts and cost. The body says what it was and never contains the code, except in the in-app test thread: its
 * numbers are fictional, so the thread is the only place the code can be read.
 */
export async function recordVerificationSend(input: { provider: string; providerMessageId: string; e164: string; personId: string; segments: number; visibleBody?: string | null }, options: Options = {}) {
  await run(options, async tx => {
    const now = clock(options), hash = hashNormalizedPhone(input.e164);
    await tx.insert(messagingPhones).values({ phoneHash: hash, phoneProtected: protectOpaqueToken(input.e164), createdAt: now, updatedAt: now }).onConflictDoNothing();
    await tx.insert(messagingMessages).values({ direction: "outbound", provider: input.provider, providerMessageId: input.providerMessageId, phoneHash: hash, personId: input.personId, purpose: "compliance:verification", body: input.visibleBody ?? "Verification code (not stored)", status: "sent", sentAt: now, segments: input.segments, createdAt: now, updatedAt: now });
  });
}

export type PhoneVerificationResult =
  | { ok: true; e164: string; replacedNumber: boolean }
  | { ok: false; reason: "invalid_number" | "invalid_code" | "expired" | "too_many_attempts" | "number_taken" };

/**
 * Check a code. A wrong guess is counted even though nothing else changes. On success the number becomes this person's verified number. If they had a
 * different one, it stops being theirs: its trip consents are revoked and anything queued to it is dropped, so nothing follows them to the new number
 * and nothing keeps going to the old one.
 */
export async function confirmPhoneVerification(input: { personId: string; phone: string; code: string }, options: Options = {}): Promise<PhoneVerificationResult> {
  let e164: string;
  try { e164 = normalizePhone(input.phone); } catch { return { ok: false, reason: "invalid_number" }; }
  const hash = hashNormalizedPhone(e164), now = clock(options), supplied = input.code.replace(/\s/g, "");
  return run(options, async tx => {
    const [row] = await tx.select().from(messagingPhoneVerifications)
      .where(and(eq(messagingPhoneVerifications.personId, input.personId), eq(messagingPhoneVerifications.phoneHash, hash), isNull(messagingPhoneVerifications.consumedAt)))
      .orderBy(desc(messagingPhoneVerifications.createdAt)).limit(1).for("update");
    if (!row || row.expiresAt <= now) return { ok: false as const, reason: "expired" as const };
    if (row.attempts >= PHONE_CODE_MAX_ATTEMPTS) return { ok: false as const, reason: "too_many_attempts" as const };
    const expected = Buffer.from(row.codeHash, "hex"), actual = /^\d{6}$/.test(supplied) ? codeHash(row.id, supplied) : Buffer.alloc(expected.length);
    if (!/^\d{6}$/.test(supplied) || !timingSafeEqual(expected, actual)) {
      const attempts = row.attempts + 1;
      await tx.update(messagingPhoneVerifications).set({ attempts }).where(eq(messagingPhoneVerifications.id, row.id));
      return { ok: false as const, reason: attempts >= PHONE_CODE_MAX_ATTEMPTS ? "too_many_attempts" as const : "invalid_code" as const };
    }
    await tx.update(messagingPhoneVerifications).set({ consumedAt: now }).where(eq(messagingPhoneVerifications.id, row.id));
    const [existing] = await tx.select({ personId: identities.personId }).from(identities).where(and(eq(identities.kind, "phone"), eq(identities.normalizedHash, hash)));
    if (existing && existing.personId !== input.personId) return { ok: false as const, reason: "number_taken" as const };

    // Claimed before anything else changes. If another account confirmed this number a moment ago, the conflict leaves no row, and nothing below runs.
    const [claimed] = await tx.insert(identities).values({ personId: input.personId, kind: "phone", normalizedHash: hash, displayValueEncrypted: protectOpaqueToken(e164), state: "channel_verified", verifiedAt: now, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: [identities.kind, identities.normalizedHash], set: { displayValueEncrypted: protectOpaqueToken(e164), state: "channel_verified", verifiedAt: now, updatedAt: now }, where: eq(identities.personId, input.personId) })
      .returning({ id: identities.id });
    if (!claimed) return { ok: false as const, reason: "number_taken" as const };

    const others = await tx.select({ id: identities.id, normalizedHash: identities.normalizedHash }).from(identities).where(and(eq(identities.personId, input.personId), eq(identities.kind, "phone"), ne(identities.normalizedHash, hash)));
    if (others.length) {
      const oldHashes = others.map(other => other.normalizedHash);
      await tx.delete(identities).where(inArray(identities.id, others.map(other => other.id)));
      await tx.update(messagingConsents).set({ status: "revoked", revokedAt: now, revokedReason: "number_changed", updatedAt: now }).where(and(eq(messagingConsents.personId, input.personId), inArray(messagingConsents.phoneHash, oldHashes), eq(messagingConsents.status, "granted")));
      await tx.update(messagingQuestions).set({ status: "cancelled", resolvedAt: now, updatedAt: now }).where(and(eq(messagingQuestions.personId, input.personId), eq(messagingQuestions.status, "open")));
      await tx.update(messagingMessages).set({ status: "suppressed", statusDetail: "number_changed", updatedAt: now }).where(and(inArray(messagingMessages.phoneHash, oldHashes), eq(messagingMessages.direction, "outbound"), inArray(messagingMessages.status, ["queued", "sending"])));
    }
    return { ok: true as const, e164, replacedNumber: others.length > 0 };
  });
}

/** Codes sent to this person in the test thread, before they have a confirmed number. Read by person, so nobody sees a code sent to someone else. */
export async function pendingVerificationMessages(personId: string, provider: string, options: Options = {}) {
  return run(options, async tx => {
    const rows = await tx.select({ id: messagingMessages.id, direction: messagingMessages.direction, body: messagingMessages.body, status: messagingMessages.status, statusDetail: messagingMessages.statusDetail, nextAttemptAt: messagingMessages.nextAttemptAt, createdAt: messagingMessages.createdAt })
      .from(messagingMessages).where(and(eq(messagingMessages.personId, personId), eq(messagingMessages.provider, provider), eq(messagingMessages.purpose, "compliance:verification"))).orderBy(desc(messagingMessages.createdAt)).limit(5);
    return rows.reverse();
  });
}

/** One number's conversation, oldest first, for its owner's own test thread. */
export async function threadForPhone(e164: string, limit: number, options: Options = {}) {
  return run(options, async tx => {
    const rows = await tx.select({ id: messagingMessages.id, direction: messagingMessages.direction, body: messagingMessages.body, status: messagingMessages.status, statusDetail: messagingMessages.statusDetail, nextAttemptAt: messagingMessages.nextAttemptAt, sentAt: messagingMessages.sentAt, createdAt: messagingMessages.createdAt })
      .from(messagingMessages).where(eq(messagingMessages.phoneHash, e164.startsWith("web:") ? hashOpaqueToken(e164) : hashNormalizedPhone(e164))).orderBy(desc(messagingMessages.createdAt)).limit(limit);
    return rows.reverse();
  });
}

/** The person's own verified number, for their own screens and for enrollment. Null when they have none, or one stored before numbers were kept readable. */
export async function verifiedPhoneFor(personId: string, options: Options = {}) {
  return run(options, async tx => {
    const [row] = await tx.select({ value: identities.displayValueEncrypted }).from(identities)
      .where(and(eq(identities.personId, personId), eq(identities.kind, "phone"), inArray(identities.state, ["channel_verified", "claimed"])))
      .orderBy(desc(identities.verifiedAt)).limit(1);
    return row?.value ? revealOpaqueToken(row.value) : null;
  });
}
