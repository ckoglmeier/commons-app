/*
 * Privacy-safe acquisition attribution.
 * Campaign slugs, referral hostname, source category and a normalized landing route only.
 * No search terms, full referrer URLs, arbitrary query parameters or fingerprinting. Device is a coarse class from
 * the viewport width. Nothing is stored or attached when Do Not Track, Global Privacy Control or the Commons
 * opt-out is set.
 */

export type CampaignAttribution = { utm_source?: string; utm_medium?: string; utm_campaign?: string };
export type DeviceClass = "mobile" | "tablet" | "desktop";

const FIRST_TOUCH_KEY = "commons:analytics:first-touch";
const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;

export function sanitizeCampaignValue(value: string | null | undefined) {
  if (value === null || value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return /^[a-z0-9][a-z0-9_.-]{0,39}$/.test(normalized) ? normalized : "other";
}

export function campaignFromSearch(search: string): CampaignAttribution {
  const params = new URLSearchParams(search);
  const result: CampaignAttribution = {};
  for (const key of CAMPAIGN_KEYS) { const value = sanitizeCampaignValue(params.get(key)); if (value) result[key] = value; }
  return result;
}

export function deviceClass(width: number): DeviceClass {
  return width < 768 ? "mobile" : width < 1100 ? "tablet" : "desktop";
}

/** Mirrors the Commons analytics opt-out into a first-party cookie so server-side telemetry can honour it too. */
export const OPT_OUT_COOKIE = "commons_analytics_opt_out";
export function syncOptOutCookie() {
  try {
    const optedOut = localStorage.getItem("commons:analytics:opt-out") === "true";
    const present = document.cookie.split("; ").some(part => part === `${OPT_OUT_COOKIE}=1`);
    if (optedOut && !present) document.cookie = `${OPT_OUT_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
    if (!optedOut && present) document.cookie = `${OPT_OUT_COOKIE}=; path=/; max-age=0; samesite=lax`;
  } catch { /* Storage or cookies unavailable: nothing to mirror. */ }
}

export function attributionConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return navigator.doNotTrack !== "1"
      && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
      && localStorage.getItem("commons:analytics:opt-out") !== "true";
  } catch { return false; }
}

/** Current-page campaign plus the first allowlisted campaign this browser arrived with. Empty without consent. */
export function attributionProperties(): Record<string, string> {
  try { return attribution(); } catch { return {}; }
}

function attribution(): Record<string, string> {
  if (!attributionConsent()) return {};
  const current = campaignFromSearch(globalThis.location?.search ?? "");
  let first: CampaignAttribution = {};
  try {
    const stored = localStorage.getItem(FIRST_TOUCH_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      for (const key of CAMPAIGN_KEYS) { const value = typeof parsed[key] === "string" ? sanitizeCampaignValue(parsed[key] as string) : undefined; if (value) first[key] = value; }
    } else if (Object.keys(current).length) {
      localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify(current));
      first = current;
    }
  } catch { /* Storage unavailable: current-page attribution only. */ }
  return {
    ...acquisitionProperties(),
    ...current,
    ...(first.utm_source ? { first_utm_source: first.utm_source } : {}),
    ...(first.utm_medium ? { first_utm_medium: first.utm_medium } : {}),
    ...(first.utm_campaign ? { first_utm_campaign: first.utm_campaign } : {}),
  };
}


type Acquisition = Record<string, string>;
const acquisitionKeys = ['acquisition_source', 'acquisition_medium', 'acquisition_channel', 'referring_domain', 'landing_page', 'utm_source', 'utm_medium', 'utm_campaign'] as const;
const channels = new Set(['ai', 'organic_search', 'paid_search', 'campaign', 'referral', 'direct']);
const FIRST_ACQUISITION = 'commons:analytics:first-acquisition:v1';
const LATEST_ACQUISITION = 'commons:analytics:latest-acquisition:v1';
const SESSION_ACQUISITION = 'commons:analytics:session-acquisition:v1';
let lastEntry: string | undefined;

function provider(host: string): { source: string; channel: string } | undefined {
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  for (const [source, domains] of Object.entries({ chatgpt: ['chatgpt.com', 'chat.openai.com'], claude: ['claude.ai'], perplexity: ['perplexity.ai'], gemini: ['gemini.google.com'], copilot: ['copilot.microsoft.com'], grok: ['grok.com'], meta_ai: ['meta.ai'] })) {
    if (domains.some(matches)) return { source, channel: 'ai' };
  }
  if (/^(?:www\.)?google\.(?:com|[a-z]{2,3}(?:\.[a-z]{2})?)$/.test(host)) return { source: 'google', channel: 'organic_search' };
  for (const [source, domains] of Object.entries({ bing: ['bing.com'], duckduckgo: ['duckduckgo.com'], yahoo: ['search.yahoo.com'], brave: ['search.brave.com'], ecosia: ['ecosia.org'] })) {
    if (domains.some(matches)) return { source, channel: 'organic_search' };
  }
}

/** Pure classification: UTM source wins; referrer contributes only its hostname. */
export function acquisitionFromEntry(search: string, referrer: string, landing: string): Acquisition {
  const campaign = campaignFromSearch(search);
  let host = '';
  try {
    const url = new URL(referrer);
    if (['https:', 'http:'].includes(url.protocol) && url.hostname !== (typeof location === 'undefined' ? '' : location.hostname)) host = url.hostname.toLowerCase();
  } catch { /* Direct or hidden referrer. */ }
  // Login providers are return paths, not acquisition sources.
  if (['accounts.google.com', 'accounts.youtube.com', 'login.microsoftonline.com'].includes(host)) host = '';
  const tagged = campaign.utm_source;
  const known = tagged ? provider(tagged === 'openai' ? 'chatgpt.com' : tagged.includes('.') ? tagged : `${tagged}.com`) : provider(host);
  const taggedAi = tagged && ['chatgpt', 'claude', 'perplexity', 'gemini', 'copilot', 'grok', 'meta_ai'].includes(tagged);
  const source = tagged ? (known?.source ?? tagged) : known?.source ?? (host || 'direct');
  const medium = campaign.utm_medium ?? (known?.channel === 'ai' || taggedAi ? 'ai' : known?.channel === 'organic_search' ? 'organic' : host ? 'referral' : tagged ? 'campaign' : 'none');
  const channel = taggedAi || known?.channel === 'ai' ? 'ai' : ['cpc', 'ppc', 'paidsearch', 'paid_search'].includes(medium) ? 'paid_search' : known?.channel === 'organic_search' && ['organic', 'none'].includes(medium) ? 'organic_search' : tagged ? 'campaign' : host ? 'referral' : 'direct';
  return { acquisition_source: source, acquisition_medium: medium, acquisition_channel: channel, ...(host ? { referring_domain: host } : {}), landing_page: landing, ...campaign };
}

/** Recheck persisted metadata before it leaves this browser. */
export function safeAcquisitionProperties(input: Record<string, unknown>): Acquisition {
  const result: Acquisition = {};
  for (const prefix of ['', 'first_', 'latest_']) for (const key of acquisitionKeys) {
    const value = input[`${prefix}${key}`];
    if (typeof value !== 'string') continue;
    const valid = key === 'acquisition_channel' ? channels.has(value) : key === 'landing_page' ? safeLandingRoute(value) === value && value.length <= 160 : key === 'referring_domain' || key === 'acquisition_source' ? /^[a-z0-9][a-z0-9_.-]{0,252}$/.test(value) : /^[a-z0-9][a-z0-9_.-]{0,39}$/.test(value);
    if (valid) result[`${prefix}${key}`] = value;
  }
  return result;
}

function acquisitionProperties(): Acquisition {
  const landing = safeLandingRoute(location.pathname);
  if (!landing) return {};
  const entry = acquisitionFromEntry(location.search ?? '', document.referrer ?? '', landing);
  const signature = `${location.search ?? ''}|${document.referrer ?? ''}`;
  const read = (storage: Storage, key: string): Acquisition => { try { return safeAcquisitionProperties(JSON.parse(storage.getItem(key) ?? '{}')); } catch { return {}; } };
  let first = read(localStorage, FIRST_ACQUISITION);
  let latest = read(localStorage, LATEST_ACQUISITION);
  let session = read(sessionStorage, SESSION_ACQUISITION);
  // Referrer is fixed for the document: never let it overwrite later client-side navigation.
  if (lastEntry === undefined || (campaignFromSearch(location.search ?? '').utm_source && lastEntry !== signature)) {
    if (!Object.keys(first).length) { first = entry; try { localStorage.setItem(FIRST_ACQUISITION, JSON.stringify(first)); } catch { /* Attribution must never block navigation. */ } }
    if (!Object.keys(latest).length || entry.acquisition_channel !== 'direct') { latest = entry; try { localStorage.setItem(LATEST_ACQUISITION, JSON.stringify(latest)); } catch { /* Attribution must never block navigation. */ } }
    if (!Object.keys(session).length || entry.acquisition_channel !== 'direct') { session = entry; try { sessionStorage.setItem(SESSION_ACQUISITION, JSON.stringify(session)); } catch { /* Attribution must never block navigation. */ } }
    lastEntry = signature;
  }
  const prefixed = (prefix: string, values: Acquisition) => Object.fromEntries(Object.entries(values).map(([key, value]) => [`${prefix}${key}`, value]));
  const result = { ...session, ...prefixed('first_', first), ...prefixed('latest_', latest) };
  try { document.cookie = `${ACQUISITION_COOKIE}=${encodeURIComponent(JSON.stringify(result))}; path=/; max-age=7776000; samesite=lax; secure`; } catch { /* Browser-only attribution remains available. */ }
  return result;
}

// Shared route normalization keeps private identifiers out of landing-page attribution.
import { analyticsRoute as safeLandingRoute } from './analytics-route';


export const ACQUISITION_COOKIE = 'commons_acquisition_v1';
/** Validated bounded metadata only; a cookie never supplies conversion authority. */
export function acquisitionFromCookie(cookie: string): Record<string, string> {
  try {
    if (cookie.split(/;\s*/).includes(`${OPT_OUT_COOKIE}=1`)) return {};
    const item = cookie.split(/;\s*/).find(part => part.startsWith(`${ACQUISITION_COOKIE}=`));
    if (!item || item.length > 6000) return {};
    return safeAcquisitionProperties(JSON.parse(decodeURIComponent(item.slice(ACQUISITION_COOKIE.length + 1))));
  } catch { return {}; }
}
