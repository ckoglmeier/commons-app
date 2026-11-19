import { safeAcquisitionProperties } from './analytics-attribution';
import type { PostHogConfig } from 'posthog-js';
import { analyticsRoute, replayAttribute, safeProductEvent, safeIdentityProperties } from './posthog-privacy';

export function posthogConfig(host: string, allowed: () => boolean, pathname: () => string): Partial<PostHogConfig> {
  return {
      api_host: host,
      // Wait for identity eligibility before starting; otherwise the initial full snapshot can be dropped.
      disable_session_recording: true,
      autocapture: false, capture_pageview: false, capture_pageleave: false,
      capture_performance: false, capture_exceptions: false,
      enable_recording_console_log: false, disable_surveys: true,
      person_profiles: 'identified_only', persistence: 'sessionStorage', reuseAnonymousId: true,
      ip: false, respect_dnt: true,
      session_recording: {
        maskAllInputs: true, maskTextSelector: '.ph-mask, [data-replay-mask]', maskAttributeFn: replayAttribute,
        blockSelector: 'video, audio, canvas, iframe, [autocomplete^="cc-"], [autocomplete="one-time-code"], input[type="hidden"], input[type="file"], [data-analytics-exclude="true"], .ph-no-capture',
        recordHeaders: false, recordBody: false, recordCrossOriginIframes: false,
        inlineStylesheet: false, captureJsonLd: false, slimDOMOptions: 'all',
        maskCapturedNetworkRequestFn: data => (data.isInitial || Object.keys(data).length === 1) ? { ...data, name: `https://commons.invalid${analyticsRoute(pathname()) ?? '/excluded'}` } : null,
      },
      before_send: event => {
        if (!event || !allowed()) return null;
        // No page query, referrer, title, identity, free text or unapproved custom properties.
        const route = analyticsRoute(pathname());
        if (!route) return null;
        const safe = safeProductEvent(event.event, event.properties);
        if (event.event !== '$snapshot' && event.event !== '$identify' && !safe) return null;
        const keep = new Set(['token', 'distinct_id', '$anon_distinct_id', '$user_id', '$is_identified', '$device_id', '$session_id', '$window_id', '$lib', '$lib_version', '$snapshot_data', '$snapshot_bytes', '$session_recording']);
        const properties: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(event.properties)) if (keep.has(key)) properties[key] = value;
        return { ...event, $set: event.event === '$identify' ? { ...safeIdentityProperties(event.$set ?? event.properties.$set), ...safeAcquisitionProperties(event.$set ?? event.properties.$set ?? {}) } : undefined, $set_once: undefined, $unset: undefined, properties: { ...properties, ...safe?.properties, route, $current_url: `https://commons.invalid${route}`, $pathname: route, $process_person_profile: event.event === '$identify' || event.properties.$process_person_profile === true, $geoip_disable: true } };
      },
    };
}
