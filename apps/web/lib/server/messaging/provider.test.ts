import test from "node:test";
import assert from "node:assert/strict";
import { FakeProvider, signFakeBody } from "./fake-provider";
import { ProviderSendError, sendGate, unconfiguredProvider } from "./provider";
import { TwilioProvider, twilioSignature, type FetchLike } from "./twilio-provider";

/* Adapter shape only. No Twilio account exists and no request here leaves the process: the Twilio adapter is driven with an injected fetch. */

test("Twilio request signing matches the published example", () => {
  const params = new URLSearchParams({ Digits: "1234", To: "+18005551212", From: "+14158675310", Caller: "+14158675310", CallSid: "CA1234567890ABCDE" });
  assert.equal(twilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", params), "GvWf1cFY/Q7PnoempGyD5oXAezc=");
});

test("the Twilio adapter verifies signatures over the exact URL and body, and parses inbound texts, media and receipts", () => {
  const provider = new TwilioProvider({ accountSid: "ACsynthetic", authToken: "synthetic-token", messagingServiceSid: "MGsynthetic" });
  const raw = new URLSearchParams({ MessageSid: "SM1", From: "+14155550101", To: "+14155550199", Body: "yes", NumMedia: "1", MediaUrl0: "https://api.twilio.com/media/1", MediaContentType0: "image/png" }).toString();
  const url = "https://commons.test/api/v1/messaging/inbound";
  const signature = twilioSignature("synthetic-token", url, new URLSearchParams(raw));
  assert.equal(provider.verifyWebhook({ url, headers: new Headers({ "x-twilio-signature": signature }), rawBody: raw }), true);
  assert.equal(provider.verifyWebhook({ url: "https://evil.test/api/v1/messaging/inbound", headers: new Headers({ "x-twilio-signature": signature }), rawBody: raw }), false);
  assert.equal(provider.verifyWebhook({ url, headers: new Headers({ "x-twilio-signature": signature }), rawBody: raw.replace("yes", "no") }), false);
  assert.equal(provider.verifyWebhook({ url, headers: new Headers(), rawBody: raw }), false);
  assert.equal(new TwilioProvider({}).verifyWebhook({ url, headers: new Headers({ "x-twilio-signature": signature }), rawBody: raw }), false, "without a token nothing verifies");
  const inbound = provider.parseInbound(raw)!;
  assert.deepEqual([inbound.providerMessageId, inbound.from, inbound.body, inbound.media.length], ["SM1", "+14155550101", "yes", 1]);
  assert.equal(provider.parseInbound(new URLSearchParams({ MessageSid: "SM1", MessageStatus: "delivered", From: "+1" }).toString()), null, "a receipt is not an inbound text");
  assert.deepEqual(provider.parseStatus(new URLSearchParams({ MessageSid: "SM2", MessageStatus: "undelivered", ErrorCode: "30003" }).toString()), { eventKey: "SM2:undelivered", providerMessageId: "SM2", status: "undelivered", errorCode: "30003" });
  assert.equal(provider.parseStatus(new URLSearchParams({ MessageSid: "SM2", MessageStatus: "queued" }).toString()), null);
});

const failure = async (attempt: Promise<unknown>) => { const error = await attempt.then(() => null, (cause: unknown) => cause); assert.ok(error instanceof ProviderSendError, "expected a ProviderSendError"); return error; };

test("the Twilio adapter refuses to send without credentials and classifies failures", async () => {
  const none = new TwilioProvider({});
  assert.equal(none.sendReadiness().ready, false);
  await assert.rejects(none.send({ to: "+14155550101", body: "x", idempotencyKey: "k" }), (error: unknown) => error instanceof ProviderSendError && error.code === "provider_not_configured" && !error.retryable);

  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const respond = (status: number, body: unknown): FetchLike => async (url, init) => { calls.push({ url, body: init.body, headers: init.headers }); return { status, text: async () => JSON.stringify(body) }; };
  const config = { accountSid: "ACsynthetic", authToken: "synthetic-token", messagingServiceSid: "MGsynthetic" };
  const ok = await new TwilioProvider(config, respond(201, { sid: "SM9", status: "queued" })).send({ to: "+14155550101", body: "hello", idempotencyKey: "k" });
  assert.deepEqual(ok, { providerMessageId: "SM9", status: "accepted" });
  assert.match(calls[0]!.url, /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/ACsynthetic\/Messages\.json$/);
  assert.match(calls[0]!.body, /MessagingServiceSid=MGsynthetic/);
  assert.match(calls[0]!.headers.authorization!, /^Basic /);
  const rate = await failure(new TwilioProvider(config, respond(429, { code: 20429 })).send({ to: "+1", body: "x", idempotencyKey: "k" }));
  assert.equal(rate.retryable, true);
  const bad = await failure(new TwilioProvider(config, respond(400, { code: 21211 })).send({ to: "+1", body: "x", idempotencyKey: "k" }));
  assert.equal(bad.retryable, false); assert.equal(bad.code, "21211");
  const server = await failure(new TwilioProvider(config, respond(503, {})).send({ to: "+1", body: "x", idempotencyKey: "k" }));
  assert.equal(server.retryable, true);
  const timeout = await failure(new TwilioProvider(config, async () => { throw new Error("timeout"); }).send({ to: "+1", body: "x", idempotencyKey: "k" }));
  assert.equal(timeout.unknownOutcome, true); assert.equal(timeout.retryable, false);
  await assert.rejects(new TwilioProvider(config).fetchMedia!({ url: "https://evil.test/x.png", contentType: "image/png" }), /media_host_not_allowed/);
});

test("the send gate keeps a real provider silent unless explicitly configured, and lets only the allowlist through", () => {
  const complete = new TwilioProvider({ accountSid: "ACsynthetic", authToken: "t", messagingServiceSid: "MGsynthetic" });
  assert.equal(sendGate(complete, "+14155550101", {}).allowed, false, "default send mode is disabled");
  assert.deepEqual(sendGate(complete, "+14155550101", { COMMONS_SMS_SEND_MODE: "disabled" }), { allowed: false, reason: "send_disabled" });
  assert.equal(sendGate(new TwilioProvider({}), "+14155550101", { COMMONS_SMS_SEND_MODE: "live" }).allowed, false, "incomplete credentials never send");
  assert.deepEqual(sendGate(complete, "+14155550102", { COMMONS_SMS_SEND_MODE: "allowlist", COMMONS_SMS_RECIPIENT_ALLOWLIST: "+14155550101" }), { allowed: false, reason: "not_allowlisted" });
  assert.equal(sendGate(complete, "+14155550101", { COMMONS_SMS_SEND_MODE: "allowlist", COMMONS_SMS_RECIPIENT_ALLOWLIST: "+14155550101, +14155550103" }).allowed, true);
  assert.equal(sendGate(unconfiguredProvider, "+14155550101", { COMMONS_SMS_SEND_MODE: "live" }).allowed, false);
  assert.equal(sendGate(new FakeProvider(), "+14155550101", {}).allowed, true, "the synthetic provider cannot reach anyone");
});

test("the fake provider signs and verifies like a real one and records what it was asked to send", async () => {
  const provider = new FakeProvider();
  const request = provider.inboundRequest({ id: "A1", from: "+14155550101", body: "hi" });
  const raw = await request.text();
  assert.equal(provider.verifyWebhook({ url: request.url, headers: request.headers, rawBody: raw }), true);
  assert.equal(provider.verifyWebhook({ url: request.url, headers: new Headers({ "x-fake-signature": signFakeBody(raw, "other") }), rawBody: raw }), false);
  assert.equal(provider.synthetic, true);
  await provider.send({ to: "+14155550101", body: "hello", idempotencyKey: "k" });
  assert.equal(provider.outbox.length, 1);
});
