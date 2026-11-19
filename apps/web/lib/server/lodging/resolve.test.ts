import test from "node:test";
import assert from "node:assert/strict";
import { resolveLodgingRequest, resolverMessages, validateResolution, type ResolverOption } from "./resolve";
import { lodgingModelResolveEnabled, nativeLodgingListed } from "./config";

const options: ResolverOption[] = [
  { optionId: "opt-a", name: "Synthetic Dune Lodge", bedrooms: 4, nightlyCents: 41_000, totalCents: 123_000 },
  { optionId: "opt-b", name: "Synthetic Cove Cottage", bedrooms: 2, nightlyCents: 21_000, totalCents: 63_000 },
];
const PRIVATE = "PRIVATE-CANARY-do-not-share";

async function withEnvironment(run: () => Promise<void>) {
  const keys = ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "COMMONS_COORDINATOR_INFERENCE_POLICY"], saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { OPENAI_API_KEY: "test-openai-key", COMMONS_COORDINATOR_INFERENCE_POLICY: "openai" });
  try { await run(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
const completion = (content: unknown, finish = "stop") => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status: 200 });
const counted = (respond: () => Response | Promise<Response>) => { const calls = { count: 0 }; return { calls, fetcher: (async () => { calls.count += 1; return respond(); }) as unknown as typeof fetch }; };

test("rollout: native lodging and model resolution are independently default-off, and production needs the second switch", () => {
  const trip = { id: "11111111-1111-4111-8111-111111111111", slug: "breck" };
  assert.equal(nativeLodgingListed(trip, {}), false);
  assert.equal(nativeLodgingListed(trip, { COMMONS_NATIVE_LODGING_ENABLED: "true" }), false, "the allowlist is required too");
  assert.equal(nativeLodgingListed(trip, { COMMONS_NATIVE_LODGING_ENABLED: "true", COMMONS_NATIVE_LODGING_TRIPS: "breck" }), true);
  assert.equal(nativeLodgingListed(trip, { COMMONS_NATIVE_LODGING_ENABLED: "1", COMMONS_NATIVE_LODGING_TRIPS: "breck" }), false, "only an explicit true");
  assert.equal(nativeLodgingListed(trip, { COMMONS_NATIVE_LODGING_ENABLED: "true", COMMONS_NATIVE_LODGING_TRIPS: "other-trip" }), false);
  assert.equal(nativeLodgingListed(trip, { COMMONS_NATIVE_LODGING_ENABLED: "true", COMMONS_NATIVE_LODGING_TRIPS: "breck", VERCEL_ENV: "production" }), false, "production double switch");
  const production = { COMMONS_NATIVE_LODGING_ENABLED: "true", COMMONS_NATIVE_LODGING_TRIPS: "breck", VERCEL_ENV: "production", COMMONS_NATIVE_LODGING_ALLOW_PRODUCTION: "true" };
  assert.equal(nativeLodgingListed(trip, production), false, "production requires an account allowlist too");
  const account = { ...production, COMMONS_NATIVE_LODGING_PERSON_IDS: " tester " };
  assert.equal(nativeLodgingListed({ ...trip, actorPersonId: "tester" }, account), true);
  assert.equal(nativeLodgingListed({ ...trip, actorPersonId: "other-organizer" }, account), false);
  assert.equal(nativeLodgingListed(trip, account), false, "no anonymous execution");
  assert.equal(nativeLodgingListed({ ...trip, slug: "other", id: "other", actorPersonId: "tester" }, account), false, "account access cannot bypass trip scope");
  assert.equal(nativeLodgingListed(trip, { COMMONS_NATIVE_LODGING_ENABLED: "true", COMMONS_NATIVE_LODGING_TRIPS: "breck", VERCEL_ENV: "preview" }), true);
  assert.equal(lodgingModelResolveEnabled({}), false);
  assert.equal(lodgingModelResolveEnabled({ COMMONS_NATIVE_LODGING_MODEL_RESOLVE: "1" }), false);
  assert.equal(lodgingModelResolveEnabled({ COMMONS_NATIVE_LODGING_MODEL_RESOLVE: "true" }), true);
});

test("validation: only a shortlist id can be chosen; malformed, extra-field and unsupported replies are unusable", () => {
  assert.deepEqual(validateResolution({ intent: "choose", optionId: "opt-b", needsClarification: false }, options), { intent: "choose", optionId: "opt-b", needsClarification: false });
  assert.equal(validateResolution({ intent: "choose", optionId: "opt-zzz", needsClarification: false }, options)?.optionId, null, "an invented id is no match");
  assert.equal(validateResolution({ intent: "choose", optionId: "opt-a", needsClarification: false }, [])?.optionId, null, "no shortlist, no match");
  assert.equal(validateResolution({ intent: "research", optionId: "opt-a", needsClarification: false }, options)?.optionId, null, "an id only counts for a choice");
  assert.equal(validateResolution({ intent: "book", optionId: null, needsClarification: false }, options), null);
  assert.equal(validateResolution({ intent: "choose", optionId: "opt-a", needsClarification: false, approve: true }, options), null);
  assert.equal(validateResolution({ intent: "other", optionId: null }, options), null);
  assert.equal(validateResolution({ intent: "other", optionId: null, needsClarification: "Which one?" }, options), null, "the model writes no text anyone reads");
  assert.equal(validateResolution("choose opt-a", options), null);
});

test("one call through the policy transport with a strict schema, carrying only the request and public shortlist fields", async () => withEnvironment(async () => {
  const seen: Array<{ url: string; body: Record<string, any> }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => { seen.push({ url: String(input), body: JSON.parse(String(init?.body)) }); return completion({ intent: "choose", optionId: "opt-b", needsClarification: false }); }) as typeof fetch;
  // Extra fields on an option (as a caller might hold them: address, private notes) must never reach the model.
  const loaded = options.map(option => ({ ...option, address: "1 Secret Rd", privateNote: PRIVATE }));
  const resolved = await resolveLodgingRequest("Take the cheaper one", loaded as ResolverOption[], { fetcher });
  assert.deepEqual(resolved, { status: "resolved", resolution: { intent: "choose", optionId: "opt-b", needsClarification: false } });
  assert.equal(seen.length, 1, "exactly one model call");
  assert.equal(seen[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal(seen[0].body.stream, false);
  assert.ok(seen[0].body.max_completion_tokens <= 200, "bounded output");
  assert.equal(seen[0].body.response_format.json_schema.strict, true);
  assert.deepEqual(seen[0].body.response_format.json_schema.schema.required, ["intent", "optionId", "needsClarification"]);
  assert.equal(seen[0].body.tools, undefined, "no tools");
  const prompt = JSON.stringify(seen[0].body.messages);
  assert.ok(prompt.includes("Take the cheaper one") && prompt.includes("opt-b") && prompt.includes("Cove Cottage"));
  for (const secret of [PRIVATE, "1 Secret Rd", "privateNote", "address"]) assert.ok(!prompt.includes(secret), `${secret} must not be in the prompt`);
  assert.deepEqual(JSON.parse(resolverMessages("x", options)[1].content as string).shortlist[0], { id: "opt-a", name: "Synthetic Dune Lodge", bedrooms: 4, nightlyUsd: 410, totalUsd: 1230 });
}));

test("failures are unavailable after exactly one call, never retried and never thrown; a Stop is not swallowed", async () => withEnvironment(async () => {
  const cases: Array<[string, () => Response | Promise<Response>, string]> = [
    ["status 500", () => new Response("{}", { status: 500 }), "failed"],
    ["network", () => { throw new TypeError("network"); }, "failed"],
    ["not json", () => completion("not json"), "invalid"],
    ["truncated", () => completion({ intent: "choose", optionId: "opt-a", needsClarification: false }, "length"), "invalid"],
    ["refusal", () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "no" } }] }), { status: 200 }), "invalid"],
    ["unsupported intent", () => completion({ intent: "book", optionId: "opt-a", needsClarification: false }), "invalid"],
  ];
  for (const [label, respond, reason] of cases) {
    const { calls, fetcher } = counted(respond);
    assert.deepEqual(await resolveLodgingRequest("x", options, { fetcher }), { status: "unavailable", reason }, label);
    assert.equal(calls.count, 1, `${label}: one call, no retry`);
  }
  const hanging = { calls: { count: 0 } };
  // The interval keeps the event loop alive the way a real open socket would; AbortSignal.timeout alone does not.
  const timedOut = await resolveLodgingRequest("x", options, { fetcher: ((input: RequestInfo | URL, init?: RequestInit) => { hanging.calls.count += 1; const alive = setInterval(() => {}, 1_000);
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { clearInterval(alive); reject(init.signal!.reason); })); }) as typeof fetch, timeoutMs: 30 });
  assert.deepEqual([timedOut, hanging.calls.count], [{ status: "unavailable", reason: "failed" }, 1], "a timeout is unavailable after one call");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolveLodgingRequest("x", options, { fetcher: (async () => { throw new DOMException("aborted", "AbortError"); }) as unknown as typeof fetch, signal: controller.signal }), "a Stop is not swallowed");
}));

test("no provider configured: unavailable without any request", async () => withEnvironment(async () => {
  delete process.env.OPENAI_API_KEY;
  const { calls, fetcher } = counted(() => completion({}));
  assert.deepEqual(await resolveLodgingRequest("x", options, { fetcher }), { status: "unavailable", reason: "not_configured" });
  assert.equal(calls.count, 0);
}));
