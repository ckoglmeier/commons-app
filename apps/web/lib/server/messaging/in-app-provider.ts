import { randomUUID } from "node:crypto";
import { ProviderSendError, type MessagingProvider, type SendOutcome, type SendRequest } from "./provider";

/*
 * Carries messages to the in-app test thread instead of a phone. The conversation code above it is exactly what real SMS will use: routing, consent, quiet
 * hours, approvals and saved records all run for real, and only this last step differs. Moving to SMS is a matter of settings. It accepts only reserved
 * fictional numbers, so a test can never claim a number someone actually owns, and it answers STOP and HELP itself because no carrier is there to do it.
 */
export const isTestNumber = (e164: string) => /^\+1[2-9]\d{2}55501\d{2}$/.test(e164);

/** A stable fictional number for one person: 555-01xx is reserved for fiction in North America, and can't reach anyone. */
export function testNumberFor(personId: string) {
  let hash = 0;
  for (const char of personId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const area = 200 + (hash % 800), line = String(Math.floor(hash / 800) % 100).padStart(2, "0");
  return `+1${area}55501${line}`;
}

export class InAppProvider implements MessagingProvider {
  readonly name = "in_app";
  /** It can never reach a handset, which is what this flag promises the send gate. */
  readonly synthetic = true;
  readonly handlesOptOutReplies = false;
  readonly supportsMedia = false;
  /** With a fictional number nobody can receive a code any other way, so the test thread has to show it. Real providers never set this. */
  readonly showsVerificationCodes = true;
  sendReadiness() { return { ready: true as const }; }
  verifyWebhook() { return false; }
  parseInbound() { return null; }
  parseStatus() { return null; }
  async send(request: SendRequest): Promise<SendOutcome> {
    if (!isTestNumber(request.to)) throw new ProviderSendError("The test thread only carries fictional numbers.", "not_a_test_number", false);
    return { providerMessageId: `INAPP-${randomUUID()}`, status: "accepted" };
  }
  ack() { return new Response(null, { status: 204 }); }
}
