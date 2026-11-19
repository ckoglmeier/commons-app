import assert from "node:assert/strict";
import test from "node:test";
import { invalidDestructiveEditReply, routeForTask, selectCoordinatorModel, type CoordinatorRouteConfiguration } from "./coordinator-model-router";

const configuration: CoordinatorRouteConfiguration = {
  mode: "jev",
  typesafeApiKey: "typesafe-test-key",
  baselineModel: "openai/gpt-4.1-mini",
  miniModel: "openai/gpt-4.1-mini",
  sparkModel: "meta/muse-spark-1.3",
  baselineProviderPolicy: "private",
  sparkProviderPolicy: "standard",
};
const input = { prompt: "Create a poll asking where we should stay.", hasDraft: true, questionCount: 0, selectedPublishedPoll: false };

function jevResponse(choice: Parameters<typeof routeForTask>[0], confidence = 0.9) {
  return Response.json({ model: "jev-1.13.0", answers: { task: { type: "choice", choice, confidence, probabilities: { [choice]: 1 } } }, usage: { input_tokens: 100, output_tokens: 10 } });
}

test("Jev receives only compact routing state and routes generative work to Spark", async () => {
  const route = await selectCoordinatorModel(input, configuration, undefined, async (url, options) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone");
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer typesafe-test-key");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.model, "jev-latest");
    assert.deepEqual(body.state, { request: input.prompt, workspace: { editable_draft_selected: true, question_count: 0, published_poll_selected: false, research_status: "none" } });
    assert.equal(body.questions.task.type, "choice");
    assert.deepEqual(Object.keys(body.questions.task.criteria), [
      "conversation_or_guidance", "artifact_creation_or_edit", "research_synthesis", "introduction_bridge_edit",
      "published_workflow", "ambiguous_edit", "consequential_action", "invalid_destructive_edit",
    ]);
    return jevResponse("artifact_creation_or_edit");
  });
  assert.deepEqual(route, { model: "meta/muse-spark-1.3", providerPolicy: "standard", handler: "model", task: "artifact_creation_or_edit", confidence: 0.9 });
});

test("known published state bypasses Jev and stays on Mini", async () => {
  let called = false;
  const route = await selectCoordinatorModel({ ...input, hasDraft: false, selectedPublishedPoll: true }, configuration, undefined, async () => { called = true; return jevResponse("artifact_creation_or_edit"); });
  assert.equal(called, false);
  assert.deepEqual(route, { model: "openai/gpt-4.1-mini", providerPolicy: "private", handler: "model", task: "known_published_state" });
});

test("Jev routes known Mini strengths and invalid destructive edits explicitly", async () => {
  for (const task of ["published_workflow", "ambiguous_edit", "consequential_action"] as const) {
    assert.equal(routeForTask(task, 0.8, configuration).model, "openai/gpt-4.1-mini");
  }
  const destructive = routeForTask("invalid_destructive_edit", 0.8, configuration);
  assert.equal(destructive.handler, "invalid_destructive_edit");
  assert.deepEqual(invalidDestructiveEditReply().operations, []);
  assert.equal(routeForTask("introduction_bridge_edit", 0.8, configuration).model, configuration.sparkModel);
});

test("research stays with Spark even with a published poll selected or unavailable Jev", async () => {
  for (const researchStatus of ["complete", "partial", "unavailable"] as const) {
    let called = false;
    const route = await selectCoordinatorModel({ ...input, hasDraft: false, selectedPublishedPoll: true, researchStatus }, { ...configuration, typesafeApiKey: undefined }, undefined, async () => { called = true; throw new Error("Should not classify known research state"); });
    assert.equal(called, false);
    assert.equal(route.model, configuration.sparkModel);
    assert.equal(route.task, "known_research_state");
  }
  const disabled = await selectCoordinatorModel({ ...input, researchStatus: "partial" }, { ...configuration, mode: "single" });
  assert.equal(disabled.model, configuration.baselineModel);
});

test("disabled, unavailable, low-confidence, and malformed routing fail closed to the configured baseline", async () => {
  assert.equal((await selectCoordinatorModel(input, { ...configuration, mode: "single" })).task, "single_model");
  assert.equal((await selectCoordinatorModel(input, { ...configuration, typesafeApiKey: undefined })).task, "router_unavailable");
  assert.equal(routeForTask("artifact_creation_or_edit", 0.2, configuration).task, "low_confidence");
  const malformed = await selectCoordinatorModel(input, configuration, undefined, async () => Response.json({ answers: {} }));
  assert.equal(malformed.task, "router_unavailable");
  assert.equal(malformed.model, configuration.baselineModel);
});

test("router failures do not log prompts or credentials", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  await selectCoordinatorModel({ ...input, prompt: "PRIVATE ROUTING PROMPT" }, configuration, undefined, async () => { throw new TypeError("typesafe-test-key PRIVATE ROUTING PROMPT"); });
  const logged = JSON.stringify(warning.mock.calls.map(call => call.arguments));
  assert.match(logged, /router_failed/);
  assert.doesNotMatch(logged, /PRIVATE ROUTING PROMPT|typesafe-test-key/);
});
