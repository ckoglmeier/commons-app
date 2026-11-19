import { createHmac, timingSafeEqual } from "node:crypto";

/*
 * Payment provider adapter for the first-invite fee. Test mode only: live mode needs a separately authorized change,
 * including the database's trip_activation_test_mode check. Configured from the runtime environment, so it works on
 * loopback and hosted Preview. A redirect is never evidence; only a signed event is.
 */

export const TRIP_FEE_CENTS = 2000;

export type ActivationProviderConfig = {
  secretKey: string;
  webhookSecret: string;
  origin: string;
  apiBase: string;
  checkoutOrigin: string;
  /** A reviewed Stripe product tax code. Unset: no automatic tax, and tax stays unknown rather than zero. */
  taxCode: string | null;
};

export type CheckoutReference = { draftId: string; organizerId: string; attemptId: string };
export type CheckoutStatus = "open" | "complete" | "expired";

export type ProviderEvent =
  | { kind: "payment_succeeded"; eventId: string; sessionId: string; paymentIntentId: string; amountCents: number; currency: "USD"; taxAmountCents: number | null; reference: CheckoutReference }
  | { kind: "payment_processing"; eventId: string; sessionId: string; reference: CheckoutReference }
  | { kind: "checkout_ended"; eventId: string; sessionId: string; failureCode: "expired" | "async_failed" }
  | { kind: "refund"; eventId: string; refundId: string; paymentIntentId: string; amountCents: number; status: "pending" | "succeeded" | "failed" | "canceled"; eventCreatedAt: Date }
  | { kind: "ignored"; eventId: string };

export class ActivationProviderUnavailableError extends Error {
  constructor(message = "Checkout isn’t available right now. Your trip is saved.") { super(message); this.name = "ActivationProviderUnavailableError"; }
}
export class ProviderEvidenceError extends Error {
  constructor(message: string) { super(message); this.name = "ProviderEvidenceError"; }
}

type Environment = { [name: string]: unknown };

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const isLoopback = (hostname: string) => hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";

/** The $20 path runs only where a test provider is configured. Without it new trips have no fee, and nothing claims one. Production always refuses for now. */
export function betaActivationEnabled(environment: Environment = process.env) {
  return environment.VERCEL_ENV !== "production" && text(environment.STRIPE_TEST_SECRET_KEY).startsWith("sk_test_") && text(environment.STRIPE_TEST_WEBHOOK_SECRET).startsWith("whsec_");
}

/** Null means checkout is unavailable and the gate simply stays closed. Production always refuses for now. */
export function readActivationProviderConfig(environment: Environment, origin: string): ActivationProviderConfig | null {
  if (environment.VERCEL_ENV === "production") return null;
  const secretKey = text(environment.STRIPE_TEST_SECRET_KEY), webhookSecret = text(environment.STRIPE_TEST_WEBHOOK_SECRET);
  if (!secretKey.startsWith("sk_test_") || !webhookSecret.startsWith("whsec_")) return null;
  const site = new URL(origin);
  if (site.protocol !== "https:" && !(site.protocol === "http:" && isLoopback(site.hostname))) return null;
  const apiBase = text(environment.STRIPE_TEST_API_BASE) || "https://api.stripe.com";
  const base = new URL(apiBase);
  const fake = apiBase !== "https://api.stripe.com";
  // An injected API base is for a local fake only. A hosted deployment always talks to Stripe.
  if (fake && (environment.VERCEL || environment.VERCEL_ENV || !isLoopback(base.hostname))) return null;
  const taxCode = text(environment.STRIPE_TEST_PRODUCT_TAX_CODE);
  if (taxCode && !/^txcd_\d{8}$/.test(taxCode)) return null;
  return { secretKey, webhookSecret, origin: site.origin, apiBase: base.origin, checkoutOrigin: fake ? base.origin : "https://checkout.stripe.com", taxCode: taxCode || null };
}

function assertReference(reference: CheckoutReference) {
  for (const value of Object.values(reference)) if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new ProviderEvidenceError("Invalid checkout reference.");
}

function matchesReference(session: Record<string, unknown>, reference: CheckoutReference) {
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;
  return session.client_reference_id === reference.draftId && metadata.draftId === reference.draftId
    && metadata.organizerId === reference.organizerId && metadata.attemptId === reference.attemptId;
}

export async function createCheckoutSession(config: ActivationProviderConfig, reference: CheckoutReference, request: typeof fetch = fetch): Promise<{ id: string; url: string }> {
  assertReference(reference);
  // One return address for every attempt: the provider's idempotency check compares these parameters.
  const back = (state: string) => `${config.origin}/new?draft=${reference.draftId}&checkout=${state}`;
  const form = new URLSearchParams({
    mode: "payment",
    success_url: back("returned"),
    cancel_url: back("cancelled"),
    client_reference_id: reference.draftId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(TRIP_FEE_CENTS),
    "line_items[0][price_data][product_data][name]": "Commons trip",
    "metadata[draftId]": reference.draftId,
    "metadata[organizerId]": reference.organizerId,
    "metadata[attemptId]": reference.attemptId,
  });
  if (config.taxCode) {
    form.set("automatic_tax[enabled]", "true");
    form.set("billing_address_collection", "required");
    form.set("line_items[0][price_data][tax_behavior]", "inclusive");
    form.set("line_items[0][price_data][product_data][tax_code]", config.taxCode);
  }
  let response: Response;
  try {
    response = await request(`${config.apiBase}/v1/checkout/sessions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `commons-trip-${reference.attemptId}` },
      body: form, signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new ActivationProviderUnavailableError(); }
  if (!response.ok) throw new ActivationProviderUnavailableError();
  const session = await response.json() as Record<string, unknown>;
  if (session.livemode !== false || typeof session.id !== "string" || !session.id.startsWith("cs_test_")
    || typeof session.url !== "string" || new URL(session.url).origin !== config.checkoutOrigin || !matchesReference(session, reference)) {
    throw new ProviderEvidenceError("Unexpected test checkout response.");
  }
  return { id: session.id, url: session.url };
}

/** Reuse open sessions. Only a provider-confirmed expired, unpaid session may be replaced. */
export async function readCheckoutStatus(config: ActivationProviderConfig, reference: CheckoutReference & { sessionId: string }, request: typeof fetch = fetch): Promise<CheckoutStatus> {
  const { sessionId, ...expected } = reference;
  assertReference(expected);
  if (!sessionId.startsWith("cs_test_")) throw new ProviderEvidenceError("Invalid test session.");
  let response: Response;
  try {
    response = await request(`${config.apiBase}/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${config.secretKey}` }, signal: AbortSignal.timeout(15_000) });
  } catch { throw new ActivationProviderUnavailableError(); }
  if (!response.ok) throw new ActivationProviderUnavailableError();
  const session = await response.json() as Record<string, unknown>;
  if (session.id !== sessionId || session.livemode !== false || session.mode !== "payment" || session.amount_total !== TRIP_FEE_CENTS || session.currency !== "usd"
    || !matchesReference(session, expected) || !["open", "complete", "expired"].includes(String(session.status))) throw new ProviderEvidenceError("Unexpected test checkout status.");
  if (session.status === "expired" && session.payment_status !== "unpaid") throw new ProviderEvidenceError("Payment needs reconciliation.");
  return session.status as CheckoutStatus;
}

/** Verify the raw body before parsing. */
export function verifyWebhookSignature(config: ActivationProviderConfig, raw: string, signature: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (raw.length > 256_000) throw new ProviderEvidenceError("Webhook body too large.");
  const parts = signature.split(",").map(part => part.trim().split("="));
  const times = parts.filter(([key]) => key === "t");
  const timestamp = times.length === 1 ? Number(times[0][1]) : NaN;
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) throw new ProviderEvidenceError("Expired or invalid webhook signature.");
  const digest = createHmac("sha256", config.webhookSecret).update(`${timestamp}.${raw}`).digest();
  const valid = parts.some(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/.test(value ?? "") && timingSafeEqual(digest, Buffer.from(value, "hex")));
  if (!valid) throw new ProviderEvidenceError("Invalid webhook signature.");
  return JSON.parse(raw) as Record<string, unknown>;
}

const SESSION_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"]);
const REFUND_EVENTS = new Set(["refund.created", "refund.updated", "refund.failed"]);

/** Turn a signature-verified event into typed evidence. Anything malformed or off-amount is refused, never recorded. */
export function interpretProviderEvent(config: ActivationProviderConfig, event: Record<string, unknown>): ProviderEvent {
  if (event.livemode !== false || typeof event.id !== "string" || !event.id.startsWith("evt_")) throw new ProviderEvidenceError("Only test-mode events are accepted.");
  const eventId = event.id, type = String(event.type);
  const object = ((event.data as { object?: Record<string, unknown> } | undefined)?.object ?? {}) as Record<string, unknown>;
  if (REFUND_EVENTS.has(type)) {
    const status = String(object.status);
    const created = Number(event.created);
    if (object.object !== "refund" || typeof object.id !== "string" || !/^re_[a-zA-Z0-9_]+$/.test(object.id)
      || typeof object.payment_intent !== "string" || !/^pi_[a-zA-Z0-9_]+$/.test(object.payment_intent) || object.currency !== "usd"
      || !Number.isSafeInteger(object.amount) || (object.amount as number) <= 0 || (object.amount as number) > TRIP_FEE_CENTS
      || !Number.isSafeInteger(created)) throw new ProviderEvidenceError("Invalid test refund evidence.");
    const mapped = status === "succeeded" ? "succeeded" as const : status === "failed" ? "failed" as const : status === "canceled" ? "canceled" as const
      : status === "pending" || status === "requires_action" ? "pending" as const : null;
    if (!mapped) throw new ProviderEvidenceError("Unknown refund status.");
    return { kind: "refund", eventId, refundId: object.id, paymentIntentId: object.payment_intent, amountCents: object.amount as number, status: mapped, eventCreatedAt: new Date(created * 1000) };
  }
  if (!SESSION_EVENTS.has(type)) return { kind: "ignored", eventId };
  if (typeof object.id !== "string" || !object.id.startsWith("cs_test_") || object.livemode !== false || object.mode !== "payment") throw new ProviderEvidenceError("Invalid test session evidence.");
  const sessionId = object.id;
  // Another checkout on the same provider account. Acknowledge it, so the endpoint stays healthy, and record nothing.
  if (!((object.metadata ?? {}) as Record<string, unknown>).draftId) return { kind: "ignored", eventId };
  if (type === "checkout.session.expired") {
    if (object.payment_status !== "unpaid") throw new ProviderEvidenceError("Expired session reports a payment.");
    return { kind: "checkout_ended", eventId, sessionId, failureCode: "expired" };
  }
  if (type === "checkout.session.async_payment_failed") return { kind: "checkout_ended", eventId, sessionId, failureCode: "async_failed" };
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  const reference: CheckoutReference = { draftId: String(object.client_reference_id), organizerId: String(metadata.organizerId), attemptId: String(metadata.attemptId) };
  assertReference(reference);
  if (metadata.draftId !== reference.draftId) throw new ProviderEvidenceError("Payment does not match this trip checkout.");
  if (object.amount_total !== TRIP_FEE_CENTS || object.currency !== "usd") throw new ProviderEvidenceError("Payment amount does not match the trip fee.");
  const details = (object.total_details ?? {}) as Record<string, unknown>;
  if ((details.amount_discount ?? 0) !== 0 || (details.amount_shipping ?? 0) !== 0) throw new ProviderEvidenceError("Payment total does not match the trip fee.");
  if (object.payment_status !== "paid") {
    if (type === "checkout.session.completed" && object.payment_status === "unpaid") return { kind: "payment_processing", eventId, sessionId, reference };
    throw new ProviderEvidenceError("Payment is not confirmed.");
  }
  if (typeof object.payment_intent !== "string" || !/^pi_[a-zA-Z0-9_]+$/.test(object.payment_intent)) throw new ProviderEvidenceError("Payment receipt is incomplete.");
  const automaticTax = (object.automatic_tax ?? {}) as Record<string, unknown>;
  let taxAmountCents: number | null = null;
  if (config.taxCode) {
    // Tax was requested, so its evidence is required. Unconfigured tax stays unknown, never a fabricated zero.
    const tax = details.amount_tax;
    if (automaticTax.enabled !== true || automaticTax.status !== "complete" || !Number.isSafeInteger(tax) || (tax as number) < 0 || (tax as number) > TRIP_FEE_CENTS) throw new ProviderEvidenceError("Payment tax calculation is incomplete.");
    taxAmountCents = tax as number;
  }
  return { kind: "payment_succeeded", eventId, sessionId, paymentIntentId: object.payment_intent, amountCents: TRIP_FEE_CENTS, currency: "USD", taxAmountCents, reference };
}
