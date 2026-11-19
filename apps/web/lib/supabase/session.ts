import type { CookieOptions } from "@supabase/ssr";

export const commonsAuthCookieMaxAge = 400 * 24 * 60 * 60;
export const commonsAuthCookieDomain = ".commons.travel";
export const commonsCanonicalHost = "www.commons.travel";

function isCommonsHost(hostname: string) {
  const normalized = hostname.toLowerCase().split(":")[0];
  return normalized === "commons.travel" || normalized.endsWith(".commons.travel");
}

export function getCommonsAuthCookieOptions(hostname?: string): CookieOptions {
  const sharedProductionCookie = hostname
    ? isCommonsHost(hostname)
    : process.env.VERCEL_ENV === "production";
  return {
    path: "/",
    sameSite: "lax",
    maxAge: commonsAuthCookieMaxAge,
    ...(sharedProductionCookie
      ? { domain: commonsAuthCookieDomain, secure: true }
      : {}),
  };
}

export function canonicalProductionUrl(input: URL, vercelEnvironment = process.env.VERCEL_ENV) {
  if (vercelEnvironment !== "production" || !input.hostname.endsWith(".vercel.app")) {
    return null;
  }
  const canonical = new URL(input);
  canonical.protocol = "https:";
  canonical.host = commonsCanonicalHost;
  return canonical;
}
