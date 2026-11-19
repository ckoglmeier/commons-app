import { createHmac, timingSafeEqual } from "node:crypto";
import { ProviderSendError, type InboundMedia, type InboundMessage, type MessagingProvider, type SendOutcome, type SendRequest, type StatusEvent } from "./provider";

/*
 * Twilio adapter shape. Twilio is a candidate provider, not a decision, and no Twilio account exists for Commons. This file is written against the
 * documented request-signing and Messages API contracts and is exercised only with an injected fetch in tests. It refuses to send unless every
 * credential is present; the application-level send gate (provider.ts) additionally requires an explicit COMMONS_SMS_SEND_MODE.
 * Never construct it with real credentials from test code.
 */
type TwilioConfig = { accountSid?: string; authToken?: string; messagingServiceSid?: string; statusCallbackUrl?: string };
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** Twilio's documented scheme: HMAC-SHA1 of the full URL followed by each form parameter's name and value sorted by name, base64 encoded. */
export function twilioSignature(authToken: string, url: string, params: URLSearchParams) {
  const names = [...new Set([...params.keys()])].sort();
  const data = names.reduce((text, name) => text + name + params.getAll(name).sort().join(""), url);
  return createHmac("sha1", authToken).update(data).digest("base64");
}

const STATUS: Record<string, StatusEvent["status"] | undefined> = { sent: "sent", delivered: "delivered", undelivered: "undelivered", failed: "failed" };

export class TwilioProvider implements MessagingProvider {
  readonly name = "twilio";
  readonly synthetic = false;
  /** Twilio's Advanced Opt-Out answers STOP/START/HELP when enabled on the Messaging Service; Commons then must not send a second confirmation. */
  readonly handlesOptOutReplies = true;
  readonly supportsMedia = true;
  constructor(private readonly config: TwilioConfig, private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init)) {}

  sendReadiness() {
    const missing = (["accountSid", "authToken", "messagingServiceSid"] as const).filter(key => !this.config[key]);
    return missing.length ? { ready: false as const, reason: `Twilio is missing ${missing.join(", ")}.` } : { ready: true as const };
  }
  verifyWebhook({ url, headers, rawBody }: { url: string; headers: Headers; rawBody: string }) {
    const token = this.config.authToken, given = headers.get("x-twilio-signature");
    if (!token || !given) return false;
    const expected = twilioSignature(token, url, new URLSearchParams(rawBody));
    return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }
  parseInbound(rawBody: string): InboundMessage | null {
    const form = new URLSearchParams(rawBody), sid = form.get("MessageSid") ?? form.get("SmsMessageSid"), from = form.get("From");
    if (!sid || !from || form.get("MessageStatus")) return null;
    const media: InboundMedia[] = [];
    for (let index = 0; index < Math.min(Number(form.get("NumMedia") ?? 0), 5); index++) {
      const url = form.get(`MediaUrl${index}`), contentType = form.get(`MediaContentType${index}`);
      if (url && contentType) media.push({ url, contentType });
    }
    return { providerMessageId: sid, from, to: form.get("To") ?? "", body: form.get("Body") ?? "", media };
  }
  parseStatus(rawBody: string): StatusEvent | null {
    const form = new URLSearchParams(rawBody), sid = form.get("MessageSid"), raw = form.get("MessageStatus")?.toLowerCase();
    const status = raw ? STATUS[raw] : undefined;
    // "queued", "accepted" and "sending" are Twilio's own pre-send states; they carry no information Commons does not already have.
    return sid && status ? { eventKey: `${sid}:${raw}`, providerMessageId: sid, status, errorCode: form.get("ErrorCode") } : null;
  }
  async send(request: SendRequest): Promise<SendOutcome> {
    const readiness = this.sendReadiness();
    if (!readiness.ready) throw new ProviderSendError(readiness.reason, "provider_not_configured", false);
    const { accountSid, authToken, messagingServiceSid } = this.config;
    const body = new URLSearchParams({ To: request.to, MessagingServiceSid: messagingServiceSid!, Body: request.body });
    if (this.config.statusCallbackUrl) body.set("StatusCallback", this.config.statusCallbackUrl);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST", body: body.toString(), signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      });
    } catch (cause) {
      // The request may or may not have reached Twilio. It is not retried blindly: an operator reconciles first.
      throw new ProviderSendError(cause instanceof Error ? cause.message : "network error", "unknown_outcome", false, true);
    }
    const text = await response.text();
    if (response.status === 201 || response.status === 200) {
      const parsed = JSON.parse(text) as { sid?: string };
      if (!parsed.sid) throw new ProviderSendError("Twilio accepted without a message id.", "unknown_outcome", false, true);
      return { providerMessageId: parsed.sid, status: "accepted" };
    }
    let code = `http_${response.status}`;
    try { const parsed = JSON.parse(text) as { code?: number }; if (parsed.code) code = String(parsed.code); } catch { /* keep the HTTP code */ }
    throw new ProviderSendError(`Twilio rejected the message (${code}).`, code, response.status === 429 || response.status >= 500);
  }
  async fetchMedia(media: InboundMedia) {
    const { accountSid, authToken } = this.config;
    if (!accountSid || !authToken) throw new Error("provider_not_configured");
    const host = new URL(media.url).hostname;
    // Provider media is fetched only from the provider's own hosts and with its credentials, never from an arbitrary URL in a message.
    if (!/(^|\.)twilio\.com$/.test(host)) throw new Error("media_host_not_allowed");
    const response = await fetch(media.url, { headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`media_http_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("media_too_large");
    return { bytes, contentType: media.contentType };
  }
  ack() { return new Response("<Response/>", { status: 200, headers: { "content-type": "text/xml" } }); }
}
