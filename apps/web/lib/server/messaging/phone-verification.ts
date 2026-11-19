import { cancelPhoneVerification, confirmPhoneVerification, recordVerificationSend, startPhoneVerification, verifiedPhoneFor } from "@commons/database";
import { messagingCopy, smsSegments } from "@commons/domain";
import { z } from "zod";
import { normalizePhone } from "@/lib/contact-methods";
import { authenticatedConfirmationIntakeOptions } from "../commons";
import { dbOptions, messagingDeps } from "./core";
import { testNumberFor } from "./in-app-provider";
import { ProviderSendError, sendGate } from "./provider";

/*
 * Proving a person controls a mobile number, from the signed-in session only. No route takes a person id. Nothing here creates consent to text: that
 * stays on the per-trip enrollment page. The code goes straight to the provider and is never written to the outbox.
 */
const warn = (name: string, detail: Record<string, unknown>) => console.warn(name, detail);
export const PhoneCodeRequestSchema = z.object({ value: z.string().trim().min(7).max(24) });
export const PhoneCodeConfirmSchema = z.object({ value: z.string().trim().min(7).max(24), code: z.string().trim().min(1).max(12) });

/** Pilot geography. Limiting which countries can request a code also bounds what a scripted request can cost. */
const allowedPrefixes = (environment: NodeJS.ProcessEnv = process.env) => (environment.COMMONS_SMS_VERIFY_COUNTRY_PREFIXES ?? "+1").split(",").map(item => item.trim()).filter(Boolean);

export type PhoneCodeRefusal = { ok: false; status: number; code: string; message: string };
const refuse = (status: number, code: string, message: string): PhoneCodeRefusal => ({ ok: false, status, code, message });
const invalidNumber = () => refuse(400, "invalid_number", "Enter your mobile number, like (415) 555-0123.");

export async function sendPhoneCode(raw: unknown): Promise<{ ok: true; phone: string } | PhoneCodeRefusal> {
  const options = await authenticatedConfirmationIntakeOptions();
  const input = PhoneCodeRequestSchema.parse(raw), deps = await messagingDeps(), phone = normalizePhone(input.value);
  if (!phone) return invalidNumber();
  // Your own fictional number and no other, so no tester can step into a number another tester used, along with its thread.
  if (deps.provider.showsVerificationCodes && phone !== testNumberFor(options.actorPersonId)) return refuse(400, "test_number_required", "This is a test thread, so it only takes your test number. Use the one filled in for you.");
  if (!allowedPrefixes().some(prefix => phone.startsWith(prefix))) return refuse(400, "unsupported_country", "Commons can only text US and Canadian numbers right now. You can keep using the trip on the web.");
  const gate = sendGate(deps.provider, phone);
  if (!gate.allowed) return refuse(gate.reason === "not_allowlisted" ? 403 : 503, gate.reason, gate.reason === "not_allowlisted" ? "This number isn’t on the test list yet, so no code was sent." : "Texting isn’t available right now, so no code was sent.");
  const started = await startPhoneVerification({ personId: options.actorPersonId, phone }, dbOptions(deps));
  if (!started.ok) {
    if (started.reason === "invalid_number") return invalidNumber();
    if (started.reason === "opted_out") return refuse(409, "opted_out", "We can’t text this number right now. If it replied STOP to Commons, text START to our number, then try again.");
    return refuse(429, "rate_limited", "That’s a lot of codes for now. Wait a while, then try again.");
  }
  const body = messagingCopy.verificationCode(started.code);
  try {
    const sent = await deps.provider.send({ to: started.e164, body, idempotencyKey: `verify:${started.verificationId}` });
    await recordVerificationSend({ provider: deps.provider.name, providerMessageId: sent.providerMessageId, e164: started.e164, personId: options.actorPersonId, segments: smsSegments(body), visibleBody: deps.provider.showsVerificationCodes ? body : null }, dbOptions(deps));
    return { ok: true, phone: started.e164 };
  } catch (error) {
    await cancelPhoneVerification(started.verificationId, dbOptions(deps));
    if (!(error instanceof ProviderSendError)) throw error;
    warn("commons.messaging.verification_send_failed", { code: error.code, retryable: error.retryable, unknownOutcome: error.unknownOutcome });
    return refuse(502, "send_failed", "We couldn’t send a code. Check the number and try again.");
  }
}

export async function confirmPhoneCode(raw: unknown): Promise<{ ok: true; phone: string } | PhoneCodeRefusal> {
  const options = await authenticatedConfirmationIntakeOptions();
  const input = PhoneCodeConfirmSchema.parse(raw), deps = await messagingDeps({ allowNoProvider: true });
  const phone = normalizePhone(input.value);
  if (!phone) return invalidNumber();
  const result = await confirmPhoneVerification({ personId: options.actorPersonId, phone, code: input.code }, dbOptions(deps));
  if (result.ok) return { ok: true, phone: result.e164 };
  switch (result.reason) {
    case "invalid_number": return invalidNumber();
    case "invalid_code": return refuse(400, "invalid_code", "That code isn’t right. Check it and try again.");
    case "too_many_attempts": return refuse(429, "too_many_attempts", "That’s too many tries. Send yourself a new code.");
    case "expired": return refuse(410, "expired", "That code has expired. Send yourself a new one.");
    case "number_taken": return refuse(409, "number_taken", "That number is already on another Commons account. Sign in with that account, or use a different number.");
  }
}

/** The signed-in person's verified number, or null. For their own screens only. */
export async function ownVerifiedPhone() {
  const options = await authenticatedConfirmationIntakeOptions();
  return verifiedPhoneFor(options.actorPersonId, { databaseUrl: options.databaseUrl });
}
