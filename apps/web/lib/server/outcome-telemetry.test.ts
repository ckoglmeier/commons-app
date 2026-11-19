import assert from "node:assert/strict";
import test from "node:test";
import { registerComponentImportStubs } from "../test-support/hook-harness";

registerComponentImportStubs();

type Persisted = { id: string; eventName: string; authUserId?: string | null; tripIdentifier?: string | null; properties: Record<string, unknown> };
const PROHIBITED = /Synthetic|Breckenridge|\$\d|184|SECRET|token|https?:|@example|prompt|receipt/i;

async function harness(options: { inserted?: boolean[]; email?: string; environment?: Record<string, string>; sendFails?: boolean; persistFails?: boolean } = {}) {
  const { recordOutcome, recordOperationFailure } = await import("./outcome-telemetry");
  const persisted: Persisted[] = [], sent: Array<Record<string, unknown>> = [], tasks: Array<Promise<void>> = [];
  let call = 0;
  const deps = {
    environment: { VERCEL_ENV: "production", NEXT_PUBLIC_POSTHOG_KEY: "phc_test", VERCEL_GIT_COMMIT_SHA: "abcdef1234567890", ...options.environment },
    identity: async () => ({ authUserId: "auth-1", email: options.email ?? "traveler@example.invalid" }),
    persist: async (input: Persisted) => {
      if (options.persistFails) throw new Error("database down");
      persisted.push(input);
      return { inserted: options.inserted?.[call++] ?? true, tripId: "trip-1", role: "participant" as const };
    },
    send: (async (_url: string, init: RequestInit) => {
      if (options.sendFails) throw new Error("posthog down");
      sent.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
    schedule: (task: () => Promise<void>) => { tasks.push(task().catch(() => undefined)); },
  };
  return { recordOutcome, recordOperationFailure, deps, persisted, sent, settle: () => Promise.all(tasks) };
}

test("a committed outcome is persisted once and sent once with closed-vocabulary properties only", async () => {
  const h = await harness({ inserted: [true, false] });
  const input = { event: "expense_added" as const, key: "command-1", trip: "trip-slug", request: new Request("http://localhost/"), properties: { balanceMode: "allocate", title: "Synthetic dinner $184", amountCents: 18_400, note: "SECRET-CONF-7" } };
  h.recordOutcome(input, h.deps);
  h.recordOutcome(input, h.deps); // retry of the same command
  await h.settle();
  assert.equal(h.persisted.length, 2, "both deliveries reach the idempotent insert");
  assert.equal(h.persisted[0].id, h.persisted[1].id, "the same command maps to the same row id");
  assert.equal(h.sent.length, 1, "only the inserted row is forwarded (consent headers are read from the request)");
  const properties = h.persisted[0].properties;
  assert.deepEqual(Object.keys(properties).sort(), ["balanceMode", "internal", "outcome", "release", "sample"]);
  assert.equal(properties.outcome, "succeeded");
  assert.equal(properties.release, "abcdef123456");
  assert.equal(h.sent[0].uuid, h.persisted[0].id, "PostHog deduplicates on the same uuid");
  assert.equal((h.sent[0].properties as Record<string, unknown>).trip_group?.toString().length, 20);
  assert.doesNotMatch(JSON.stringify({ persisted: h.persisted, sent: h.sent }), PROHIBITED);
});

test("per-actor keys count each person joining through one shared link once", async () => {
  const { outcomeEventId } = await import("./outcome-telemetry");
  assert.notEqual(outcomeEventId("group_joined", "trip:a"), outcomeEventId("group_joined", "trip:b"));
  assert.equal(outcomeEventId("group_joined", "trip:a"), outcomeEventId("group_joined", "trip:a"));
  assert.match(outcomeEventId("trip_created", "draft"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("internal accounts are persisted for exclusion but never sent; DNT/GPC and non-production never send", async () => {
  const internal = await harness({ email: "organizer@example.com" });
  internal.recordOutcome({ event: "trip_created", key: "draft-1" }, internal.deps);
  await internal.settle();
  assert.equal(internal.persisted[0].properties.internal, true);
  assert.equal(internal.sent.length, 0);

  const preview = await harness({ environment: { VERCEL_ENV: "preview" } });
  preview.recordOutcome({ event: "trip_created", key: "draft-2" }, preview.deps);
  await preview.settle();
  assert.equal(preview.sent.length, 0);

  const dnt = await harness();
  dnt.recordOutcome({ event: "trip_created", key: "draft-3", request: new Request("http://localhost/", { headers: { "sec-gpc": "1" } }) }, dnt.deps);
  await dnt.settle();
  assert.equal(dnt.persisted.length, 1, "first-party operating counts still persist");
  assert.equal(dnt.sent.length, 0, "no third-party delivery under GPC");
});

test("telemetry outages never throw into the user's action", async () => {
  const sendFails = await harness({ sendFails: true });
  assert.doesNotThrow(() => sendFails.recordOutcome({ event: "payment_recorded", key: "command-2" }, sendFails.deps));
  await sendFails.settle();
  const persistFails = await harness({ persistFails: true });
  assert.doesNotThrow(() => persistFails.recordOutcome({ event: "payment_recorded", key: "command-3" }, persistFails.deps));
  assert.doesNotThrow(() => persistFails.recordOperationFailure({ operation: "expense_save", error: new Error("boom") }, persistFails.deps));
  await persistFails.settle();
  // The default scheduler outside a request scope also swallows failures.
  const { recordOutcome } = await import("./outcome-telemetry");
  assert.doesNotThrow(() => recordOutcome({ event: "payment_recorded", key: "command-4" }, { persist: async () => { throw new Error("down"); }, identity: async () => null }));
});

test("failures carry operation, category and release only, never the message", async () => {
  const h = await harness();
  const warnings: unknown[] = [], original = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args); };
  try {
    const error = Object.assign(new Error("Synthetic Breckenridge SECRET-CONF-7 https://x.invalid?token=abc"), { name: "CommandConflictError" });
    h.recordOperationFailure({ operation: "poll_publish", error, trip: "trip-slug" }, h.deps);
    await h.settle();
  } finally { console.error = original; }
  assert.equal(h.persisted[0].eventName, "operation_failed");
  assert.deepEqual(h.persisted[0].properties, { operation: "poll_publish", errorCategory: "conflict", outcome: "failed", internal: false, sample: false, release: "abcdef123456" });
  assert.doesNotMatch(JSON.stringify({ persisted: h.persisted, sent: h.sent, warnings }), PROHIBITED);
});

test("error categories are a closed set", async () => {
  const { errorCategory } = await import("./outcome-telemetry");
  assert.equal(errorCategory(Object.assign(new Error("x"), { name: "ZodError" })), "validation");
  assert.equal(errorCategory(Object.assign(new Error("x"), { name: "CommonsAuthenticationRequiredError" })), "authentication");
  assert.equal(errorCategory(Object.assign(new Error("x"), { name: "CommandAccessError" })), "access");
  assert.equal(errorCategory(Object.assign(new Error("x"), { code: "poll_not_found" })), "not_found");
  assert.equal(errorCategory("a string with Synthetic text"), "unexpected");
});

test("review fix: the Commons opt-out cookie keeps outcomes out of PostHog", async () => {
  const h = await harness();
  h.recordOutcome({ event: "trip_created", key: "draft-opt-out", request: new Request("http://localhost/", { headers: { cookie: "a=1; commons_analytics_opt_out=1" } }) }, h.deps);
  await h.settle();
  assert.equal(h.persisted.length, 1, "operational first-party row only");
  assert.equal(h.sent.length, 0);
});


test('account setup is a deduplicated server outcome with validated browser acquisition', async () => {
  const h = await harness({ inserted: [true, false] });
  const attribution = encodeURIComponent(JSON.stringify({first_acquisition_source:'chatgpt', latest_acquisition_source:'google', first_landing_page:'/destinations/savannah', prompt:'SECRET'}));
  const input = {event:'account_setup_completed' as const,key:'account-1',request:new Request('https://www.commons.travel/account/create',{headers:{cookie:`commons_acquisition_v1=${attribution}`}})};
  h.recordOutcome(input,h.deps); h.recordOutcome(input,h.deps); await h.settle();
  assert.equal(h.sent.length,1);
  assert.equal(h.persisted[0].id,h.persisted[1].id);
  assert.equal((h.sent[0].properties as Record<string,unknown>).first_acquisition_source,'chatgpt');
  assert.equal((h.sent[0].properties as Record<string,unknown>).latest_acquisition_source,'google');
  assert.ok(!JSON.stringify(h.sent).includes('SECRET'));
});
