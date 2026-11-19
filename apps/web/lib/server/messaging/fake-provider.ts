import { createHmac, timingSafeEqual } from "node:crypto";
import { ProviderSendError, type InboundMedia, type InboundMessage, type MessagingProvider, type SendOutcome, type SendRequest, type StatusEvent } from "./provider";

/*
 * A local, in-memory provider for tests. Everything it records is synthetic evidence; it can never reach a handset. It signs and verifies
 * webhooks the way a real provider does (HMAC over the raw body) so forged and unsigned requests are rejected by the same code path.
 */
export const FAKE_SECRET = "synthetic-webhook-secret";
export const FAKE_SIGNATURE_HEADER = "x-fake-signature";

export function signFakeBody(rawBody: string, secret = FAKE_SECRET) { return createHmac("sha256", secret).update(rawBody).digest("hex"); }

export class FakeProvider implements MessagingProvider {
  readonly name = "fake";
  readonly synthetic = true;
  readonly supportsMedia = true;
  handlesOptOutReplies = true;
  /** Every message the application asked this provider to send, in order. */
  readonly outbox: Array<SendRequest & { providerMessageId: string }> = [];
  /** Scripted behavior: each entry is consumed by one send call. */
  private script: Array<"ok" | ProviderSendError> = [];
  private counter = 0;
  readonly media = new Map<string, { bytes: Uint8Array; contentType: string }>();
  constructor(private readonly secret = FAKE_SECRET) {}

  failNext(error: ProviderSendError) { this.script.push(error); }
  sendReadiness() { return { ready: true as const }; }
  verifyWebhook({ headers, rawBody }: { url: string; headers: Headers; rawBody: string }) {
    const given = headers.get(FAKE_SIGNATURE_HEADER);
    if (!given) return false;
    const expected = signFakeBody(rawBody, this.secret);
    return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }
  parseInbound(rawBody: string): InboundMessage | null {
    try {
      const body = JSON.parse(rawBody) as { type?: string; id?: string; from?: string; to?: string; body?: string; media?: InboundMedia[] };
      if (body.type !== "inbound" || !body.id || !body.from) return null;
      return { providerMessageId: body.id, from: body.from, to: body.to ?? "+15550000000", body: body.body ?? "", media: body.media ?? [] };
    } catch { return null; }
  }
  parseStatus(rawBody: string): StatusEvent | null {
    try {
      const body = JSON.parse(rawBody) as { type?: string; eventId?: string; messageId?: string; status?: StatusEvent["status"]; errorCode?: string | null };
      if (body.type !== "status" || !body.eventId || !body.messageId || !body.status) return null;
      return { eventKey: body.eventId, providerMessageId: body.messageId, status: body.status, errorCode: body.errorCode ?? null };
    } catch { return null; }
  }
  async send(request: SendRequest): Promise<SendOutcome> {
    const step = this.script.shift();
    if (step instanceof ProviderSendError) throw step;
    const providerMessageId = `FAKE${String(++this.counter).padStart(6, "0")}`;
    this.outbox.push({ ...request, providerMessageId });
    return { providerMessageId, status: "accepted" };
  }
  async fetchMedia(media: InboundMedia) {
    const found = this.media.get(media.url);
    if (!found) throw new Error("media_unavailable");
    return found;
  }
  ack() { return new Response(null, { status: 204 }); }

  // ---- test helpers: build signed provider requests ----
  inboundRequest(input: { id: string; from: string; body: string; media?: InboundMedia[]; signature?: string | null; secret?: string }) {
    const raw = JSON.stringify({ type: "inbound", id: input.id, from: input.from, to: "+15550000000", body: input.body, media: input.media ?? [] });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (input.signature !== null) headers[FAKE_SIGNATURE_HEADER] = input.signature ?? signFakeBody(raw, input.secret ?? this.secret);
    return new Request("http://localhost/api/v1/messaging/inbound", { method: "POST", headers, body: raw });
  }
  statusRequest(input: { eventId: string; messageId: string; status: StatusEvent["status"]; errorCode?: string; signature?: string | null }) {
    const raw = JSON.stringify({ type: "status", eventId: input.eventId, messageId: input.messageId, status: input.status, errorCode: input.errorCode ?? null });
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (input.signature !== null) headers[FAKE_SIGNATURE_HEADER] = input.signature ?? signFakeBody(raw, this.secret);
    return new Request("http://localhost/api/v1/messaging/status", { method: "POST", headers, body: raw });
  }
}
