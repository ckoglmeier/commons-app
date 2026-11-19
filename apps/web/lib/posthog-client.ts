import { posthogConfig } from './posthog-config';
import type { PostHog } from 'posthog-js';
import { analyticsRoute, safeProductEvent, safeIdentityProperties } from './posthog-privacy';
import { attributionProperties, deviceClass } from './analytics-attribution';

let client: PostHog | undefined;
let loading: Promise<void> | undefined;
let recordingAllowed = false;
let identityReady = false;
let refreshing: Promise<void> | undefined;
let currentRoute: string | null = null;
export function posthogAllowed() {
  if (typeof window === 'undefined') return false;
  try {
    return ['commons.travel', 'www.commons.travel'].includes(location.hostname)
      && navigator.doNotTrack !== '1'
      && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
      && localStorage.getItem('commons:analytics:opt-out') !== 'true'
      && !document.querySelector('[data-analytics-exclude="true"]')
      && analyticsRoute(location.pathname) !== null;
  } catch { return false; }
}

export async function initializePosthog() {
  if (!posthogAllowed() || !process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
  loading ??= import('posthog-js').then(({ default: posthog }) => {
    if (!posthogAllowed()) { loading = undefined; return; }
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, posthogConfig(process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com', () => identityReady && posthogAllowed(), () => location.pathname));
    client = posthog;
    return refreshPosthogIdentity();
  }).catch(() => { loading = undefined; });
  await loading;
}

export async function updatePosthogRoute() {
  if (!posthogAllowed()) { if (recordingAllowed) client?.stopSessionRecording(); recordingAllowed = false; currentRoute = null; return; }
  await initializePosthog();
  if (!posthogAllowed()) return;
  if (!identityReady) return;
  if (client && !recordingAllowed) { client.startSessionRecording(); recordingAllowed = true; }
  const route = analyticsRoute(location.pathname);
  if (client && route !== currentRoute) { currentRoute = route; client.capture('$pageview', { ...attributionProperties(), deviceClass: deviceClass(globalThis.innerWidth ?? 0), sample: location.pathname.startsWith('/c/10000000-0000-4000-8000-000000000001') || location.pathname.startsWith('/c/cape-cod-couples-week') }); if (route === '/c/[trip]/coordinator') client.capture('workspace_opened'); }
}

export function capturePosthogEvent(name: string, properties?: Record<string, unknown>) {
  if (!posthogAllowed()) return;
  const event = safeProductEvent(name, properties);
  if (!event || name === 'page_view') return;
  void initializePosthog().then(() => { if (identityReady && posthogAllowed()) client?.capture(event.name, { ...event.properties, ...safeProductEvent(name, { ...attributionProperties(), deviceClass: deviceClass(globalThis.innerWidth ?? 0) })?.properties }); }).catch(() => { /* Telemetry never blocks a trip action. */ });
}


export async function refreshPosthogIdentity() {
  if (!client || !posthogAllowed()) return;
  refreshing ??= (async () => {
    identityReady = false;
    try {
      const response = await fetch('/api/v1/analytics/identity', { cache: 'no-store', credentials: 'same-origin' });
      if (!response.ok) return;
      const { identity, excluded } = await response.json() as { excluded?: boolean; identity: { id: string; name: string | null; email: string | null } | null };
      if (!posthogAllowed() || !client) return;
      if (excluded) {
        client.stopSessionRecording(); recordingAllowed = false; currentRoute = null;
        client.reset(true);
        sessionStorage.removeItem('commons:analytics:identified-user');
        return;
      }
      const previous = sessionStorage.getItem('commons:analytics:identified-user');
      if (previous && previous !== identity?.id) {
        client.stopSessionRecording(); recordingAllowed = false;
        client.reset(true);
      }
      identityReady = true;
      if (identity) {
        client.identify(identity.id, { ...safeIdentityProperties(identity), ...attributionProperties() });
        if (previous !== identity.id) client.capture('account_identified', attributionProperties());
        sessionStorage.setItem('commons:analytics:identified-user', identity.id);
      } else {
        sessionStorage.removeItem('commons:analytics:identified-user');
      }
    } catch { /* Uncertain authentication suppresses telemetry until the next refresh. */ }
  })().finally(() => { refreshing = undefined; });
  await refreshing;
}
