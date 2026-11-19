import test from "node:test";
import assert from "node:assert/strict";
import { coordinatorConversationConfigured, coordinatorInferencePolicy, describeCoordinatorPolicies } from "./coordinator-inference-policy";
import { registerComponentImportStubs } from "../test-support/hook-harness";
import { converseWithCoordinator } from "./coordinator-review-inference";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";

const environment = (values: Record<string, string>) => readCommonsRuntimeEnvironment({ NODE_ENV: "test", ...values } as NodeJS.ProcessEnv);

test("best policy: OpenRouter, today's model settings, the configured routing mode; unavailable without its key", () => {
  const policy = coordinatorInferencePolicy(environment({ COMMONS_COORDINATOR_INFERENCE_POLICY: "best", OPENROUTER_API_KEY: "or-key", COMMONS_WORKSPACE_ROUTING_MODE: "jev", COMMONS_WORKSPACE_MODEL: "openai/gpt-4.1" }))!;
  assert.deepEqual([policy.id, policy.transport, policy.fundingSource, policy.routingMode], ["best", "openrouter", "commons", "jev"]);
  assert.deepEqual(policy.models, { conversation: "openai/gpt-4.1", extraction: "openai/gpt-4.1-mini", planning: "openai/gpt-6.1-sol", escalation: "openai/gpt-6-astra" }, "reads the same variables production uses today");
  assert.equal(policy.modelId("meta/muse-spark-1.3"), "meta/muse-spark-1.3");
  assert.equal(coordinatorInferencePolicy(environment({ COMMONS_COORDINATOR_INFERENCE_POLICY: "best", OPENAI_API_KEY: "oa-key" })), null, "best never borrows the OpenAI key");
});

test("openai policy: direct OpenAI, its own OpenAI model settings, no classifier, and a non-OpenAI model is a gap, never a silent swap", () => {
  const values = { COMMONS_COORDINATOR_INFERENCE_POLICY: "openai", OPENAI_API_KEY: "oa-key", OPENROUTER_API_KEY: "or-key", COMMONS_WORKSPACE_ROUTING_MODE: "jev", COMMONS_WORKSPACE_MODEL: "meta/muse-spark-1.3" };
  const policy = coordinatorInferencePolicy(environment(values))!;
  assert.deepEqual([policy.id, policy.transport, policy.apiKey, policy.routingMode], ["openai", "openai", "oa-key", "single"]);
  assert.deepEqual(policy.models, { conversation: "openai/gpt-4.1-mini", extraction: "openai/gpt-4.1-mini", planning: "openai/gpt-6.1-terra", escalation: "openai/gpt-6-astra" }, "the best policy's model settings do not leak in");
  assert.equal(policy.modelId("openai/gpt-4.1-mini"), "gpt-4.1-mini");
  assert.equal(policy.modelId("meta/muse-spark-1.3"), null);
  assert.equal(coordinatorConversationConfigured(environment(values)), true);
  assert.equal(coordinatorConversationConfigured(environment({ ...values, COMMONS_OPENAI_POLICY_ESCALATION_MODEL: "meta/muse-spark-1.3" })), false);
  assert.equal(coordinatorInferencePolicy(environment({ COMMONS_COORDINATOR_INFERENCE_POLICY: "openai", OPENROUTER_API_KEY: "or-key" })), null, "openai never borrows the OpenRouter key");
});

test("openai is the default policy everywhere; best is the rollback", () => {
  const values = { OPENAI_API_KEY: "oa-key", OPENROUTER_API_KEY: "or-key" };
  assert.equal(coordinatorInferencePolicy(environment(values))!.id, "openai");
  assert.equal(coordinatorInferencePolicy(environment({ ...values, COMMONS_COORDINATOR_INFERENCE_POLICY: "best" }))!.id, "best");
});

test("the policy description shows every policy, what is active, why one cannot run, and never a credential", () => {
  const described = describeCoordinatorPolicies(environment({ OPENROUTER_API_KEY: "SECRET-OR", TYPESAFE_API_KEY: "SECRET-TS", COMMONS_WORKSPACE_ROUTING_MODE: "jev", COMMONS_OPENAI_POLICY_MODEL: "meta/muse-spark-1.3" }));
  assert.equal(described.active, "openai");
  assert.deepEqual(described.policies.map(policy => [policy.id, policy.active, policy.ready]), [["best", false, true], ["openai", true, false], ["openai-luna-none", false, false]]);
  const openai = described.policies[1];
  assert.deepEqual(openai.gaps, ["OPENAI_API_KEY is not set", "conversation model meta/muse-spark-1.3 is not allowed by this policy"]);
  assert.equal(openai.routing, "Commons rules only");
  assert.equal(described.policies[0].routing, "jev classifier");
  assert.deepEqual(described.policies[0].models.conversation, { configured: "openai/gpt-4.1-mini", providerModel: "openai/gpt-4.1-mini" });
  assert.doesNotMatch(JSON.stringify(described), /SECRET/);
});

test("the policy endpoint refuses anyone who is not an operator", async () => {
  registerComponentImportStubs();
  const saved = { ...process.env };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  try {
    const { GET } = await import("../../app/api/v1/admin/coordinator-policy/route");
    const response = await GET();
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "Operator access is required." });
  } finally { process.env = saved; }
});

test("the direct OpenAI request carries the same prompt and strict schema, OpenAI parameter names, no OpenRouter routing, and streams usage", async () => {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "Try Alpine Table at 5.", tripSuggestion: null }) } }] }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const configuration = { apiKey: "oa-key", model: "gpt-4.1-mini", workspace: true } as const;
  const openai = await converseWithCoordinator(null, "Dinner?", { ...configuration, transport: "openai" }, undefined, fetcher, { conversation: [], priorPolls: [] });
  await converseWithCoordinator(null, "Dinner?", { ...configuration, model: "openai/gpt-4.1-mini" }, undefined, fetcher, { conversation: [], priorPolls: [] });
  assert.equal(openai.reply, "Try Alpine Table at 5.");
  const [direct, routed] = calls;
  assert.equal(direct.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(direct.headers.Authorization, "Bearer oa-key");
  assert.equal("X-OpenRouter-Title" in direct.headers, false);
  assert.equal(direct.body.model, "gpt-4.1-mini");
  assert.equal(direct.body.max_completion_tokens, 6000);
  assert.equal("provider" in direct.body, false);
  assert.equal("max_tokens" in direct.body, false);
  assert.deepEqual(direct.body.messages, routed.body.messages, "the same prompt on both transports");
  assert.deepEqual(direct.body.response_format, routed.body.response_format, "the same strict schema on both transports");
  assert.equal(routed.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(routed.body.provider, { require_parameters: true, data_collection: "deny", zdr: true });

  calls.length = 0;
  const encoder = new TextEncoder();
  const streamed = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const text = JSON.stringify({ reply: "Try Alpine Table. It opens at 4:30.", tripSuggestion: null });
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`));
      // OpenAI sends usage in a last chunk with no choices when include_usage is set.
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 20 } })}\n\ndata: [DONE]\n\n`));
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  const seen: string[] = [];
  const result = await converseWithCoordinator(null, "Dinner?", { ...configuration, transport: "openai", onReplyDelta: text => seen.push(text) }, undefined, streamed, { conversation: [], priorPolls: [] });
  assert.equal(result.reply, "Try Alpine Table. It opens at 4:30.");
  assert.deepEqual(calls[0].body.stream_options, { include_usage: true });
  assert.equal(calls[0].body.stream, true);
  assert.ok(seen.length >= 1);
});


test("explicit Sol planning override remains a reversible rollback while Luna stays fixed", () => {
  const policy = coordinatorInferencePolicy(environment({ OPENAI_API_KEY: "synthetic", COMMONS_COORDINATOR_INFERENCE_POLICY: "openai-luna-none", COMMONS_OPENAI_POLICY_PLANNING_MODEL: "openai/gpt-6.1-sol" }))!;
  assert.equal(policy.models.planning, "openai/gpt-6.1-sol");
  assert.equal(policy.modelId(policy.models.conversation), "gpt-6-luna");
  assert.equal(policy.modelId(policy.models.extraction), "gpt-6-luna");
});
