import type { CookieOptions } from "@supabase/ssr";

export const commonsAuthCookieMaxAge = 400 * 24 * 60 * 60;

/** The site's own address (NEXT_PUBLIC_SITE_URL), when set to something other than a vercel.app or local address. */
function configuredSiteHost(siteUrl = process.env.NEXT_PUBLIC_SITE_URL) {
  try {
    const host = siteUrl ? new URL(siteUrl).hostname.toLowerCase() : "";
    return host && !host.endsWith(".vercel.app") && host !== "localhost" && host !== "127.0.0.1" ? host : null;
  } catch { return null; }
}

/**
 * Sign-in cookies are host-only by default, which works on any address. COMMONS_AUTH_COOKIE_DOMAIN (for example `.example.com`) shares the
 * session across subdomains of your own domain, and only applies to requests on that domain.
 */
export function getCommonsAuthCookieOptions(hostname?: string, environment: Record<string, string | undefined> = process.env): CookieOptions {
  const domain = environment.COMMONS_AUTH_COOKIE_DOMAIN?.trim().toLowerCase();
  const base = domain?.replace(/^\./, "");
  const applies = Boolean(base && (!hostname || hostname.toLowerCase().split(":")[0] === base || hostname.toLowerCase().split(":")[0]!.endsWith(`.${base}`)));
  return {
    path: "/",
    sameSite: "lax",
    maxAge: commonsAuthCookieMaxAge,
    ...(applies ? { domain: `.${base}`, secure: true } : {}),
  };
}

/** In production, a request to the project's vercel.app address moves to the site's own domain when one is configured. */
export function canonicalProductionUrl(input: URL, vercelEnvironment = process.env.VERCEL_ENV, siteUrl = process.env.NEXT_PUBLIC_SITE_URL) {
  const host = configuredSiteHost(siteUrl);
  if (vercelEnvironment !== "production" || !host || !input.hostname.endsWith(".vercel.app")) return null;
  const canonical = new URL(input);
  canonical.protocol = "https:";
  canonical.host = host;
  canonical.port = "";
  return canonical;
}
