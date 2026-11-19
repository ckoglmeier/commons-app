import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiEventProperties, estimatedOpenAiCost, observeAiCall, type AiGeneration } from './ai-observability';
import { isPosthogExcluded } from '../posthog-exclusions';

test('internal exclusions are exact and case-insensitive', () => {
  for (const email of ['organizer@example.com', ' organizer+COMMONS-BETA-QA@example.com ']) assert.equal(isPosthogExcluded(email), true);
  for (const email of [undefined, null, 'tester@example.com', 'organizer+vacation@example.com']) assert.equal(isPosthogExcluded(email), false);
});
test('cached input and cache writes are priced separately; reasoning is included in output, and unknown is not free', () => {
  assert.equal(estimatedOpenAiCost('openai/gpt-6.1-sol', { input: 1000, cached: 500, written: 100, output: 100 }), 0.0021);
  assert.equal(estimatedOpenAiCost('openai/gpt-6.1-terra', { input: 1000, cached: 500, written: 100, output: 100 }), 0.00105);
  assert.equal(estimatedOpenAiCost('gpt-6.1-terra', { input: 1000 }), undefined);
  assert.equal(estimatedOpenAiCost('gpt-4.1-mini', { input: 1000, output: 100 }), 0.00056);
  assert.equal(estimatedOpenAiCost('unknown-model', { input: 1000, output: 100 }), undefined);
  assert.equal(estimatedOpenAiCost('gpt-6.1-sol', { input: 1000 }), undefined);
  assert.equal(estimatedOpenAiCost('gpt-6.1-sol', { input: 1000, cached: 2000, output: 10 }), undefined);
});

test('real provider usage and cost survive while private content never enters telemetry', async () => {
  const generations: AiGeneration[] = [];
  const value = await observeAiCall('openrouter', 'openai/gpt-6-astra', g => generations.push(g), async fetcher => {
    const response = await fetcher('https://provider.invalid', { body: 'PRIVATE_PROMPT', method: 'POST' });
    return (await response.json()).choices[0].message.content;
  }, async () => Response.json({ usage: { prompt_tokens: 123, completion_tokens: 45, cost: 0.004 }, choices: [{ message: { content: 'PRIVATE_REPLY' } }] }));
  assert.equal(value, 'PRIVATE_REPLY');
  const properties = aiEventProperties(generations[0], 'trace', 'session', 'workspace');
  assert.equal(properties.$ai_input_tokens, 123);
  assert.equal(properties.$ai_total_cost_usd, 0.004);
  assert.equal(properties.$ai_cost_passthrough, true);
  assert.equal(properties.$ai_is_error, false);
  assert.ok(!JSON.stringify(properties).includes('PRIVATE'));
});

test('validation, transport and HTTP errors are captured without raw error text', async () => {
  for (const mode of ['validation', 'transport', 'http']) {
    const events: AiGeneration[] = [];
    const task = observeAiCall('openai', 'test-model', g => events.push(g), async fetcher => {
      const response = await fetcher('https://provider.invalid');
      if (mode === 'validation') throw new Error('PRIVATE_INVALID_RESPONSE');
      return response.status;
    }, async () => {
      if (mode === 'transport') throw new Error('PRIVATE_CREDENTIAL');
      return Response.json({}, { status: mode === 'http' ? 503 : 200 });
    });
    if (mode === 'http') await task; else await assert.rejects(task);
    assert.equal(events.length, 1);
    assert.equal(events[0].failed, true);
    assert.equal(events[0].cost, undefined);
    assert.ok(!JSON.stringify(aiEventProperties(events[0], 'trace', null, 'poll_suggestions')).includes('PRIVATE'));
  }
});

test('disabled observation and telemetry failures preserve application results', async () => {
  const fetcher: typeof fetch = async () => Response.json({});
  const run = async (f: typeof fetch) => { await f('https://provider.invalid'); return 'ok'; };
  assert.equal(await observeAiCall('openai', 'test', undefined, run, fetcher), 'ok');
  assert.equal(await observeAiCall('openai', 'test', () => { throw new Error('offline'); }, run, fetcher), 'ok');
  let calls = 0;
  await observeAiCall('typesafe', 'test', () => { calls++; }, async () => 'no model call', fetcher);
  assert.equal(calls, 0);
});

test('generation events carry only the capability and input mode labels, never content', () => {
  const generation: AiGeneration = { provider: 'openrouter', model: 'test/model', latency: 1.2, failed: false, inputTokens: 10, outputTokens: 5 };
  const labelled = aiEventProperties(generation, 'trace', 'session', 'workspace', { capability: 'research', inputMode: 'voice' }) as Record<string, unknown>;
  assert.equal(labelled.capability, 'research');
  assert.equal(labelled.input_mode, 'voice');
  assert.equal(labelled.content_capture, 'disabled');
  const plain = aiEventProperties(generation, 'trace', 'session', 'workspace') as Record<string, unknown>;
  assert.ok(!('capability' in plain) && !('input_mode' in plain), 'labels are optional');
});

test('BYOK gateway charge is not the upstream bill; retain the separate rate estimate and returned model', () => {
  const properties = aiEventProperties({ provider: 'openrouter', model: 'openai/gpt-4.1-mini', returnedModel: 'gpt-4.1-mini-2025-04-14',
    latency: 0.5, failed: false, inputTokens: 1000, outputTokens: 100, cost: 0, estimatedApiCostUsd: 0.00056 }, 'trace', 'session', 'workspace');
  assert.equal(properties.$ai_model, 'gpt-4.1-mini-2025-04-14');
  assert.equal(properties.requested_model, 'openai/gpt-4.1-mini');
  assert.equal(properties.provider_reported_charge_usd, 0);
  assert.equal(properties.$ai_total_cost_usd, 0);
  assert.equal(properties.estimated_standard_api_cost_usd, 0.00056);
  assert.equal(properties.provider_charge_coverage, 'reported');
  assert.equal(properties.api_rate_estimate_coverage, 'estimated');
});
