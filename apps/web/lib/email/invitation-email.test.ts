import assert from "node:assert/strict";
import test from "node:test";
import { renderCommonsInvitationEmail } from "./invitation-email";
import { assertEmailDeliveryAllowed, EmailDeliveryError, sendEmail } from "./resend";

const input = {
  recipientName: "Taylor",
  recipientEmail: "TAYLOR@example.com",
  inviterName: "Casey",
  tripName: "Desert Weekend",
  tripDates: "October 9–12, 2027",
  tripLocation: "Santa Fe, New Mexico",
  tripUrl: "https://commons.example/c/10000000-0000-4000-8000-000000000002",
  personalMessage: "Can’t wait to plan this together.",
};

test("renders a trip-first invitation with HTML and text fallbacks", () => {
  const rendered = renderCommonsInvitationEmail(input);
  assert.equal(rendered.subject, "Casey invited you to Desert Weekend");
  assert.match(rendered.html, /Desert Weekend/);
  assert.match(rendered.html, /October 9–12, 2027/);
  assert.match(rendered.html, /Open Desert Weekend/);
  assert.match(rendered.html, /taylor@example\.com/);
  assert.match(rendered.html, /Can’t wait to plan this together\./);
  assert.match(rendered.text, /Casey invited you/);
  assert.match(rendered.text, /Can’t wait to plan this together\./);
  assert.doesNotMatch(rendered.html, /AI-powered|effortless|magic/i);
});

test("escapes participant-provided values", () => {
  const rendered = renderCommonsInvitationEmail({
    ...input,
    tripName: "Cape <script>alert(1)</script>",
    personalMessage: "Please bring <script>alert(2)</script>",
  });
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;/);
});

test("rejects non-web invitation links", () => {
  assert.throws(
    () => renderCommonsInvitationEmail({ ...input, tripUrl: "javascript:alert(1)" }),
    /HTTP or HTTPS/,
  );
});

test("email delivery is disabled unless explicitly enabled", () => {
  const previousMode = process.env.COMMONS_EMAIL_SEND_MODE;
  process.env.COMMONS_EMAIL_SEND_MODE = "disabled";
  assert.throws(() => assertEmailDeliveryAllowed("max@example.com"), /disabled/);
  if (previousMode === undefined) delete process.env.COMMONS_EMAIL_SEND_MODE;
  else process.env.COMMONS_EMAIL_SEND_MODE = previousMode;
});

function withEmailEnvironment(values: Record<string, string | undefined>, run: () => Promise<void> | void) {
  const names = ["COMMONS_EMAIL_SEND_MODE", "RESEND_API_KEY", "COMMONS_EMAIL_FROM", "NODE_ENV"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const env = process.env as Record<string, string | undefined>;
  for (const name of names) { if (values[name] === undefined) delete env[name]; else env[name] = values[name]; }
  const restore = () => { for (const name of names) { if (previous[name] === undefined) delete env[name]; else env[name] = previous[name]; } };
  try { const result = run(); if (result) return result.finally(restore); restore(); } catch (error) { restore(); throw error; }
}

test("delivery failures expose stable recovery codes", () => {
  withEmailEnvironment({ COMMONS_EMAIL_SEND_MODE: "disabled" }, () => assert.throws(
    () => assertEmailDeliveryAllowed("max@example.com"),
    (error) => error instanceof EmailDeliveryError && error.code === "delivery_disabled",
  ));
});

test("the default mode is live when Resend is configured, log in development, and disabled otherwise", () => {
  withEmailEnvironment({ RESEND_API_KEY: "re_test", COMMONS_EMAIL_FROM: "Commons <a@commons.test>", NODE_ENV: "production" }, () => assert.doesNotThrow(() => assertEmailDeliveryAllowed("max@example.com")));
  withEmailEnvironment({ NODE_ENV: "development" }, () => assert.doesNotThrow(() => assertEmailDeliveryAllowed("max@example.com")));
  withEmailEnvironment({ NODE_ENV: "production" }, () => assert.throws(() => assertEmailDeliveryAllowed("max@example.com"), /disabled/));
  withEmailEnvironment({ NODE_ENV: "development", COMMONS_EMAIL_SEND_MODE: "disabled" }, () => assert.throws(() => assertEmailDeliveryAllowed("max@example.com"), /disabled/));
});

test("log mode prints the message to the console and never touches the network", async () => {
  const originalFetch = globalThis.fetch, originalInfo = console.info;
  const logged: unknown[][] = [];
  globalThis.fetch = async () => { throw new Error("log mode must not use the network"); };
  console.info = (...args: unknown[]) => { logged.push(args); };
  try {
    await withEmailEnvironment({ COMMONS_EMAIL_SEND_MODE: "log" }, async () => {
      const result = await sendEmail({ ...renderCommonsInvitationEmail(input), to: input.recipientEmail, idempotencyKey: "commons-invite-log-1" });
      assert.equal(result.id, "logged-commons-invite-log-1");
    });
  } finally { globalThis.fetch = originalFetch; console.info = originalInfo; }
  assert.equal(logged[0]?.[0], "commons.email.logged");
  assert.match(JSON.stringify(logged[0]?.[1]), /Desert Weekend/);
});

test("sends through the provider with a stable idempotency key", async () => {
  const previous = {
    mode: process.env.COMMONS_EMAIL_SEND_MODE,
    key: process.env.RESEND_API_KEY,
    from: process.env.COMMONS_EMAIL_FROM,
    fetch: globalThis.fetch,
  };
  process.env.COMMONS_EMAIL_SEND_MODE = "live";
  process.env.RESEND_API_KEY = "re_test";
  process.env.COMMONS_EMAIL_FROM = "Commons <invites@commons.test>";
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ id: "provider-message-1" }), { status: 200 });
  };
  try {
    const result = await sendEmail({
      ...renderCommonsInvitationEmail(input),
      to: input.recipientEmail,
      idempotencyKey: "commons-invite-123-v2",
    });
    assert.equal(result.id, "provider-message-1");
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(new Headers(request.init?.headers).get("Idempotency-Key"), "commons-invite-123-v2");
    const body = JSON.parse(String(request.init?.body)) as { from: string; to: string[]; subject: string };
    assert.equal(body.from, "Commons <invites@commons.test>");
    assert.deepEqual(body.to, ["TAYLOR@example.com"]);
    assert.match(body.subject, /Desert Weekend/);
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.mode === undefined) delete process.env.COMMONS_EMAIL_SEND_MODE; else process.env.COMMONS_EMAIL_SEND_MODE = previous.mode;
    if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.COMMONS_EMAIL_FROM; else process.env.COMMONS_EMAIL_FROM = previous.from;
  }
});

test("maps provider and network failures to retryable delivery codes", async () => {
  const previous = {
    mode: process.env.COMMONS_EMAIL_SEND_MODE,
    key: process.env.RESEND_API_KEY,
    from: process.env.COMMONS_EMAIL_FROM,
    fetch: globalThis.fetch,
  };
  process.env.COMMONS_EMAIL_SEND_MODE = "live";
  process.env.RESEND_API_KEY = "re_test";
  process.env.COMMONS_EMAIL_FROM = "Commons <invites@commons.test>";
  const email = { ...renderCommonsInvitationEmail(input), to: input.recipientEmail, idempotencyKey: "commons-invite-456-v1" };
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: "temporary failure" }), { status: 503 });
    await assert.rejects(() => sendEmail(email), (error) => error instanceof EmailDeliveryError && error.code === "provider_unavailable");
    for (const status of [408, 429, 200]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ message: "private upstream detail" }), { status });
      await assert.rejects(() => sendEmail(email), (error) => error instanceof EmailDeliveryError && error.code === (status === 429 ? "provider_rate_limited" : "provider_unavailable") && !error.message.includes("private upstream detail"));
    }
    for (const payload of [null, { id: 123 }, { id: " " }]) {
      globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
      await assert.rejects(() => sendEmail(email), (error) => error instanceof EmailDeliveryError && error.code === "provider_unavailable");
    }
    globalThis.fetch = async () => new Response(JSON.stringify({ message: "bad sender" }), { status: 422 });
    await assert.rejects(() => sendEmail(email), (error) => error instanceof EmailDeliveryError && error.code === "provider_rejected");
    globalThis.fetch = async () => { throw new Error("network down"); };
    await assert.rejects(() => sendEmail(email), (error) => error instanceof EmailDeliveryError && error.code === "provider_unavailable");
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.mode === undefined) delete process.env.COMMONS_EMAIL_SEND_MODE; else process.env.COMMONS_EMAIL_SEND_MODE = previous.mode;
    if (previous.key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous.key;
    if (previous.from === undefined) delete process.env.COMMONS_EMAIL_FROM; else process.env.COMMONS_EMAIL_FROM = previous.from;
  }
});
