import { LinkPreviewSchema, type LinkPreview, type LinkPreviewKind } from "@commons/contracts";
import { isIP } from "node:net";
import { visibleVenueDetails } from "./link-preview-visible";
import { descriptionWithVenueDetails, publishedVenueDetails } from "./link-preview-hours";
import { coordinatePair, mapLinkPlace } from "./map-link";

export class LinkPreviewError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "LinkPreviewError";
  }
}

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"', nbsp: " " };
  return value.replace(/&(#x?[\da-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    }
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function plainText(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  const normalized = decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength).trim() : undefined;
}

function attributes(tag: string) {
  const values: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) values[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  return values;
}

function metadata(html: string) {
  const values = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    if (key && attrs.content && !values.has(key)) values.set(key, attrs.content);
  }
  return values;
}

type StructuredObject = Record<string, unknown>;
function asObject(value: unknown): StructuredObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as StructuredObject : undefined;
}

function jsonLdObjects(html: string): StructuredObject[] {
  const objects: StructuredObject[] = [];
  let exceeded = false;
  // Bound traversal as well as the fetched HTML. Never fetch remote @context or @id.
  function visit(value: unknown, depth = 0) {
    if (depth > 12 || objects.length >= 512) { exceeded = true; return; }
    if (Array.isArray(value)) {
      if (value.length > 512) exceeded = true;
      for (const item of value.slice(0, 512)) visit(item, depth + 1);
      return;
    }
    const object = asObject(value);
    if (!object) return;
    objects.push(object);
    for (const child of Object.values(object)) visit(child, depth + 1);
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(match[1]).type?.toLowerCase() !== "application/ld+json") continue;
    try {
      // Script contents are raw text: decoding entities before JSON.parse breaks
      // valid quoted names. Support entity-escaped publisher JSON only as fallback.
      let value: unknown;
      try { value = JSON.parse(match[2]); } catch { value = JSON.parse(decodeHtml(match[2])); }
      visit(value);
    } catch { /* Malformed metadata must not prevent the ordinary page preview. */ }
  }
  return exceeded ? [] : objects;
}

function schemaTypes(value: unknown): string[] {
  if (typeof value === "string") return [value.toLowerCase()];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase()) : [];
}

function inferKind(hostname: string, objects: Record<string, unknown>[]): LinkPreviewKind {
  const types = objects.flatMap((object) => schemaTypes(object["@type"]));
  if (hostname === "alltrails.com" || hostname.endsWith(".alltrails.com") || types.some((type) => /touristattraction|exerciseaction|trail/.test(type))) return "activity";
  if (types.some((type) => /restaurant|foodestablishment/.test(type))) return "restaurant";
  if (types.some((type) => /hotel|lodgingbusiness|vacationrental/.test(type))) return "lodging";
  if (types.some((type) => /place|localbusiness/.test(type))) return "place";
  return "link";
}

function structuredDetails(url: URL, objects: StructuredObject[], pageTitle: string | undefined, html: string) {
  function id(value: unknown) {
    if (typeof value !== "string") return undefined;
    try { return new URL(value, url).href; } catch { return undefined; }
  }
  const byId = new Map<string, StructuredObject>();
  const conflictingIds = new Set<string>();
  for (const object of objects) {
    const key = id(object["@id"]);
    if (key && Object.keys(object).length > 1) {
      if (byId.has(key) && JSON.stringify(byId.get(key)) !== JSON.stringify(object)) conflictingIds.add(key);
      byId.set(key, object);
    }
  }
  function resolve(value: unknown): StructuredObject | undefined {
    const object = asObject(value);
    const key = id(typeof value === "string" ? value : object?.["@id"]);
    if (key && conflictingIds.has(key)) return undefined;
    return key && byId.has(key) ? byId.get(key) : object;
  }
  function list(value: unknown): StructuredObject[] {
    return (Array.isArray(value) ? value : [value]).map(resolve).filter((item): item is StructuredObject => Boolean(item));
  }
  function samePage(value: unknown) {
    const key = id(value);
    return key ? key.split("#")[0] === url.href.split("#")[0] : false;
  }
  const isSubject = (object: StructuredObject) => schemaTypes(object["@type"]).some(type =>
    /^(?:https?:\/\/schema\.org\/)?(?:Restaurant|FoodEstablishment|Hotel|LodgingBusiness|VacationRental|Place|LocalBusiness|TouristAttraction|TouristTrip|Event|SportsEvent|MusicEvent|TheaterEvent|ExhibitionEvent|ExerciseAction|Trail|Museum|Park|Winery)$/i.test(type));
  const pages = objects.filter(object => schemaTypes(object["@type"]).some(type => /(?:^|\/)webpage$/i.test(type)) &&
    (samePage(object.url) || samePage(object["@id"])));
  const explicitValues = pages.flatMap(page => page.mainEntity === undefined ? [] : Array.isArray(page.mainEntity) ? page.mainEntity : [page.mainEntity]);
  const explicit = explicitValues.map(resolve);
  const subordinate = new Set(objects.flatMap(object =>
    [object.location, object.publisher, object.organizer, object.brand].flatMap(list)));
  const candidates = objects.filter(object => isSubject(object) && !subordinate.has(object));
  const linked = candidates.filter(object => samePage(object.url) || samePage(object["@id"]) ||
    samePage(object.mainEntityOfPage) || samePage(asObject(object.mainEntityOfPage)?.["@id"]));
  const nameKey = (value: unknown) => typeof value === "string" ? plainText(value, 500)?.toLowerCase() : undefined;
  const named = candidates.filter(object => nameKey(object.name) && nameKey(object.name) === nameKey(pageTitle));
  const selected = [...new Set((explicitValues.length ? explicit : linked.length ? linked : named.length ? named : candidates).map(object => resolve(object)))];
  const primary = selected.length === 1 ? selected[0] : undefined;

  function address(value: unknown): string | undefined {
    const object = resolve(value);
    if (!object) return typeof value === "string" ? plainText(value, 160) : undefined;
    const country = resolve(object.addressCountry);
    const parts = [object.streetAddress, object.addressLocality, object.addressRegion, object.postalCode,
      typeof object.addressCountry === "string" ? object.addressCountry : country?.name];
    return plainText(parts.filter((part): part is string => typeof part === "string" && Boolean(part.trim())).join(", "), 160);
  }
  function location(object: StructuredObject, seen = new Set<StructuredObject>()): string | undefined {
    if (seen.has(object) || seen.size >= 12) return undefined;
    const next = new Set(seen).add(object);
    // Do not traverse publisher, organizer, offers or arbitrary nested addresses.
    if (object.location !== undefined) {
      const venues = Array.isArray(object.location) ? object.location : [object.location];
      const addresses = venues.map(value => {
        const venue = resolve(value);
        return venue ? location(venue, next) : undefined;
      });
      const unique = new Set(addresses);
      return unique.size === 1 ? addresses[0] : undefined;
    }
    if (Array.isArray(object.address)) {
      const addresses = object.address.map(address);
      return new Set(addresses).size === 1 ? addresses[0] : undefined;
    }
    return address(object.address);
  }
  function venue(object: StructuredObject, seen = new Set<StructuredObject>()): StructuredObject | undefined {
    if (seen.has(object) || seen.size >= 12) return undefined;
    if (object.location === undefined) return object;
    const locations = Array.isArray(object.location) ? object.location : [object.location];
    const child = locations.length === 1 ? resolve(locations[0]) : undefined;
    return child ? venue(child, new Set(seen).add(object)) : undefined;
  }
  const selectedVenue = primary && isSubject(primary) ? venue(primary) : undefined;
  // Only the one selected venue's own coordinates; never a publisher or nested address.
  function geo(object: StructuredObject) {
    const values = Array.isArray(object.geo) ? object.geo : object.geo === undefined ? [] : [object.geo];
    const points = values.map(resolve).map(point => point && coordinatePair(point.latitude, point.longitude));
    if (points.length === 1) return points[0] ?? undefined;
    return points.length ? undefined : coordinatePair(object.latitude, object.longitude) ?? undefined;
  }
  return { primary, location: primary && isSubject(primary) ? location(primary) : undefined, geo: selectedVenue ? geo(selectedVenue) : undefined,
    venueDetails: publishedVenueDetails(selectedVenue, resolve, plainText, selectedVenue && schemaTypes(selectedVenue["@type"]).some(type => /(?:^|\/)(?:restaurant|foodestablishment)$/i.test(type)) ? visibleReservationPolicy(html) : undefined) };

}

function visibleReservationPolicy(html: string) {
  const visible = html.replace(/<!--[^]*?-->/g, "").replace(/<(script|style|nav|footer)\b[^>]*>[^]*?<\/\1>/gi, "");
  const policies: string[] = [];
  const headings = [...visible.matchAll(/<h([1-6])\b[^>]*>([^]*?)<\/h[1-6]>/gi)];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const label = plainText(heading[2], 120);
    if (label && /^(?:our )?(?:reservation|booking|cancellation|cancellations|no.show)(?:s| policy| policies| information)?$/i.test(label)) {
      // Include lists, nested containers and subheadings: never drop a later fee or exception.
      const next = headings.slice(index + 1).find(candidate => Number(candidate[1]) <= Number(heading[1]));
      const body = visible.slice(heading.index! + heading[0].length, next?.index ?? visible.length);
      const full = plainText(body, 10000); if (full) policies.push(`${label}: ${full}`);
    }
  }
  return policies.length ? [...new Set(policies)].join(" ") : undefined;
}

function sourceName(url: URL, meta: Map<string, string>) {
  const supplied = plainText(meta.get("og:site_name"), 80);
  if (supplied) return supplied;
  if (url.hostname === "alltrails.com" || url.hostname.endsWith(".alltrails.com")) return "AllTrails";
  if (url.hostname === "maps.google.com" || url.hostname === "google.com" || url.hostname.endsWith(".google.com")) return "Google Maps";
  return url.hostname.replace(/^www\./, "").split(".").slice(0, -1).join(".") || url.hostname;
}

export function normalizeExternalUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new LinkPreviewError("Paste a complete web link, including https://.");
  }
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) throw new LinkPreviewError("Only http and https links can be added.");
  if (url.username || url.password) throw new LinkPreviewError("That link includes private sign-in details and cannot be added.");
  if (url.port && !(["80", "443"] as string[]).includes(url.port)) throw new LinkPreviewError("That link uses an unsupported network port.");
  url.hash = "";
  return url;
}

function isPrivateIpv4(address: string) {
  const [a, b] = address.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isPrivateNetworkAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized)) return true;
  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? isPrivateIpv4(mapped) : false;
}

export function extractLinkPreview(url: URL, html: string): LinkPreview {
  const meta = metadata(html);
  const objects = jsonLdObjects(html);
  const documentTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const details = structuredDetails(url, objects, meta.get("og:title") ?? meta.get("twitter:title") ?? documentTitle, html);
  const primaryObject = details.primary;
  const rawTitle = meta.get("og:title") ?? meta.get("twitter:title") ?? (typeof primaryObject?.name === "string" ? primaryObject.name : undefined) ?? documentTitle;
  const siteName = sourceName(url, meta);
  const pageTitle = plainText(rawTitle, 120)?.replace(/\s+[|–—-]\s+AllTrails(?:\.com)?$/i, "").trim();
  // "The Lodge at Sonoma | Luxury Resort & Spa" becomes the venue's own name.
  const venueName = typeof primaryObject?.name === "string" ? plainText(primaryObject.name, 120) : undefined;
  const lead = pageTitle?.split(/\s+[|–—]\s+/)[0]?.trim();
  const title = venueName && pageTitle && lead && lead !== pageTitle
    && (venueName.toLowerCase().startsWith(lead.toLowerCase()) || lead.toLowerCase().startsWith(venueName.toLowerCase())) ? lead : pageTitle;
  if (!title) throw new LinkPreviewError("Commons couldn’t find a title on that page. You can still add it manually.", 422);
  const visible = objects.length === 0 ? visibleVenueDetails(html, siteName, title, plainText) : undefined;
  const rawDescription = meta.get("og:description") ?? meta.get("description") ?? meta.get("twitter:description") ?? (typeof primaryObject?.description === "string" ? primaryObject.description : undefined);
  return LinkPreviewSchema.parse({
    url: url.toString(),
    title,
    description: descriptionWithVenueDetails(plainText(rawDescription, 500), details.venueDetails ?? visible?.venueDetails),
    location: details.location ?? visible?.location,
    siteName,
    kind: inferKind(url.hostname.toLowerCase(), objects),
    detailStatus: "extracted",
    pin: mapLinkPlace(url)?.pin ?? (details.geo ? { ...details.geo, source: "page" } : undefined),
  });
}

/** A Google or Apple Maps link already names the place and its position.
 * Commons reads them from the link without loading the maps page. */
export function mapLinkPreview(url: URL, original: URL): LinkPreview | undefined {
  const place = mapLinkPlace(url);
  if (!place) return undefined;
  return LinkPreviewSchema.parse({
    url: (url.href.length <= 2_000 ? url : original).toString(),
    title: place.title ?? `Place on ${place.siteName}`,
    siteName: place.siteName,
    kind: "place",
    detailStatus: place.title ? "extracted" : "link_only",
    pin: place.pin,
  });
}

export function fallbackLinkPreview(url: URL): LinkPreview {
  const siteName = sourceName(url, new Map());
  const lastPathPart = url.pathname.split("/").filter(Boolean).at(-1);
  let title = siteName;
  if (lastPathPart) {
    try {
      title = decodeURIComponent(lastPathPart)
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
        .slice(0, 120);
    } catch {
      // Keep the publisher name when a malformed path cannot be decoded.
    }
  }
  return LinkPreviewSchema.parse({
    url: url.toString(),
    title,
    siteName,
    kind: inferKind(url.hostname.toLowerCase(), []),
    detailStatus: "link_only",
  });
}
