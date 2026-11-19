import 'server-only';
import { after } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { getCommonsAuthIdentity } from '../supabase/server';
import { aiEventProperties, type AiEventLabels, type AiObserver } from './ai-observability';

/** Optional `$ai_generation` events for poll help. Off unless NEXT_PUBLIC_POSTHOG_KEY is set; DNT, GPC and the Commons opt-out are respected. */
export async function posthogAiObserver(request: Request, feature: 'poll_suggestions', conversationId?: string, labels: AiEventLabels = {}): Promise<AiObserver | undefined> {
  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey || request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return;
  if ((request.headers.get('cookie') ?? '').split(/;\s*/).includes('commons_analytics_opt_out=1')) return;
  try {
    const identity = await getCommonsAuthIdentity();
    if (!identity) return;
    const host = new URL(process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com').origin;
    const traceId = randomUUID();
    const sessionId = conversationId ? createHash('sha256').update(`${identity.authUserId}:${feature}:${conversationId}`).digest('hex') : null;
    return generation => {
      const body = JSON.stringify({ api_key: apiKey, event: '$ai_generation',
        properties: { distinct_id: identity.authUserId, ...aiEventProperties(generation, traceId, sessionId, feature, labels) } });
      after(async () => {
        try {
          const result = await fetch(`${host}/i/v0/e/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(4000) });
          if (!result.ok) console.warn('commons.ai_telemetry.delivery_failed', { status: result.status });
        } catch { console.warn('commons.ai_telemetry.delivery_failed'); }
      });
    };
  } catch { return; }
}
