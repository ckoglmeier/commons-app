export { analyticsRoute } from './analytics-route';
import { safeAcquisitionProperties } from './analytics-attribution';

const events = new Set(['$pageview', 'event_creation_access_requested', 'account_identified', 'event_creation_viewed', 'event_description_submitted', 'event_setup_reviewed', 'event_creation_committed', 'trip_created', 'trip_tab_viewed', 'poll_published',
  // Poll drafting help, participant-to-organizer entry and held-back links (counts and codes only).
  'poll_draft_started', 'poll_assist_requested', 'poll_assist_applied', 'poll_assist_failed', 'participant_trip_start_clicked', 'held_feature_link_opened']);
export function safeProductEvent(name: string, properties: Record<string, unknown> = {}) {
  if (!events.has(name)) return null;
  const safe: Record<string, string | number | boolean> = {};
  for (const key of ['participantCount', 'correctedFieldCount']) {
    const value = properties[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000) safe[key] = value;
  }
  for (const key of ['hasDates', 'hasLocation', 'sendInvitations', 'hasDraft']) if (typeof properties[key] === 'boolean') safe[key] = properties[key];
  if (['setup', 'workspace'].includes(String(properties.surface))) safe.surface = String(properties.surface);
  if (['home', 'plan', 'money', 'moments', 'photos'].includes(String(properties.tab))) safe.tab = String(properties.tab);
  if (['completed', 'failed', 'pending', 'rejected', 'not_saved', 'unconfirmed', 'not_run', 'queue_full'].includes(String(properties.outcome))) safe.outcome = String(properties.outcome);
  for (const key of ['latencyMs', 'delegationLatencyMs']) {
    const value = properties[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3_600_000) safe[key] = Math.round(value);
  }
  if (typeof properties.queued === 'boolean') safe.queued = properties.queued;
  // Sample/live and role separate public-sample, organizer and participant activity; campaign values arrive already
  // allowlisted by analytics-attribution.ts and are re-checked here; device is a coarse class.
  if (typeof properties.sample === 'boolean') safe.sample = properties.sample;
  if (['organizer', 'participant'].includes(String(properties.role))) safe.role = String(properties.role);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'first_utm_source', 'first_utm_medium', 'first_utm_campaign']) {
    const value = properties[key];
    if (typeof value === 'string' && /^[a-z0-9][a-z0-9_.-]{0,39}$/.test(value)) safe[key] = value;
  }
  if (['mobile', 'tablet', 'desktop'].includes(String(properties.deviceClass))) { safe.deviceClass = String(properties.deviceClass); safe.$device_type = String(properties.deviceClass) === 'desktop' ? 'Desktop' : String(properties.deviceClass) === 'tablet' ? 'Tablet' : 'Mobile'; }
  for (const key of ['questionCount', 'optionCount']) {
    const value = properties[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100) safe[key] = value;
  }
  if (['draft', 'revise'].includes(String(properties.mode))) safe.mode = String(properties.mode);
  return { name, properties: { ...safe, ...safeAcquisitionProperties(properties) } };
}

export function replayAttribute(name: string, value: string): string {
  // Preserve readable content and CSS, but never form values or credential-bearing links.
  if (['class', 'type', 'role', 'rel', 'media', 'disabled', 'checked', 'selected', 'aria-expanded', 'aria-pressed', 'width', 'height', 'title', 'alt', 'aria-label'].includes(name)) return value;
  if (name === 'href' || name === 'src') {
    try {
      const origin = typeof location !== 'undefined' && location.origin !== 'null' ? location.origin : 'https://commons.invalid';
      const url = new URL(value, origin);
      if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) return '';
      if (/^\/_next\/static\/[a-zA-Z0-9_./-]+\.css$/.test(url.pathname) && url.origin === origin) return value;
      if (name === 'src' && !/\/(?:auth|join|invite|sign-in|token)(?:\/|$)/i.test(url.pathname)) return value;
    } catch { /* Invalid assets are not recorded. */ }
  }
  return '';
}

export function safeIdentityProperties(input: Record<string, unknown> = {}) {
  const result: Record<string, string> = {};
  if (typeof input.name === 'string' && input.name.trim()) result.name = input.name.trim().slice(0, 200);
  if (typeof input.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) result.email = input.email.slice(0, 254);
  return result;
}
