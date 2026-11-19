import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { InferenceTrace, currentInferenceTrace, inferenceCorrelation, traceMetadata, withInferenceSpan, type InferenceEvent, type TraceMetadata } from './inference-tracing';
import { observeAiCall } from './ai-observability';
import { deferPosthogTrace, posthogIdentityEligible, posthogTracingEligible } from './posthog-trace-export';

const input = () => ({ tripId: randomUUID(), actorId: randomUUID(), commandId: randomUUID(), threadId: randomUUID(), attempt: 1 });
const root = (trace: InferenceTrace) => trace.snapshot().find(event => event.properties.$ai_span_name === 'coordinator.attempt')!;

test('retry correlation is stable and scoped; attempt IDs change, raw IDs never become analytics fields', () => {
  const scope = input(), first = inferenceCorrelation(scope), retry = inferenceCorrelation({ ...scope, attempt: 2 });
  assert.equal(first.traceId, retry.traceId);
  assert.notEqual(first.attemptId, retry.attemptId);
  assert.match(first.traceId, /^[a-f0-9]{32}$/); assert.match(first.attemptId, /^[a-f0-9]{16}$/);
  for (const key of ['tripId', 'actorId', 'commandId'] as const) assert.notEqual(inferenceCorrelation({ ...scope, [key]: randomUUID() }).traceId, first.traceId);
  assert.throws(() => inferenceCorrelation({ ...scope, tripId: 'PRIVATE_EMAIL@example.com' }));
  assert.throws(() => inferenceCorrelation({ ...scope, attempt: 0 }));
  const trace = new InferenceTrace(scope, { startedAt: 100, now: () => 150 }); trace.finish('completed');
  for (const value of [scope.tripId, scope.actorId, scope.commandId, scope.threadId]) assert.ok(!JSON.stringify(trace.snapshot()).includes(value));
});

test('actual observed calls nest under spans; no provider call produces no generation', async () => {
  const trace = new InferenceTrace(input(), { startedAt: Date.now(), synthetic: true });
  await trace.run(() => withInferenceSpan('dispatch', () => withInferenceSpan('model', async () => {
    await observeAiCall('openai', 'gpt-4.1-mini', undefined, async f => { await f('https://provider.invalid'); return 'answer'; }, async () => Response.json({ model: 'gpt-4.1-mini-2025-04-14', usage: { prompt_tokens: 100, completion_tokens: 10 } }));
    await observeAiCall('openai', 'gpt-4.1-mini', undefined, async () => 'no call', fetch);
  })));
  trace.finish('completed', { outcome: 'answered' });
  const events = trace.snapshot(), generation = events.find(event => event.event === '$ai_generation')!, model = events.find(event => event.properties.$ai_span_name === 'coordinator.model')!, dispatch = events.find(event => event.properties.$ai_span_name === 'coordinator.dispatch')!;
  assert.equal(generation.properties.$ai_parent_id, model.properties.$ai_span_id);
  assert.equal(model.properties.$ai_parent_id, dispatch.properties.$ai_span_id);
  assert.equal(dispatch.properties.$ai_parent_id, trace.correlation.attemptId);
  assert.equal(root(trace).properties.$ai_parent_id, undefined, 'attempt roots belong to the implicit trace, not an absent span');
  assert.equal(generation.properties.returned_model, 'gpt-4.1-mini-2025-04-14');
  assert.equal(root(trace).properties.generation_count, 1);
  assert.equal(root(trace).properties.measured_usage_count, 1);
  assert.equal(root(trace).properties.provider_charge_count, 0);
  assert.equal(root(trace).properties.api_rate_estimate_count, 1);
  assert.equal(root(trace).properties.trace_complete, true);
});

test('parallel requests and concurrent sibling spans never borrow each other’s trip scope', async () => {
  const traces = [new InferenceTrace(input()), new InferenceTrace(input())];
  await Promise.all(traces.map(trace => trace.run(() => Promise.all(['model', 'routing'].map(stage => withInferenceSpan(stage as 'model' | 'routing', async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(currentInferenceTrace(), trace);
    await observeAiCall('typesafe', 'jev-latest', undefined, async f => f('https://provider.invalid'), async () => Response.json({}));
  }))))));
  for (const trace of traces) {
    trace.finish('completed');
    const events = trace.snapshot();
    assert.equal(events.filter(event => event.event === '$ai_generation').length, 2);
    assert.ok(events.every(event => event.properties.$ai_trace_id === trace.correlation.traceId));
    assert.equal(new Set(events.filter(event => event.event === '$ai_generation').map(event => event.properties.$ai_parent_id)).size, 2);
  }
  assert.equal(currentInferenceTrace(), undefined);
});

test('field allowlist removes content, arbitrary labels, errors, URLs, booking codes and nonfinite values', async () => {
  const canary = 'PRIVATE_EMAIL@example.com/BOOKING_SECRET?token=private';
  const metadata = { capability: canary, outcome: canary, errorCode: canary, contextChars: NaN, sourceCount: Infinity, policyVersion: canary,
    codeRevision: canary, workflowDigest: canary, prompt: canary, context: { value: canary }, url: canary, labels: [canary] } as TraceMetadata;
  assert.deepEqual(traceMetadata(metadata), {});
  const trace = new InferenceTrace(input());
  trace.set(metadata);
  const span = trace.begin('validation', metadata); span.finish('failed', metadata);
  await trace.run(() => observeAiCall('openai', 'gpt-4.1-mini', undefined, async f => { const response = await f(`https://provider.invalid/${canary}`, { method: 'POST', body: canary }); await response.json(); }, async () => Response.json({ model: canary, error: { message: canary }, choices: [{ message: { content: canary } }] })));
  trace.finish('failed', metadata);
  assert.ok(!JSON.stringify(trace.snapshot()).includes('PRIVATE'));
  assert.equal(root(trace).properties.$ai_error, 'turn_failed');
});

test('buffer is bounded, finish is idempotent and unfinished/pending traces do not claim completeness', () => {
  let batches = 0;
  const trace = new InferenceTrace(input(), { maxEvents: 4, onFinish: () => { batches++; throw new Error('PRIVATE_EXPORT'); } });
  for (let index = 0; index < 9; index++) trace.begin('routing').finish();
  trace.begin('model'); trace.finish('pending'); trace.finish('completed');
  assert.equal(trace.snapshot().length, 4); assert.equal(batches, 1);
  assert.equal(root(trace).properties.dropped_event_count, 6);
  assert.equal(root(trace).properties.unfinished_span_count, 1);
  assert.equal(root(trace).properties.trace_complete, false);
});

test('invalid event limits and statuses cannot create an unbounded buffer or a success claim', () => {
  const trace = new InferenceTrace(input(), { maxEvents: NaN });
  for (let index = 0; index < 150; index++) trace.begin('routing').finish();
  trace.finish('untrusted' as 'completed');
  assert.equal(trace.snapshot().length, 64);
  assert.equal(root(trace).properties.span_status, 'failed');
  assert.equal(root(trace).properties.trace_complete, false);
  assert.throws(() => trace.begin('PRIVATE_LABEL' as 'model'));
});

test('receipt replay has its own observation span and cannot overwrite a real attempt', () => {
  const scope = input(), executed = new InferenceTrace(scope), replayed = new InferenceTrace(scope, { replay: true });
  executed.finish('completed'); replayed.finish('replayed');
  const first = executed.snapshot().at(-1)!, second = replayed.snapshot().at(-1)!;
  assert.equal(first.properties.$ai_trace_id, second.properties.$ai_trace_id);
  assert.notEqual(first.properties.$ai_span_id, second.properties.$ai_span_id);
  assert.notEqual(first.uuid, second.uuid);
  assert.equal(second.properties.$ai_span_name, 'coordinator.replay');
  assert.equal(second.properties.execution_kind, 'receipt_read');
});

test('step failure and stopped streams record failures, not raw errors or zero usage/cost', async () => {
  const trace = new InferenceTrace(input());
  await assert.rejects(trace.run(() => withInferenceSpan('model', async () => observeAiCall('openai', 'gpt-4.1-mini', undefined, async f => {
    const response = await f('https://provider.invalid');
    assert.equal(response.bodyUsed, false, 'instrumentation must not consume or tee SSE');
    throw new Error('PRIVATE_STOPPED_STREAM');
  }, async () => new Response('data: {"choices":[]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })))));
  trace.finish('cancelled', { outcome: 'stopped' });
  const generation = trace.snapshot().find(event => event.event === '$ai_generation')!;
  assert.equal(generation.properties.usage_coverage, 'unknown');
  assert.equal(generation.properties.cost_coverage, 'unknown');
  assert.equal(generation.properties.$ai_input_tokens, undefined);
  assert.equal(generation.properties.$ai_total_cost_usd, undefined);
  assert.equal(generation.properties.$ai_is_error, true);
  assert.ok(!JSON.stringify(trace.snapshot()).includes('PRIVATE'));
});

test('live eligibility preserves opt-outs, environment, feature flag, identity and internal exclusions', () => {
  const environment = { VERCEL_ENV: 'production', NEXT_PUBLIC_POSTHOG_KEY: 'synthetic', COMMONS_INFERENCE_TRACING_ENABLED: 'true' };
  assert.equal(posthogTracingEligible(new Request('https://commons.invalid'), environment), true);
  for (const name of ['dnt', 'sec-gpc']) assert.equal(posthogTracingEligible(new Request('https://commons.invalid', { headers: { [name]: '1' } }), environment), false);
  for (const update of [{ VERCEL_ENV: 'preview' }, { COMMONS_INFERENCE_TRACING_ENABLED: 'false' }, { NEXT_PUBLIC_POSTHOG_KEY: '' }]) assert.equal(posthogTracingEligible(new Request('https://commons.invalid'), { ...environment, ...update }), false);
  assert.equal(posthogIdentityEligible(null), false);
  assert.equal(posthogIdentityEligible({ authUserId: randomUUID(), email: 'organizer@example.com' }), false);
  assert.equal(posthogIdentityEligible({ authUserId: randomUUID(), email: 'traveler@example.com' }), true);
});

test('export defers network until after response, caps/deduplicates the batch and never fails the app', async () => {
  const trace = new InferenceTrace(input()); trace.finish('completed');
  const events = trace.snapshot(), scheduled: Array<() => Promise<void>> = [], warnings: unknown[] = [];
  let calls = 0;
  const send = (events: InferenceEvent[], schedule = (run: () => Promise<void>) => { scheduled.push(run); }) => deferPosthogTrace(events, {
    apiKey: 'SYNTHETIC_KEY', distinctId: 'synthetic-actor', schedule, warn: (...args) => warnings.push(args), fetcher: async (_url, init) => {
      calls++; const body = JSON.parse(String(init?.body)); assert.equal(body.batch.length, 1); assert.equal(body.batch[0].uuid, events[0].uuid);
      assert.equal(body.batch[0].properties.distinct_id, 'synthetic-actor'); return new Response('PRIVATE_PROVIDER_ERROR', { status: 503 });
    },
  });
  send([...events, ...events]); assert.equal(calls, 0); await scheduled[0](); assert.equal(calls, 1);
  send(events, () => { throw new Error('PRIVATE_SCHEDULE'); });
  assert.deepEqual(warnings, [['delivery_failed', 503], ['schedule_failed', undefined]]);
});
