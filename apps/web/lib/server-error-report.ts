/*
 * Sanitized uncaught-server-error report for instrumentation.ts (docs/plans/2026-10-26-free-beta-analytics-extension.md).
 * Carries the route file pattern, route type, method, a closed error category, the React digest and the release.
 * Never the message, stack, request path or query, headers, trip text, tokens or model content.
 */

export type ServerErrorContext = { routePath?: string; routeType?: string };

const ROUTE_TYPES = new Set(["render", "route", "action", "proxy"]);
const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD", "OPTIONS"]);

export function sanitizedServerError(error: unknown, request: { method?: string }, context: ServerErrorContext, environment: { [name: string]: unknown } = process.env) {
  const name = error instanceof Error ? error.name : typeof error;
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest: unknown }).digest) : null;
  // App route file patterns only (e.g. /app/api/v1/commons/[slug]/expenses/route); anything else is withheld.
  const routePath = typeof context.routePath === "string" && /^\/[A-Za-z0-9_\-./[\]()@]{0,200}$/.test(context.routePath) ? context.routePath : "unknown";
  const sha = typeof environment.VERCEL_GIT_COMMIT_SHA === "string" && /^[0-9a-f]{7,40}$/.test(environment.VERCEL_GIT_COMMIT_SHA) ? environment.VERCEL_GIT_COMMIT_SHA.slice(0, 12) : "local";
  return {
    routePath,
    routeType: ROUTE_TYPES.has(String(context.routeType)) ? String(context.routeType) : "unknown",
    method: METHODS.has(String(request.method).toUpperCase()) ? String(request.method).toUpperCase() : "OTHER",
    errorCategory: /^(?:[A-Z][A-Za-z]{0,60})?Error$/.test(name) ? name : "UnknownError",
    digest: digest && /^[A-Za-z0-9_-]{1,64}$/.test(digest) ? digest : null,
    release: sha,
  };
}

export async function reportServerError(error: unknown, request: { method?: string; headers?: { [key: string]: string | string[] | undefined } }, context: ServerErrorContext, deps: { send?: typeof fetch; environment?: { [name: string]: unknown } } = {}) {
  const environment = deps.environment ?? process.env;
  const report = sanitizedServerError(error, request, context, environment);
  console.error("commons.server_error", report);
  const key = environment.NEXT_PUBLIC_POSTHOG_KEY;
  if (environment.VERCEL_ENV !== "production" || typeof key !== "string" || !key) return report;
  const cookie = request.headers?.cookie;
  if (request.headers?.dnt === "1" || request.headers?.["sec-gpc"] === "1" || (typeof cookie === "string" && cookie.split(/;\s*/).includes("commons_analytics_opt_out=1"))) return report;
  try {
    const result = await (deps.send ?? fetch)("https://us.i.posthog.com/i/v0/e/", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: key, event: "server_error", distinct_id: "commons-server", properties: { ...report, $process_person_profile: false, $geoip_disable: true } }),
      signal: AbortSignal.timeout(3000) });
    if (!result.ok) console.warn("commons.telemetry.delivery_failed", { status: result.status });
  } catch { console.warn("commons.telemetry.delivery_failed"); }
  return report;
}
