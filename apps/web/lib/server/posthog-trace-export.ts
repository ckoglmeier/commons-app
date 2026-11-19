import { isPosthogExcluded } from '../posthog-exclusions';
import type { InferenceEvent } from './inference-tracing';

type Environment = { VERCEL_ENV?: string; NEXT_PUBLIC_POSTHOG_KEY?: string; COMMONS_INFERENCE_TRACING_ENABLED?: string };
export function posthogTracingEligible(request: Request, environment: Environment) {
  return environment.COMMONS_INFERENCE_TRACING_ENABLED === 'true' && environment.VERCEL_ENV === 'production' && Boolean(environment.NEXT_PUBLIC_POSTHOG_KEY)
    && request.headers.get('dnt') !== '1' && request.headers.get('sec-gpc') !== '1';
}
export function posthogIdentityEligible(identity: { authUserId: string; email?: string | null } | null) {
  return Boolean(identity?.authUserId && !isPosthogExcluded(identity.email));
}

/** Bounded, best-effort analytics. Deliberately no retry after ambiguous delivery and no durable/exactly-once claim. */
export function deferPosthogTrace(events: InferenceEvent[], options: {
  apiKey: string; distinctId: string; schedule: (run: () => Promise<void>) => void; fetcher?: typeof fetch;
  warn?: (code: 'schedule_failed' | 'delivery_failed', status?: number) => void;
}) {
  const seen = new Set<string>();
  const batch = events.slice(0, 128).filter(event => !seen.has(event.uuid) && Boolean(seen.add(event.uuid)))
    .map(event => ({ ...event, properties: { ...event.properties, distinct_id: options.distinctId } }));
  if (!batch.length) return;
  const warn = (code: 'schedule_failed' | 'delivery_failed', status?: number) => { try { options.warn?.(code, status); } catch { /* Logging must also be best effort. */ } };
  try {
    const body = JSON.stringify({ api_key: options.apiKey, batch });
    options.schedule(async () => {
      try {
        const response = await (options.fetcher ?? fetch)('https://us.i.posthog.com/batch/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(4000) });
        if (!response.ok) warn('delivery_failed', response.status);
      } catch { warn('delivery_failed'); }
    });
  } catch { warn('schedule_failed'); }
}
