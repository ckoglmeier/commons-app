"use client";

import type { BeforeSendEvent } from "@vercel/analytics";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { trackProductEvent } from "@/lib/product-analytics";
import { sensitiveAnalyticsPath, redactInvitationPath } from "@/lib/analytics-invitation-privacy";

function redactInvitationTokens(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url);
    if (sensitiveAnalyticsPath(url.pathname)) return null;
    return { ...event, url: `${url.origin}${redactInvitationPath(url.pathname + url.search)}` };
  } catch {
    return null;
  }
}

/** Vercel Web Analytics and Speed Insights load only on Vercel, and collect only if they are turned on for the project there. */
export function ProductAnalytics({ vercelAnalytics = false }: { vercelAnalytics?: boolean }) {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname && sensitiveAnalyticsPath(pathname)) return;
    // The trip segment lets reports count an organizer's return visit to their own trip (signed-in rows only).
    const trip = pathname?.match(/^\/c\/([^/]+)/)?.[1];
    trackProductEvent("page_view", trip && trip !== "poll" ? { commonsSlug: trip } : {});
  }, [pathname]);

  useEffect(() => {
    if (pathname && sensitiveAnalyticsPath(pathname)) return;
    function captureAnnotatedClick(event: MouseEvent) {
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-analytics-event]");
      if (!target) return;
      const eventName = target.dataset.analyticsEvent;
      if (!eventName) return;
      trackProductEvent(eventName as Parameters<typeof trackProductEvent>[0], {
        commonsSlug: target.dataset.analyticsCommons,
        properties: {
          detail: target.dataset.analyticsDetail ?? null,
        },
      });
    }

    document.addEventListener("click", captureAnnotatedClick);
    return () => document.removeEventListener("click", captureAnnotatedClick);
  }, [pathname]);

  // Exclude sensitive authentication routes and local design experiments from analytics.
  if (!vercelAnalytics || (pathname && sensitiveAnalyticsPath(pathname))) return null;

  return (
    <>
      <Analytics beforeSend={redactInvitationTokens} />
      <SpeedInsights sampleRate={1} />
    </>
  );
}
