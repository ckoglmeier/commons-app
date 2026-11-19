import type { MessagingProvider, SendOutcome, SendRequest } from "./provider";

/**
 * COMMONS_SMS_SEND_MODE=log. Records each message as sent in the server log and returns a synthetic provider id. It makes no network request and
 * cannot receive anything, so no inbound or status webhook is ever accepted.
 */
export class LogProvider implements MessagingProvider {
  readonly name = "log";
  readonly synthetic = true;
  readonly handlesOptOutReplies = true;
  readonly supportsMedia = false;
  sendReadiness() { return { ready: true as const }; }
  verifyWebhook() { return false; }
  parseInbound() { return null; }
  parseStatus() { return null; }
  async send(request: SendRequest): Promise<SendOutcome> {
    console.info("commons.sms.logged", { to: request.to, body: request.body });
    return { providerMessageId: `log-${request.idempotencyKey}`, status: "accepted" };
  }
  ack() { return new Response(null, { status: 204 }); }
}
