/** Coordinates a person already chose in Google or Apple Maps, read from the
 * link itself. A bare map view (only a viewport center) is not a place. */
export type LinkPin = { latitude: number; longitude: number; source: "map_link" | "page" };

export function coordinatePair(latitude: unknown, longitude: unknown) {
  const lat = typeof latitude === "string" && latitude.trim() ? Number(latitude) : latitude;
  const lng = typeof longitude === "string" && longitude.trim() ? Number(longitude) : longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { latitude: lat, longitude: lng };
}

function pairText(value: string | null) {
  const match = value?.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
  return match ? coordinatePair(match[1], match[2]) : null;
}

function words(value: string | null | undefined) {
  if (!value) return undefined;
  let text = value;
  try { text = decodeURIComponent(value.replace(/\+/g, " ")); } catch { /* Keep the raw segment. */ }
  text = text.replace(/\s+/g, " ").trim();
  return text && !pairText(text) ? text.slice(0, 120) : undefined;
}

export function isGoogleMapsUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  return /^(?:www\.)?google\.[a-z.]{2,8}$/.test(host) && url.pathname.startsWith("/maps")
    || /^maps\.google\.[a-z.]{2,8}$/.test(host);
}

export function isAppleMapsUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  return host === "maps.apple.com" || host === "maps.apple";
}

export function mapLinkPlace(url: URL): { title?: string; siteName: string; pin: LinkPin } | null {
  if (isGoogleMapsUrl(url)) {
    const path = decodeURIComponent(url.pathname);
    // The place marker (!3d…!4d…) is more precise than the viewport (@…).
    const marker = path.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    const place = path.match(/\/maps\/place\/([^/]+)/)?.[1];
    const viewport = place ? path.match(/\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/) : null;
    const point = (marker && coordinatePair(marker[1], marker[2]))
      ?? pairText(url.searchParams.get("q")) ?? pairText(url.searchParams.get("query")) ?? pairText(url.searchParams.get("ll"))
      ?? (viewport && coordinatePair(viewport[1], viewport[2]));
    if (!point) return null;
    return { title: words(place) ?? words(url.searchParams.get("q")) ?? words(url.searchParams.get("query")), siteName: "Google Maps", pin: { ...point, source: "map_link" } };
  }
  if (isAppleMapsUrl(url)) {
    const point = pairText(url.searchParams.get("coordinate")) ?? pairText(url.searchParams.get("ll")) ?? pairText(url.searchParams.get("q"));
    if (!point) return null;
    return { title: words(url.searchParams.get("name")) ?? words(url.searchParams.get("q")), siteName: "Apple Maps", pin: { ...point, source: "map_link" } };
  }
  return null;
}
