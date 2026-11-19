import { applyStatusCallback, claimWebhookEvent, finishWebhookEvent, normalizeE164, recordInbound, resolveVerifiedPerson, touchPhone } from "@commons/database";
import { sanitizeInbound } from "@commons/domain";
import { dbOptions, messagingDeps } from "./core";
import { dispatchOutbox } from "./dispatch";
import { processInbound } from "./inbound";

const warn = (name: string, detail: Record<string, unknown>) => console.warn(name, detail);

function webhookUrl(request: Request) {
  const origin = process.env.COMMONS_SMS_WEBHOOK_ORIGIN;
  const url = new URL(request.url);
  return origin ? `${new URL(origin).origin}${url.pathname}${url.search}` : request.url;
}

/**
 * An inbound text. A forged or unsigned request is rejected before it creates any record, and a redelivery of the same provider event does nothing
 * the second time. The message is stored first; acting on it is a separate step, so a crash between the two is picked up by the scheduled pass.
 */
export async function receiveInbound(request: Request): Promise<Response> {
  const deps = await messagingDeps(), raw = await request.text();
  if (!deps.provider.verifyWebhook({ url: webhookUrl(request), headers: request.headers, rawBody: raw })) {
    warn("commons.messaging.webhook_rejected", { provider: deps.provider.name, kind: "inbound", reason: "bad_signature" });
    return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const inbound = deps.provider.parseInbound(raw, request.headers);
  if (!inbound) return Response.json({ error: { code: "malformed" } }, { status: 400 });
  const claim = await claimWebhookEvent({ provider: deps.provider.name, eventKey: inbound.providerMessageId, kind: "inbound" }, dbOptions(deps));
  if (claim.duplicate) return deps.provider.ack();
  let e164: string;
  try { e164 = normalizeE164(inbound.from); } catch { await finishWebhookEvent(claim.eventId!, "ignored_bad_number", null, dbOptions(deps)); return deps.provider.ack(); }
  const known = await resolveVerifiedPerson(e164, dbOptions(deps));
  await touchPhone(e164, { inbound: true }, dbOptions(deps));
  const recorded = await recordInbound({ provider: deps.provider.name, providerMessageId: inbound.providerMessageId, e164, personId: known?.personId ?? null, body: sanitizeInbound(inbound.body, 4000), media: inbound.media.slice(0, 5) }, dbOptions(deps));
  await finishWebhookEvent(claim.eventId!, "received", recorded.message.id, dbOptions(deps));
  try { await processInbound(deps, recorded.message.id); } catch (error) { warn("commons.messaging.inbound_failed", { messageId: recorded.message.id, error: error instanceof Error ? error.name : "unknown" }); }
  try { await dispatchOutbox(deps); } catch (error) { warn("commons.messaging.dispatch_failed", { error: error instanceof Error ? error.name : "unknown" }); }
  return deps.provider.ack();
}

/** A delivery receipt. Deduplicated by the provider's event key; a repeated or out-of-order receipt never moves a message backwards. */
export async function receiveStatus(request: Request): Promise<Response> {
  const deps = await messagingDeps(), raw = await request.text();
  if (!deps.provider.verifyWebhook({ url: webhookUrl(request), headers: request.headers, rawBody: raw })) {
    warn("commons.messaging.webhook_rejected", { provider: deps.provider.name, kind: "status", reason: "bad_signature" });
    return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const event = deps.provider.parseStatus(raw, request.headers);
  if (!event) return deps.provider.ack();
  const claim = await claimWebhookEvent({ provider: deps.provider.name, eventKey: event.eventKey, kind: "status" }, dbOptions(deps));
  if (claim.duplicate) return deps.provider.ack();
  const applied = await applyStatusCallback({ provider: deps.provider.name, providerMessageId: event.providerMessageId, status: event.status, errorCode: event.errorCode }, dbOptions(deps));
  await finishWebhookEvent(claim.eventId!, applied.found ? (applied.changed ? "applied" : "no_change") : "unknown_message", null, dbOptions(deps));
  if (["undelivered", "failed"].includes(event.status)) warn("commons.messaging.delivery_failed", { provider: deps.provider.name, status: event.status, code: event.errorCode });
  return deps.provider.ack();
}
