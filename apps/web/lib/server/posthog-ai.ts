import 'server-only';
import { after } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { getCommonsAuthIdentity } from '../supabase/server';
import { isPosthogExcluded } from '../posthog-exclusions';
import { aiEventProperties, type AiEventLabels, type AiObserver } from './ai-observability';
import { InferenceTrace, currentInferenceTrace, inferenceObserver } from './inference-tracing';
import { deferPosthogTrace, posthogIdentityEligible, posthogTracingEligible } from './posthog-trace-export';

/** Authenticated server scope is required; inbound headers never determine trace identity or permissions. */
export async function coordinatorInferenceTrace(request: Request | undefined, input: ConstructorParameters<typeof InferenceTrace>[0], startedAt: number, replay = false): Promise<InferenceTrace | undefined> {
  if (!request || !posthogTracingEligible(request, { VERCEL_ENV: process.env.VERCEL_ENV, NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY, COMMONS_INFERENCE_TRACING_ENABLED: process.env.COMMONS_INFERENCE_TRACING_ENABLED })) return;
  try {
    const identity = await getCommonsAuthIdentity();
    if (!identity || !posthogIdentityEligible(identity)) return;
    return new InferenceTrace(input, { startedAt, replay, onFinish: events => deferPosthogTrace(events, {
      apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY!, distinctId: identity.authUserId, schedule: after,
      warn: (code, status) => console.warn(`commons.ai_telemetry.${code}`, status ? { status } : {}),
    }) });
  } catch { return; }
}

export async function posthogAiObserver(request: Request, feature: 'setup' | 'workspace' | 'poll_suggestions', conversationId?: string, labels: AiEventLabels = {}): Promise<AiObserver | undefined> {
  if (process.env.VERCEL_ENV !== 'production' || !process.env.NEXT_PUBLIC_POSTHOG_KEY || request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return;
  if ((request.headers.get('cookie') ?? '').split(/;\s*/).includes('commons_analytics_opt_out=1')) return;
  if (feature === 'workspace' && currentInferenceTrace()) return inferenceObserver(labels);
  try {
    const identity = await getCommonsAuthIdentity();
    if (!identity || isPosthogExcluded(identity.email)) return;
    const traceId = randomUUID();
    const sessionId = conversationId ? createHash('sha256').update(`${identity.authUserId}:${feature}:${conversationId}`).digest('hex') : null;
    return generation => {
      const body = JSON.stringify({ api_key: process.env.NEXT_PUBLIC_POSTHOG_KEY, event: '$ai_generation',
        properties: { distinct_id: identity.authUserId, ...aiEventProperties(generation, traceId, sessionId, feature, labels) } });
      after(async () => {
        try {
          const result = await fetch('https://us.i.posthog.com/i/v0/e/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(4000) });
          if (!result.ok) console.warn('commons.ai_telemetry.delivery_failed', { status: result.status });
        } catch { console.warn('commons.ai_telemetry.delivery_failed'); }
      });
    };
  } catch { return; }
}
