import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  betaActivationEnabled, createCheckoutSession, interpretProviderEvent, ProviderEvidenceError, readActivationProviderConfig, readCheckoutStatus, verifyWebhookSignature,
  type ActivationProviderConfig,
} from "./provider";

const secrets = { STRIPE_TEST_SECRET_KEY: "sk_test_synthetic", STRIPE_TEST_WEBHOOK_SECRET: "whsec_synthetic" };
const config = readActivationProviderConfig(secrets, "https://preview.example.test")!;
const taxed: ActivationProviderConfig = { ...config, taxCode: "txcd_10000000" };
const reference = { draftId: "11111111-1111-4111-8111-111111111111", organizerId: "22222222-2222-4222-8222-222222222222", attemptId: "33333333-3333-4333-8333-333333333333" };

function session(overrides: Record<string, unknown> = {}) {
  return { id: "cs_test_1", object: "checkout.session", livemode: false, mode: "payment", status: "complete", payment_status: "paid", amount_total: 2000, currency: "usd", payment_intent: "pi_1", client_reference_id: reference.draftId,
    metadata: { draftId: reference.draftId, organizerId: reference.organizerId, attemptId: reference.attemptId }, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }, automatic_tax: { enabled: false, status: null }, ...overrides };
}
const event = (type: string, object: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({ id: "evt_1", type, livemode: false, created: 1_800_000_000, data: { object }, ...overrides });

test("payments run only with test keys, and never in production", () => {
  assert.equal(betaActivationEnabled({}), false);
  assert.equal(betaActivationEnabled({ STRIPE_TEST_SECRET_KEY: "sk_live_x", STRIPE_TEST_WEBHOOK_SECRET: "whsec_x" }), false);
  assert.equal(betaActivationEnabled(secrets), true);
  assert.equal(betaActivationEnabled({ ...secrets, VERCEL_ENV: "production" }), false);
});

test("config refuses production, live keys, plain http off loopback, and a fake API on a hosted deployment", () => {
  assert.ok(readActivationProviderConfig({ ...secrets, VERCEL_ENV: "preview", VERCEL: "1" }, "https://preview.example.test"), "hosted Preview works");
  assert.ok(readActivationProviderConfig(secrets, "http://127.0.0.1:4310"), "loopback works on any port");
  assert.equal(readActivationProviderConfig({ ...secrets, VERCEL_ENV: "production" }, "https://commons.travel"), null);
  assert.equal(readActivationProviderConfig({ ...secrets, STRIPE_TEST_SECRET_KEY: "sk_live_x" }, "https://preview.example.test"), null);
  assert.equal(readActivationProviderConfig({ ...secrets, STRIPE_TEST_WEBHOOK_SECRET: "nope" }, "https://preview.example.test"), null);
  assert.equal(readActivationProviderConfig(secrets, "http://example.test"), null);
  assert.equal(readActivationProviderConfig({ ...secrets, STRIPE_TEST_API_BASE: "http://127.0.0.1:9", VERCEL_ENV: "preview" }, "https://preview.example.test"), null);
  assert.equal(readActivationProviderConfig({ ...secrets, STRIPE_TEST_API_BASE: "https://evil.example" }, "https://preview.example.test"), null);
  assert.equal(readActivationProviderConfig({ ...secrets, STRIPE_TEST_PRODUCT_TAX_CODE: "general" }, "https://preview.example.test"), null);
  const fake = readActivationProviderConfig({ ...secrets, STRIPE_TEST_API_BASE: "http://127.0.0.1:4311" }, "http://127.0.0.1:4310")!;
  assert.equal(fake.checkoutOrigin, "http://127.0.0.1:4311");
});

test("checkout uses the attempt as its idempotency key and refuses a live or foreign response", async () => {
  let key: string | null = null, body = "";
  const request = async (_url: unknown, init?: RequestInit) => {
    key = new Headers(init?.headers).get("idempotency-key"); body = String(init?.body);
    return Response.json({ id: "cs_test_1", livemode: false, url: "https://checkout.stripe.com/c/pay", client_reference_id: reference.draftId, metadata: { ...reference } });
  };
  const created = await createCheckoutSession(config, reference, request as typeof fetch);
  assert.equal(created.id, "cs_test_1");
  assert.equal(key, `commons-trip-${reference.attemptId}`);
  const form = new URLSearchParams(body);
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "2000");
  assert.equal(form.get("automatic_tax[enabled]"), null, "no tax code configured means no tax claim");
  assert.ok(!body.includes("brief"));
  const taxedForm: URLSearchParams[] = [];
  await createCheckoutSession(taxed, reference, (async (_url: unknown, init?: RequestInit) => { taxedForm.push(new URLSearchParams(String(init?.body))); return request(_url, init); }) as typeof fetch);
  assert.equal(taxedForm[0].get("line_items[0][price_data][tax_behavior]"), "inclusive");
  for (const bad of [{ livemode: true }, { url: "https://evil.example/pay" }, { id: "cs_live_1" }, { metadata: { ...reference, organizerId: "x" } }]) {
    await assert.rejects(createCheckoutSession(config, reference, (async () => Response.json({ id: "cs_test_1", livemode: false, url: "https://checkout.stripe.com/c/pay", client_reference_id: reference.draftId, metadata: { ...reference }, ...bad })) as typeof fetch), ProviderEvidenceError);
  }
  await assert.rejects(createCheckoutSession(config, reference, (async () => new Response("no", { status: 500 })) as typeof fetch), /Your trip is saved/);
});

test("session status accepts only a matching session and won't replace an expired paid one", async () => {
  const read = (object: Record<string, unknown>) => readCheckoutStatus(config, { ...reference, sessionId: "cs_test_1" }, (async () => Response.json(object)) as typeof fetch);
  assert.equal(await read(session({ status: "open", payment_status: "unpaid" })), "open");
  assert.equal(await read(session({ status: "expired", payment_status: "unpaid" })), "expired");
  await assert.rejects(read(session({ status: "expired", payment_status: "paid" })), /reconciliation/);
  await assert.rejects(read(session({ amount_total: 500 })), ProviderEvidenceError);
  await assert.rejects(read(session({ metadata: { ...reference, attemptId: "other" } })), ProviderEvidenceError);
});

test("webhook signatures: valid, tampered, wrong secret and stale", () => {
  const raw = JSON.stringify(event("checkout.session.completed", session()));
  const now = 1_800_000_000;
  const sign = (body: string, at: number, secret = config.webhookSecret) => `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${body}`).digest("hex")}`;
  assert.equal(verifyWebhookSignature(config, raw, sign(raw, now), now).id, "evt_1");
  assert.throws(() => verifyWebhookSignature(config, `${raw} `, sign(raw, now), now), ProviderEvidenceError);
  assert.throws(() => verifyWebhookSignature(config, raw, sign(raw, now, "whsec_other"), now), ProviderEvidenceError);
  assert.throws(() => verifyWebhookSignature(config, raw, sign(raw, now - 301), now), ProviderEvidenceError);
  assert.throws(() => verifyWebhookSignature(config, raw, "", now), ProviderEvidenceError);
});

test("payment evidence: amount, currency, discount, live mode and malformed references are refused", () => {
  const ok = interpretProviderEvent(config, event("checkout.session.completed", session()));
  assert.equal(ok.kind, "payment_succeeded");
  if (ok.kind === "payment_succeeded") assert.equal(ok.taxAmountCents, null, "tax not configured stays unknown, not zero");
  for (const bad of [{ amount_total: 1999 }, { currency: "eur" }, { total_details: { amount_discount: 100, amount_shipping: 0 } }, { livemode: true }, { client_reference_id: "bad value!" }, { metadata: { draftId: "other", organizerId: "o", attemptId: "a" } }, { payment_intent: null }]) {
    assert.throws(() => interpretProviderEvent(config, event("checkout.session.completed", session(bad))), ProviderEvidenceError, JSON.stringify(bad));
  }
  assert.throws(() => interpretProviderEvent(config, event("checkout.session.completed", session(), { livemode: true })), ProviderEvidenceError);
});

test("tax evidence is required only when tax was requested, and recorded exactly", () => {
  const complete = interpretProviderEvent(taxed, event("checkout.session.completed", session({ automatic_tax: { enabled: true, status: "complete" }, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 137 } })));
  assert.equal(complete.kind === "payment_succeeded" && complete.taxAmountCents, 137);
  assert.throws(() => interpretProviderEvent(taxed, event("checkout.session.completed", session())), /tax calculation/);
  assert.throws(() => interpretProviderEvent(taxed, event("checkout.session.completed", session({ automatic_tax: { enabled: true, status: "requires_location_inputs" } }))), /tax calculation/);
});

test("pending, async, expiry and refund events map to truthful evidence", () => {
  assert.equal(interpretProviderEvent(config, event("checkout.session.completed", session({ payment_status: "unpaid" }))).kind, "payment_processing");
  assert.equal(interpretProviderEvent(config, event("checkout.session.async_payment_succeeded", session())).kind, "payment_succeeded");
  const failed = interpretProviderEvent(config, event("checkout.session.async_payment_failed", session({ payment_status: "unpaid" })));
  assert.equal(failed.kind === "checkout_ended" && failed.failureCode, "async_failed");
  assert.equal(interpretProviderEvent(config, event("checkout.session.expired", session({ status: "expired", payment_status: "unpaid" }))).kind, "checkout_ended");
  assert.throws(() => interpretProviderEvent(config, event("checkout.session.expired", session({ payment_status: "paid" }))), ProviderEvidenceError);
  const refund = (overrides: Record<string, unknown> = {}) => ({ object: "refund", id: "re_1", payment_intent: "pi_1", amount: 500, currency: "usd", status: "succeeded", ...overrides });
  const mapped = interpretProviderEvent(config, event("refund.updated", refund()));
  assert.equal(mapped.kind === "refund" && mapped.status, "succeeded");
  assert.equal(mapped.kind === "refund" && mapped.eventCreatedAt.getTime(), 1_800_000_000_000);
  assert.equal(interpretProviderEvent(config, event("refund.failed", refund({ status: "failed" }))).kind, "refund");
  for (const bad of [{ amount: 2001 }, { currency: "eur" }, { id: "x" }, { status: "mystery" }]) assert.throws(() => interpretProviderEvent(config, event("refund.updated", refund(bad))), ProviderEvidenceError);
  assert.equal(interpretProviderEvent(config, event("customer.created", {})).kind, "ignored");
  assert.equal(interpretProviderEvent(config, event("checkout.session.completed", session({ metadata: {}, client_reference_id: null }))).kind, "ignored", "another checkout on the account is acknowledged, never recorded");
});
