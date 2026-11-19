import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiEventLabels, AiObserver } from './ai-observability';
import type { InferenceTrace } from './inference-tracing';

/** Request-local only. A queue/worker must explicitly reestablish a trusted scope; this is not a global current trip. */
export const inferenceScopes = new AsyncLocalStorage<{ trace: InferenceTrace; parentId: string }>();
export function currentInferenceTrace() { return inferenceScopes.getStore()?.trace; }
export function inferenceObserver(labels: AiEventLabels = {}): AiObserver | undefined {
  const trace = currentInferenceTrace();
  return trace ? generation => trace.generation(generation, labels) : undefined;
}
