import { readCommonsRuntimeEnvironment } from "../runtime-environment";

/*
 * A provider-neutral messaging adapter. Commons owns identity, consent, routing and status; a provider only moves bytes and signs its webhooks.
 * No provider account exists yet: Twilio is a candidate and its adapter is written against this interface. The fake provider in
 * fake-provider.ts is the only thing tests send through, and it can only be installed by test code.
 */
export type InboundMedia = { url: string; contentType: string };
export type InboundMessage = { providerMessageId: string; from: string; to: string; body: string; media: InboundMedia[] };
export type StatusEvent = { eventKey: string; providerMessageId: string; status: "sent" | "delivered" | "undelivered" | "failed"; errorCode: string | null };
export type SendRequest = { to: string; body: string; idempotencyKey: string };
/** `accepted` means the provider took the message. It is never delivery; only a status callback can say delivered. */
export type SendOutcome = { providerMessageId: string; status: "accepted" };

export class ProviderSendError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean, readonly unknownOutcome = false) { super(message); }
}

export interface MessagingProvider {
  readonly name: string;
  /** True only for the in-memory test provider. A fake can never reach a handset. */
  readonly synthetic: boolean;
  /** Carriers/providers answer STOP, START and HELP themselves on some products; Commons then sends no second confirmation. */
  readonly handlesOptOutReplies: boolean;
  readonly supportsMedia: boolean;
  /** Whether this provider is configured to send at all. Missing credentials mean it refuses, never that it guesses. */
  sendReadiness(): { ready: true } | { ready: false; reason: string };
  verifyWebhook(input: { url: string; headers: Headers; rawBody: string }): boolean;
  parseInbound(rawBody: string, headers: Headers): InboundMessage | null;
  parseStatus(rawBody: string, headers: Headers): StatusEvent | null;
  send(request: SendRequest): Promise<SendOutcome>;
  fetchMedia?(media: InboundMedia): Promise<{ bytes: Uint8Array; contentType: string }>;
  /** Only the in-app test thread, on fictional numbers. Everywhere else a verification code is never kept in a message record. */
  readonly showsVerificationCodes?: boolean;
  ack(): Response;
}

let override: MessagingProvider | null | undefined;
/** Test seam. `null` forces "no provider"; `undefined` restores the environment's choice. Production code never calls this. */
export function setMessagingProviderForTests(provider: MessagingProvider | null | undefined) { override = provider; }

export async function messagingProvider(): Promise<MessagingProvider | null> {
  if (override !== undefined) return override;
  const environment = readCommonsRuntimeEnvironment();
  if (environment.COMMONS_SMS_PROVIDER === "in_app") {
    const { InAppProvider } = await import("./in-app-provider");
    return new InAppProvider();
  }
  if (environment.COMMONS_SMS_PROVIDER === "twilio") {
    const { TwilioProvider } = await import("./twilio-provider");
    return new TwilioProvider({ accountSid: environment.TWILIO_ACCOUNT_SID, authToken: environment.TWILIO_AUTH_TOKEN, messagingServiceSid: environment.TWILIO_MESSAGING_SERVICE_SID,
      statusCallbackUrl: environment.COMMONS_SMS_WEBHOOK_ORIGIN ? `${new URL(environment.COMMONS_SMS_WEBHOOK_ORIGIN).origin}/api/v1/messaging/status/` : undefined });
  }
  return null;
}

/**
 * The last gate before a message leaves. A synthetic provider is always allowed (it cannot reach anyone). A real one needs complete credentials,
 * an explicit COMMONS_SMS_SEND_MODE, and, in allowlist mode, a recipient on the list. Anything else refuses and the message stays queued.
 */
export function sendGate(provider: MessagingProvider, e164: string, environment: Record<string, unknown> = process.env): { allowed: true } | { allowed: false; reason: "send_disabled" | "provider_not_configured" | "not_allowlisted"; detail?: string } {
  if (provider.synthetic) return { allowed: true };
  const readiness = provider.sendReadiness();
  if (!readiness.ready) return { allowed: false, reason: "provider_not_configured", detail: readiness.reason };
  const env = readCommonsRuntimeEnvironment(environment as NodeJS.ProcessEnv);
  if (env.COMMONS_SMS_SEND_MODE === "disabled") return { allowed: false, reason: "send_disabled" };
  if (env.COMMONS_SMS_SEND_MODE === "allowlist") {
    const list = (env.COMMONS_SMS_RECIPIENT_ALLOWLIST ?? "").split(",").map(item => item.trim()).filter(Boolean);
    if (!list.includes(e164)) return { allowed: false, reason: "not_allowlisted" };
    return { allowed: true };
  }
  // A test thread's fictional number can outlive the test. Live sending never spends a message on one.
  if (/^\+1[2-9]\d{2}55501\d{2}$/.test(e164)) return { allowed: false, reason: "not_allowlisted", detail: "test_number" };
  return { allowed: true };
}

/** Stands in where a provider is not configured. It verifies nothing and refuses to send. */
export const unconfiguredProvider: MessagingProvider = {
  name: "none", synthetic: false, handlesOptOutReplies: true, supportsMedia: false,
  sendReadiness: () => ({ ready: false, reason: "No messaging provider is configured." }),
  verifyWebhook: () => false, parseInbound: () => null, parseStatus: () => null,
  send: async () => { throw new ProviderSendError("No messaging provider is configured.", "provider_not_configured", false); },
  ack: () => new Response(null, { status: 204 }),
};
