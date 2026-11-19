import { posthogConfig } from './posthog-config';
import type { PostHog } from 'posthog-js';
import { analyticsRoute, safeProductEvent } from './posthog-privacy';
import { attributionProperties, deviceClass } from './analytics-attribution';

let client: PostHog | undefined;
let loading: Promise<void> | undefined;
let recordingAllowed = false;
let currentRoute: string | null = null;

/** Optional: nothing starts without NEXT_PUBLIC_POSTHOG_KEY. Do Not Track, Global Privacy Control and the Commons opt-out always win. */
export function posthogAllowed() {
  if (typeof window === 'undefined') return false;
  try {
    return navigator.doNotTrack !== '1'
      && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
      && localStorage.getItem('commons:analytics:opt-out') !== 'true'
      && !document.querySelector('[data-analytics-exclude="true"]')
      && analyticsRoute(location.pathname) !== null;
  } catch { return false; }
}

export async function initializePosthog() {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY || !posthogAllowed()) return;
  loading ??= import('posthog-js').then(({ default: posthog }) => {
    if (!posthogAllowed()) { loading = undefined; return; }
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, posthogConfig(process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com', () => posthogAllowed(), () => location.pathname));
    client = posthog;
  }).catch(() => { loading = undefined; });
  await loading;
}

export async function updatePosthogRoute() {
  if (!posthogAllowed()) { if (recordingAllowed) client?.stopSessionRecording(); recordingAllowed = false; currentRoute = null; return; }
  await initializePosthog();
  if (!posthogAllowed()) return;
  // Session replay is opt-in per deployment, in addition to the privacy masking in posthog-config.ts.
  if (client && !recordingAllowed && process.env.NEXT_PUBLIC_POSTHOG_REPLAY === 'true') { client.startSessionRecording(); recordingAllowed = true; }
  const route = analyticsRoute(location.pathname);
  if (client && route !== currentRoute) { currentRoute = route; client.capture('$pageview', { ...attributionProperties(), deviceClass: deviceClass(globalThis.innerWidth ?? 0), sample: location.pathname.startsWith('/c/10000000-0000-4000-8000-000000000001') || location.pathname.startsWith('/c/cape-cod-couples-week') }); }
}

export function capturePosthogEvent(name: string, properties?: Record<string, unknown>) {
  if (!posthogAllowed()) return;
  const event = safeProductEvent(name, properties);
  if (!event || name === 'page_view') return;
  void initializePosthog().then(() => { if (posthogAllowed()) client?.capture(event.name, { ...event.properties, ...safeProductEvent(name, { ...attributionProperties(), deviceClass: deviceClass(globalThis.innerWidth ?? 0) })?.properties }); }).catch(() => { /* Telemetry never blocks a trip action. */ });
}
