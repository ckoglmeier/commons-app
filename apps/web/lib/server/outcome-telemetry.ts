import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { acquisitionFromCookie } from "@/lib/analytics-attribution";
import { after } from "next/server";
import type { ProductAnalyticsEventName } from "@commons/contracts";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";

/*
 * Optional server-side outcome and sanitized failure telemetry. It goes to PostHog only, and only when NEXT_PUBLIC_POSTHOG_KEY is set; nothing
 * is stored in the Commons database. Rules:
 *   - record only after the command committed (call it after the service returned), never from a click;
 *   - the event id derives from the event and its command or resource identity, so retries and duplicate deliveries share one PostHog `uuid`;
 *   - closed-vocabulary properties only: never trip text, names, amounts, receipts, tokens, raw URLs, prompts or replies;
 *   - telemetry runs after the response and its failure never affects the user's action.
 */

export type OutcomeEvent = Extract<ProductAnalyticsEventName,
  "account_setup_completed" | "trip_created" | "invitation_accepted" | "group_joined" | "poll_published" | "poll_response_saved"
  | "poll_decision_recorded" | "plan_item_saved" | "expense_added" | "payment_recorded">;
export type FailureOperation = "trip_create" | "invitation_accept" | "group_join" | "poll_publish" | "poll_response"
  | "poll_decision" | "plan_item_save" | "expense_save" | "payment_record" | "poll_assist";
export type ErrorCategory = "validation" | "conflict" | "access" | "authentication" | "not_found" | "rate_limited" | "provider" | "unexpected";

type Scalar = string | number | boolean;
const SAFE_KEY = /^(kind|target|access|questionCount|optionCount|participantCount|edited|sendInvitations|hasDates|hasLocation|ballotMode|balanceMode)$/;
const SAFE_VALUE = /^[a-z0-9_]{1,40}$/;

/** Keeps only allowlisted keys with booleans, bounded integers or short lower-case codes. */
export function sanitizeOutcomeProperties(properties: Record<string, unknown> = {}) {
  const safe: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!SAFE_KEY.test(key)) continue;
    if (typeof value === "boolean") safe[key] = value;
    else if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000) safe[key] = value;
    else if (typeof value === "string" && SAFE_VALUE.test(value)) safe[key] = value;
  }
  return safe;
}

/** A stable UUID (version 5 layout) for one outcome, so every delivery of it maps to the same row. */
export function outcomeEventId(event: string, key: string) {
  const hex = createHash("sha256").update(`commons-outcome:v1:${event}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Opaque trip grouping identifier for PostHog funnels; the trip id itself never leaves Commons. */
export function tripGroupKey(tripId: string) {
  return createHash("sha256").update(`commons-trip-group:v1:${tripId}`).digest("hex").slice(0, 20);
}

export function errorCategory(error: unknown): ErrorCategory {
  const name = error instanceof Error ? error.name : "";
  const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "";
  if (name === "ZodError" || name === "SyntaxError") return "validation";
  if (name === "CommandConflictError" || /conflict|stale|closed/.test(code)) return "conflict";
  if (name === "CommonsAuthenticationRequiredError") return "authentication";
  if (/Access|Membership|Forbidden/.test(name) || /not_authorized|access/.test(code)) return "access";
  if (/not_found/.test(code)) return "not_found";
  if (/Limit/.test(name) || code === "rate_limited") return "rate_limited";
  if (/Provider|Inference/.test(name)) return "provider";
  return "unexpected";
}

export function releaseLabel(environment: { [name: string]: unknown } = process.env) {
  const sha = typeof environment.VERCEL_GIT_COMMIT_SHA === "string" ? environment.VERCEL_GIT_COMMIT_SHA : "";
  return /^[0-9a-f]{7,40}$/.test(sha) ? sha.slice(0, 12) : "local";
}

type Deps = {
  identity?: () => Promise<{ authUserId: string; email?: string } | null>;
  send?: typeof fetch;
  schedule?: (task: () => Promise<void>) => void;
  environment?: { [name: string]: unknown };
};

/** Run after the response when inside a request; otherwise in the background. Never throws. */
function defaultSchedule(task: () => Promise<void>) {
  const guarded = () => task().catch(() => { console.warn("commons.telemetry.outcome_failed"); });
  try { after(guarded); } catch { void guarded(); }
}

function posthogEligible(request: Request | undefined, environment: { [name: string]: unknown }) {
  if (typeof environment.NEXT_PUBLIC_POSTHOG_KEY !== "string" || !environment.NEXT_PUBLIC_POSTHOG_KEY) return false;
  if (!request) return false;
  // DNT, GPC and the Commons opt-out (mirrored to a cookie by analytics-attribution.ts) keep outcomes out of PostHog.
  const optedOut = (request.headers.get("cookie") ?? "").split(/;\s*/).includes("commons_analytics_opt_out=1");
  return request.headers.get("dnt") !== "1" && request.headers.get("sec-gpc") !== "1" && !optedOut;
}

async function deliver(input: { event: string; id: string; authUserId: string | null; properties: Record<string, Scalar>; trip: string | null; request?: Request }, deps: Required<Pick<Deps, "send">> & { environment: { [name: string]: unknown } }) {
  if (!posthogEligible(input.request, deps.environment)) return;
  const host = typeof deps.environment.NEXT_PUBLIC_POSTHOG_HOST === "string" && deps.environment.NEXT_PUBLIC_POSTHOG_HOST ? deps.environment.NEXT_PUBLIC_POSTHOG_HOST : "https://us.i.posthog.com";
  const properties: Record<string, unknown> = { ...input.properties, ...(input.trip ? { trip_group: tripGroupKey(input.trip) } : {}), $process_person_profile: Boolean(input.authUserId), $geoip_disable: true };
  const body = JSON.stringify({ api_key: deps.environment.NEXT_PUBLIC_POSTHOG_KEY, event: input.event, uuid: input.id,
    distinct_id: input.authUserId ?? `server:${input.id}`, properties });
  const result = await deps.send(`${new URL(host).origin}/i/v0/e/`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(4000) });
  if (!result.ok) console.warn("commons.telemetry.delivery_failed", { status: result.status });
}

/** Record a committed outcome. `key` is the command id or saved resource id that makes retries idempotent; `perActor` scopes it to the signed-in account (shared links). */
export function recordOutcome(input: { event: OutcomeEvent; key: string; perActor?: boolean; trip?: string | null; properties?: Record<string, unknown>; request?: Request; authUserId?: string | null }, deps: Deps = {}) {
  const environment = deps.environment ?? process.env, schedule = deps.schedule ?? defaultSchedule;
  if (typeof environment.NEXT_PUBLIC_POSTHOG_KEY !== "string" || !environment.NEXT_PUBLIC_POSTHOG_KEY) return;
  schedule(async () => {
    const identity = input.authUserId !== undefined ? (input.authUserId ? { authUserId: input.authUserId } : null) : await (deps.identity ?? getCommonsAuthIdentity)().catch(() => null);
    // Scoped to the trip so equal client command ids on different trips never collapse into one event.
    const scoped = `${input.trip ?? ""}:${input.key}`;
    const id = outcomeEventId(input.event, input.perActor ? `${scoped}:${identity?.authUserId ?? "anonymous"}` : scoped);
    const acquisition = input.request && input.request.headers.get("dnt") !== "1" && input.request.headers.get("sec-gpc") !== "1" ? acquisitionFromCookie(input.request.headers.get("cookie") ?? "") : {};
    const properties = { ...acquisition, ...sanitizeOutcomeProperties(input.properties), outcome: "succeeded", release: releaseLabel(environment) };
    await deliver({ event: input.event, id, authUserId: identity?.authUserId ?? null, properties: { ...properties, source: "server" }, trip: input.trip ?? null, request: input.request }, { send: deps.send ?? fetch, environment });
  });
}

/**
 * Record a sanitized failure of a critical operation: a structured log line for the runtime logs plus, when eligible, a PostHog event.
 * Carries the operation, category and release only.
 */
export function recordOperationFailure(input: { operation: FailureOperation; error: unknown; trip?: string | null; request?: Request }, deps: Deps = {}) {
  const environment = deps.environment ?? process.env, schedule = deps.schedule ?? defaultSchedule;
  const category = errorCategory(input.error), release = releaseLabel(environment);
  console.error("commons.operation_failed", { operation: input.operation, category, release });
  if (typeof environment.NEXT_PUBLIC_POSTHOG_KEY !== "string" || !environment.NEXT_PUBLIC_POSTHOG_KEY) return;
  schedule(async () => {
    const identity = await (deps.identity ?? getCommonsAuthIdentity)().catch(() => null);
    const id = randomUUID();
    const properties = { operation: input.operation, errorCategory: category, outcome: "failed", release };
    await deliver({ event: "operation_failed", id, authUserId: identity?.authUserId ?? null, properties: { ...properties, source: "server" }, trip: input.trip ?? null, request: input.request }, { send: deps.send ?? fetch, environment });
  });
}
