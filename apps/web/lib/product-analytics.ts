import { capturePosthogEvent } from "./posthog-client";
import type { ProductAnalyticsEventName } from "@commons/contracts";
import { sensitiveAnalyticsPath, redactInvitationPath } from "./analytics-invitation-privacy";
import { attributionProperties, deviceClass, syncOptOutCookie } from "./analytics-attribution";
import { PUBLIC_DEMO_COMMONS_ID } from "./commons-route";

type AnalyticsValue = string | number | boolean | null;

type ProductAnalyticsContext = {
  commonsSlug?: string;
  properties?: Record<string, AnalyticsValue>;
};

const anonymousIdKey = "commons:analytics:anonymous-id";
const sessionIdKey = "commons:analytics:session-id";
let memoryAnonymousId: string | null = null;
let memorySessionId: string | null = null;

function browserId(storage: Storage, key: string, memory: "anonymous" | "session") {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    storage.setItem(key, created);
    return created;
  } catch {
    if (memory === "anonymous") return memoryAnonymousId ??= crypto.randomUUID();
    return memorySessionId ??= crypto.randomUUID();
  }
}

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
  try {
    // Allowlisted campaign slugs and a coarse device class only (analytics-attribution.ts); raw query values never leave.
    const campaign = attributionProperties();
    const properties: Record<string, AnalyticsValue> = {
      ...campaign,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      deviceClass: deviceClass(window.innerWidth),
      utmSource: campaign.utm_source ?? null,
      utmMedium: campaign.utm_medium ?? null,
      utmCampaign: campaign.utm_campaign ?? null,
      firstUtmSource: campaign.first_utm_source ?? null,
      firstUtmMedium: campaign.first_utm_medium ?? null,
      firstUtmCampaign: campaign.first_utm_campaign ?? null,
      sample: context.commonsSlug === PUBLIC_DEMO_COMMONS_ID || context.commonsSlug === "cape-cod-couples-week" || window.location.pathname.startsWith(`/c/${PUBLIC_DEMO_COMMONS_ID}`),
      ...context.properties,
    };

    const payload = JSON.stringify({
      eventName,
      anonymousId: browserId(window.localStorage, anonymousIdKey, "anonymous"),
      sessionId: browserId(window.sessionStorage, sessionIdKey, "session"),
      commonsSlug: context.commonsSlug,
      pagePath: redactInvitationPath(`${window.location.pathname}${window.location.search}`),
      referrer: document.referrer ? (() => { const ref = new URL(document.referrer); return `${ref.origin}${redactInvitationPath(ref.pathname + ref.search)}`; })() : undefined,
      properties,
      occurredAt: new Date().toISOString(),
    });

    void fetch("/api/v1/analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics never blocks a trip action.
  }
}
