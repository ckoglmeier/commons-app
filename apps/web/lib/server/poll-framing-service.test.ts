import assert from "node:assert/strict";
import test from "node:test";
import { runPollFraming, type PollFramingDependencies, type PollFramingOutcome } from "./poll-framing-service";
import { PollInferenceError, suggestPollFraming } from "./poll-inference";
import { framingFixtures } from "./poll-framing-fixtures";
import { framingRevision, planFramingApply } from "../poll-framing-apply";
import { PollSuggestionSchema } from "../poll-suggestions";

const fixture = framingFixtures[2];
const facts = { trip: { title: "Lake", startsOn: null, endsOn: null, place: null, timezone: "UTC", currency: "USD", travelerCount: 3 }, stays: [], activities: [] };
const reservation = { replay: false as const, request: fixture.input.request, settledFacts: "", change: null, draft: { title: "T", intro: null, questions: [] }, facts };
const commandId = "92000000-0000-4000-8000-000000000001";

function dependencies(overrides: Partial<PollFramingDependencies> = {}) {
  const calls = { suggest: 0, complete: [] as Array<PollFramingOutcome | null> };
  const deps: PollFramingDependencies = {
    reserve: async () => reservation,
    complete: async (_slug, _id, outcome) => { calls.complete.push(outcome); },
    suggest: (async (input: unknown) => { calls.suggest += 1; void input; return { suggestion: PollSuggestionSchema.parse(fixture.output), model: "m" }; }) as PollFramingDependencies["suggest"],
    ...overrides,
  };
  return { deps, calls };
}
const config = { slug: "trip", body: { commandId }, apiKey: "k", model: "m", environment: {} };

test("a reservation leads to one provider call and the sanitized result is stored with it", async () => {
  const { deps, calls } = dependencies();
  const outcome = await runPollFraming(config, deps);
  assert.equal(calls.suggest, 1); assert.equal(calls.complete.length, 1);
  assert.deepEqual(calls.complete[0], outcome);
  assert.ok(Array.isArray(outcome.scope.editableQuestionIds));
});

test("a replayed command returns the stored result and never reaches the provider", async () => {
  const stored: PollFramingOutcome = { suggestion: PollSuggestionSchema.parse(fixture.output), scope: { editableQuestionIds: [], suppliedOptionIds: [] } };
  const { deps, calls } = dependencies({ reserve: async () => ({ replay: true, result: stored as unknown as Record<string, unknown> }) });
  assert.deepEqual(await runPollFraming(config, deps), stored);
  assert.equal(calls.suggest, 0); assert.equal(calls.complete.length, 0);
});

test("an in-flight, capped or refused reservation stops before the provider", async () => {
  for (const error of [new Error("in flight"), new Error("hourly cap")]) {
    const { deps, calls } = dependencies({ reserve: async () => { throw error; } });
    await assert.rejects(runPollFraming(config, deps), error);
    assert.equal(calls.suggest, 0);
  }
});

test("the kill switch stops before reservation; provider failure marks the reservation failed and rethrows", async () => {
  let reserved = 0;
  const off = dependencies({ reserve: async () => { reserved += 1; return reservation; } });
  await assert.rejects(runPollFraming({ ...config, environment: { COMMONS_POLL_ASSISTANCE_ENABLED: "false" } }, off.deps), { code: "not_configured" });
  assert.equal(reserved, 0);
  const failing = dependencies({ suggest: (async () => { throw new PollInferenceError("unavailable"); }) as PollFramingDependencies["suggest"] });
  await assert.rejects(runPollFraming(config, failing.deps), { code: "unavailable" });
  assert.deepEqual(failing.calls.complete, [null]);
});

test("a stale suggestion cannot be applied, and a clarification never replaces content", () => {
  const suggestion = PollSuggestionSchema.parse(fixture.output);
  const content = { framingRequest: "r", intro: "i", settledFacts: "", title: "Weekend", questions: [] };
  const requestRevision = framingRevision(content);
  const common = { suggestion, scope: { editableQuestionIds: [], suppliedOptionIds: [] }, mode: "write" as const, requestRevision, title: "Weekend", defaultTitle: "Weekend", intro: "i", questions: [] };
  const fresh = planFramingApply({ ...common, currentRevision: requestRevision });
  assert.ok(fresh.ok && fresh.intro === suggestion.introduction && fresh.questions.length === suggestion.questions.length);
  assert.deepEqual(planFramingApply({ ...common, currentRevision: framingRevision({ ...content, intro: "edited after the request" }) }), { ok: false, reason: "stale" });
  assert.deepEqual(planFramingApply({ ...common, suggestion: PollSuggestionSchema.parse(framingFixtures[5].output), currentRevision: requestRevision }), { ok: false, reason: "clarification" });
  // A title the organizer already changed is kept unless they asked for a revision.
  const kept = planFramingApply({ ...common, suggestion: { ...suggestion, title: "New title" }, title: "My own title", currentRevision: requestRevision });
  assert.ok(kept.ok && kept.title === "My own title");
  const revised = planFramingApply({ ...common, mode: "revise", suggestion: { ...suggestion, title: "New title" }, title: "My own title", currentRevision: requestRevision });
  assert.ok(revised.ok && revised.title === "New title");
});


test("auto routing uses the reserved change, not raw body fields or the presence of manual draft questions", async () => {
  for (const change of [null, "Shorten the introduction"]) {
    const saved = { ...reservation, change, draft: { title: "Human draft", intro: "Human introduction", questions: [{ id: commandId, kind: "text" as const, prompt: "What would work?", required: false }] } };
    const before = structuredClone(saved.draft);
    const { deps, calls } = dependencies({
      reserve: async () => saved,
      suggest: (input, configuration) => suggestPollFraming(input, configuration, async (_url, init) => {
        const sent = JSON.parse(String(init?.body));
        assert.equal(sent.model, change ? "gpt-6-luna" : "gpt-6.1-terra");
        assert.deepEqual(sent.reasoning, { effort: change ? "none" : "low" });
        return new Response(JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(framingFixtures[0].output) }] }] }));
      }),
    });
    await runPollFraming({ ...config, model: "auto", body: { commandId, change: change ? undefined : "untrusted body disagrees" } }, deps);
    assert.equal(calls.complete.length, 1);
    assert.deepEqual(saved.draft, before, "writing help stores a candidate without applying it to the saved draft");
  }
});

test("auto still requires a configured key and an unset model never reserves paid work", async () => {
  let reserved = 0;
  const { deps } = dependencies({ reserve: async () => { reserved += 1; return reservation; } });
  for (const missing of [{ model: undefined }, { model: "auto", apiKey: undefined }]) {
    await assert.rejects(runPollFraming({ ...config, ...missing }, deps), { code: "not_configured" });
  }
  assert.equal(reserved, 0);
});
