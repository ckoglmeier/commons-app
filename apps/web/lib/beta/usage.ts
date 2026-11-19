import { betaFeatureEnabled, type Env } from "./flags";

export type UsageKind = "sms_segment" | "extraction_call" | "model_call" | "map_lookup" | "payment_fee";

/**
 * Engineering safety bounds per trip over a rolling 30 days. They exist to stop a runaway loop or abuse before a paid pilot, not to
 * predict spend, and they are NOT an approved budget. Each can be changed per trip by an operator or overridden for the whole
 * deployment with COMMONS_BETA_LIMIT_<KIND>. A null bound means measure only.
 */
export const DEFAULT_TRIP_USAGE_BOUNDS: Record<UsageKind, number | null> = {
  sms_segment: 400,
  extraction_call: 60,
  model_call: 200,
  map_lookup: 300,
  payment_fee: null,
};

/** The kinds with a real gate today. A limit on anything else would stop nothing, so the operator page doesn't offer one. */
export const ENFORCED_USAGE_KINDS: UsageKind[] = ["sms_segment", "extraction_call", "payment_fee"];

export const USAGE_LABELS: Record<UsageKind, string> = {
  sms_segment: "Text message segments",
  extraction_call: "Booking extractions",
  model_call: "Model calls",
  map_lookup: "Map lookups",
  payment_fee: "Payment fees",
};

export function usageDefaults(env: Env = process.env): Record<UsageKind, number | null> {
  const result = { ...DEFAULT_TRIP_USAGE_BOUNDS };
  for (const kind of Object.keys(result) as UsageKind[]) {
    const raw = env[`COMMONS_BETA_LIMIT_${kind.toUpperCase()}`];
    if (typeof raw !== "string" || raw === "") continue;
    if (raw.toLowerCase() === "none") { result[kind] = null; continue; }
    const value = Number(raw);
    if (Number.isInteger(value) && value >= 0 && value <= 100_000) result[kind] = value;
  }
  return result;
}

/** A deployment-wide stop for one kind: COMMONS_BETA_USAGE_OFF_<KIND>=true. With the master flag off, usage is neither limited nor recorded. */
export function usageKindStopped(kind: UsageKind, env: Env = process.env) {
  return env[`COMMONS_BETA_USAGE_OFF_${kind.toUpperCase()}`] === "true";
}

export type GateDecision = { proceed: true; recorded: boolean } | { proceed: false; reason: "kill_switch" | "trip_disabled" | "limit_reached" };

/**
 * The one gate callers use before spending: `await gateTripUsage(admit, tripId, "extraction_call")`. The repository admit function is
 * injected so the decision is testable without a database. With the master flag off this always proceeds and records nothing, so existing
 * behavior is unchanged.
 */
export async function gateTripUsage(
  admit: (tripId: string, input: { kind: UsageKind; units: number; costMicros?: number | null; dedupeKey?: string | null; defaultLimit: number | null }) => Promise<{ allowed: true } | { allowed: false; reason: "trip_disabled" | "limit_reached" }>,
  tripId: string,
  kind: UsageKind,
  options: { units?: number; costMicros?: number | null; dedupeKey?: string | null; env?: Env } = {},
): Promise<GateDecision> {
  const env = options.env ?? process.env;
  if (!betaFeatureEnabled("usage", env)) return { proceed: true, recorded: false };
  if (usageKindStopped(kind, env)) return { proceed: false, reason: "kill_switch" };
  const result = await admit(tripId, { kind, units: options.units ?? 1, costMicros: options.costMicros, dedupeKey: options.dedupeKey, defaultLimit: usageDefaults(env)[kind] });
  return result.allowed ? { proceed: true, recorded: true } : { proceed: false, reason: result.reason };
}
