import { capturePosthogEvent } from "./posthog-client";
import type { ProductAnalyticsEventName } from "@commons/contracts";
import { sensitiveAnalyticsPath } from "./analytics-invitation-privacy";
import { syncOptOutCookie } from "./analytics-attribution";

type AnalyticsValue = string | number | boolean | null;

type ProductAnalyticsContext = {
  commonsSlug?: string;
  properties?: Record<string, AnalyticsValue>;
};

/** Product events go to PostHog only, and only when it is configured (NEXT_PUBLIC_POSTHOG_KEY). Nothing is stored by Commons. */
export function trackProductEvent(
  eventName: ProductAnalyticsEventName,
  context: ProductAnalyticsContext = {},
) {
  if (typeof window === "undefined") return;
  if (sensitiveAnalyticsPath(window.location.pathname) || document.querySelector('[data-analytics-exclude="true"]')) return;

  syncOptOutCookie();
  try {
    if (navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl || localStorage.getItem('commons:analytics:opt-out') === 'true') return;
  } catch { return; }
  capturePosthogEvent(eventName, context.properties);
}
