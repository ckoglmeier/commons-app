/** Trust exact configured origins, never arbitrary forwarded host headers. */
export function analyticsOriginAllowed(origin: string | null, requestUrl: string, configuredSite?: string) {
  if (!origin) return true; // Same-origin beacons may omit Origin.
  try {
    const parsed = new URL(origin);
    if (!["https:", "http:"].includes(parsed.protocol) || origin !== parsed.origin) return false;
    if (parsed.origin === new URL(requestUrl).origin) return true;
    return Boolean(configuredSite && parsed.origin === new URL(configuredSite).origin);
  } catch { return false; }
}
