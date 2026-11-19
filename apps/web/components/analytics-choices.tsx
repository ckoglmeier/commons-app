'use client';
import { useSyncExternalStore } from 'react';
import { updatePosthogRoute } from '@/lib/posthog-client';
import { syncOptOutCookie } from '@/lib/analytics-attribution';
const eventName = 'commons:analytics-choice';
function subscribe(callback: () => void) {
  window.addEventListener(eventName, callback);
  window.addEventListener('storage', callback);
  return () => { window.removeEventListener(eventName, callback); window.removeEventListener('storage', callback); };
}
function choice() {
  try { return localStorage.getItem('commons:analytics:opt-out') === 'true' ? 'off' : 'on'; } catch { return 'unavailable'; }
}
export function AnalyticsChoices() {
  const value = useSyncExternalStore(subscribe, choice, () => 'loading');
  function change() {
    try {
      localStorage.setItem('commons:analytics:opt-out', value === 'off' ? 'false' : 'true');
      syncOptOutCookie();
      window.dispatchEvent(new Event(eventName));
      void updatePosthogRoute();
    } catch { window.dispatchEvent(new Event(eventName)); }
  }
  return <div><p>Optional analytics help us understand page visits and improve the budget calculators. This choice applies to this browser. We also respect your browser’s Do Not Track and Global Privacy Control signals.</p><button type="button" className="cm-action-secondary" onClick={change} disabled={value === 'loading' || value === 'unavailable'}>{value === 'off' ? 'Allow optional analytics' : 'Turn off optional analytics'}</button><p role="status">{value === 'off' ? 'Optional analytics are off in this browser.' : value === 'unavailable' ? 'Browser storage is unavailable. Optional analytics stay off.' : value === 'loading' ? 'Checking this browser’s choice…' : 'Optional analytics are allowed unless your browser sends a privacy signal.'}</p></div>;
}
