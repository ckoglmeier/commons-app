import assert from "node:assert/strict";
import test from "node:test";
import { registerComponentImportStubs } from "../test-support/hook-harness";

registerComponentImportStubs();

const PROHIBITED = /Synthetic|Breckenridge|\$\d|184|SECRET|token|https?:|@example|prompt|receipt/i;

async function harness(options: { environment?: Record<string, string>; sendFails?: boolean } = {}) {
  const { recordOutcome, recordOperationFailure } = await import("./outcome-telemetry");
  const sent: Array<Record<string, unknown>> = [], urls: string[] = [], tasks: Array<Promise<void>> = [];
  const deps = {
    environment: { NEXT_PUBLIC_POSTHOG_KEY: "phc_test", VERCEL_GIT_COMMIT_SHA: "abcdef1234567890", ...options.environment },
    identity: async () => ({ authUserId: "auth-1", email: "traveler@example.invalid" }),
    send: (async (url: string, init: RequestInit) => {
      if (options.sendFails) throw new Error("posthog down");
      urls.push(url);
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
    schedule: (task: () => Promise<void>) => { tasks.push(task().catch(() => undefined)); },
  };
  return { recordOutcome, recordOperationFailure, deps, sent, urls, settle: () => Promise.all(tasks) };
}

test("a committed outcome is sent with closed-vocabulary properties only and a stable uuid", async () => {
  const h = await harness();
  const input = { event: "expense_added" as const, key: "command-1", trip: "trip-slug", request: new Request("http://localhost/"), properties: { balanceMode: "allocate", title: "Synthetic dinner $184", amountCents: 18_400, note: "SECRET-CONF-7" } };
  h.recordOutcome(input, h.deps);
  h.recordOutcome(input, h.deps); // retry of the same command
  await h.settle();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].uuid, h.sent[1].uuid, "PostHog deduplicates on the same uuid");
  const properties = h.sent[0].properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(properties).sort(), ["$geoip_disable", "$process_person_profile", "balanceMode", "outcome", "release", "source", "trip_group"]);
  assert.equal(properties.outcome, "succeeded");
  assert.equal(properties.release, "abcdef123456");
  assert.equal(properties.trip_group?.toString().length, 20);
  assert.doesNotMatch(JSON.stringify(h.sent), PROHIBITED);
});

test("without a PostHog key nothing is sent or scheduled", async () => {
  const h = await harness({ environment: { NEXT_PUBLIC_POSTHOG_KEY: "" } });
  h.recordOutcome({ event: "trip_created", key: "draft-1", request: new Request("http://localhost/") }, h.deps);
  await h.settle();
  assert.equal(h.sent.length, 0);
});

test("per-actor keys count each person joining through one shared link once", async () => {
  const { outcomeEventId } = await import("./outcome-telemetry");
  assert.notEqual(outcomeEventId("group_joined", "trip:a"), outcomeEventId("group_joined", "trip:b"));
  assert.equal(outcomeEventId("group_joined", "trip:a"), outcomeEventId("group_joined", "trip:a"));
  assert.match(outcomeEventId("trip_created", "draft"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("DNT, GPC and the opt-out cookie never send; no request means no delivery", async () => {
  const gpc = await harness();
  gpc.recordOutcome({ event: "trip_created", key: "draft-3", request: new Request("http://localhost/", { headers: { "sec-gpc": "1" } }) }, gpc.deps);
  gpc.recordOutcome({ event: "trip_created", key: "draft-4", request: new Request("http://localhost/", { headers: { cookie: "a=1; commons_analytics_opt_out=1" } }) }, gpc.deps);
  gpc.recordOutcome({ event: "trip_created", key: "draft-5" }, gpc.deps);
  await gpc.settle();
  assert.equal(gpc.sent.length, 0);
});

test("the PostHog host is configurable", async () => {
  const h = await harness({ environment: { NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com/ignored/path" } });
  h.recordOutcome({ event: "trip_created", key: "draft-6", request: new Request("http://localhost/") }, h.deps);
  await h.settle();
  assert.deepEqual(h.urls, ["https://eu.i.posthog.com/i/v0/e/"]);
});

test("telemetry outages never throw into the user's action", async () => {
  const sendFails = await harness({ sendFails: true });
  assert.doesNotThrow(() => sendFails.recordOutcome({ event: "payment_recorded", key: "command-2", request: new Request("http://localhost/") }, sendFails.deps));
  assert.doesNotThrow(() => sendFails.recordOperationFailure({ operation: "expense_save", error: new Error("boom"), request: new Request("http://localhost/") }, sendFails.deps));
  await sendFails.settle();
});

test("failures carry operation, category and release only, never the message", async () => {
  const h = await harness();
  const logged: unknown[] = [], original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const error = Object.assign(new Error("Synthetic Breckenridge SECRET-CONF-7 https://x.invalid?token=abc"), { name: "CommandConflictError" });
    h.recordOperationFailure({ operation: "poll_publish", error, trip: "trip-slug", request: new Request("http://localhost/") }, h.deps);
    await h.settle();
  } finally { console.error = original; }
  assert.equal(h.sent[0].event, "operation_failed");
  const properties = h.sent[0].properties as Record<string, unknown>;
  assert.equal(properties.operation, "poll_publish");
  assert.equal(properties.errorCategory, "conflict");
  assert.equal(properties.release, "abcdef123456");
  assert.doesNotMatch(JSON.stringify({ sent: h.sent, logged }), PROHIBITED);
});

test("error categories are a closed set", async () => {
  const { errorCategory } = await import("./outcome-telemetry");
  assert.equal(errorCategory(Object.assign(new Error("x"), { name: "ZodError" })), "validation");
  assert.equal(errorCategory(Object.assign(new Error("x"), { name: "CommonsAuthenticationRequiredError" })), "authentication");
  assert.equal(errorCategory(Object.assign(new Error("x"), { name: "CommandAccessError" })), "access");
  assert.equal(errorCategory(Object.assign(new Error("x"), { code: "poll_not_found" })), "not_found");
  assert.equal(errorCategory("a string with Synthetic text"), "unexpected");
});

test("account setup is a deduplicated server outcome with validated browser acquisition", async () => {
  const h = await harness();
  const attribution = encodeURIComponent(JSON.stringify({ first_acquisition_source: "chatgpt", latest_acquisition_source: "google", first_landing_page: "/destinations/savannah", prompt: "SECRET" }));
  const input = { event: "account_setup_completed" as const, key: "account-1", request: new Request("https://commons.invalid/account/create", { headers: { cookie: `commons_acquisition_v1=${attribution}` } }) };
  h.recordOutcome(input, h.deps); h.recordOutcome(input, h.deps); await h.settle();
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[0].uuid, h.sent[1].uuid);
  assert.equal((h.sent[0].properties as Record<string, unknown>).first_acquisition_source, "chatgpt");
  assert.equal((h.sent[0].properties as Record<string, unknown>).latest_acquisition_source, "google");
  assert.ok(!JSON.stringify(h.sent).includes("SECRET"));
});
