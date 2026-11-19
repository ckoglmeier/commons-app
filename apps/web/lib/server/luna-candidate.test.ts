import "../test-support/stub-server-only";
import test from "node:test";
import assert from "node:assert/strict";
import { coordinatorInferencePolicy } from "./coordinator-inference-policy";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";
import { converseWithCoordinator } from "./coordinator-review-inference";
import { estimatedOpenAiCost } from "./ai-observability";

test("Luna policy keeps conversation/extraction on Luna with Terra planning and Astra escalation", async () => {
  const environment = readCommonsRuntimeEnvironment({ NODE_ENV: "test", OPENAI_API_KEY: "synthetic", COMMONS_COORDINATOR_INFERENCE_POLICY: "openai-luna-none" });
  const policy = coordinatorInferencePolicy(environment)!;
  assert.equal(policy.modelId(policy.models.conversation), "gpt-6-luna");
  assert.equal(policy.models.extraction, "openai/gpt-6-luna");
  assert.equal(policy.models.planning, "openai/gpt-6.1-terra");
  assert.equal(policy.models.escalation, "openai/gpt-6-astra");
  let envelope: Record<string, unknown> = {};
  const fetcher = (async (_url, init) => { envelope = JSON.parse(String(init?.body)); return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "Use your saved dates; venue availability remains unknown.", tripSuggestion: null }) } }] }); }) as typeof fetch;
  const result = await converseWithCoordinator(null, "Dinner?", { apiKey: policy.apiKey, model: policy.modelId(policy.models.conversation)!, transport: policy.transport, workspace: true }, undefined, fetcher, { conversation: [], priorPolls: [] });
  assert.equal(envelope.reasoning_effort, "none");
  assert.equal(envelope.max_completion_tokens, 6000);
  assert.equal(result.reply, "Use your saved dates; venue availability remains unknown.");
});
test("Luna accounting uses cached and write rates and completion totals once", () => {
  assert.equal(estimatedOpenAiCost("gpt-6-luna", {}), undefined);
  
  assert.equal(estimatedOpenAiCost("gpt-6-luna", { input: 1000, cached: 200, written: 100, output: 100 }), 0.0001345);
});

test("manual disable stops policy calls without switching provider or payer", () => {
  const environment = readCommonsRuntimeEnvironment({ NODE_ENV: "test", OPENAI_API_KEY: "synthetic", COMMONS_COORDINATOR_INFERENCE_POLICY: "openai-luna-none", COMMONS_COORDINATOR_TEXT_DISABLED: "true" });
  assert.equal(coordinatorInferencePolicy(environment), null);
});

test("answer envelope carries current saved draft context without granting edit authority", async () => {
  let messages: Array<{ role: string; content: string }> = [];
  const fetcher = (async (_url, init) => { messages = JSON.parse(String(init?.body)).messages; return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "The saved introduction says Choose our stay.", tripSuggestion: null }) } }] }); }) as typeof fetch;
  const savedDrafts = [{ id: "synthetic-draft", title: "Choose our base", intro: "Choose our stay." }];
  await converseWithCoordinator(null, "What did we save?", { apiKey: "synthetic", model: "gpt-6-luna", transport: "openai", workspace: true }, undefined, fetcher, { savedDrafts, conversation: [{ role: "assistant", text: "Proposed: long earlier introduction." }], priorPolls: [] });
  const input = JSON.parse(messages.findLast(message => message.role === "user")!.content);
  assert.deepEqual(input.savedDrafts, savedDrafts);
  assert.equal(input.draft, null);
  assert.match(messages[0].content, /read-only answers, never edit authority/);
});
