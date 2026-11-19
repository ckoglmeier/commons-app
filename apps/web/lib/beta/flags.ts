/**
 * The beta rework's emergency off (docs/BETA-REWORK.md). It needs no variable to run; `COMMONS_BETA_REWORK_ENABLED=false` turns
 * these features off everywhere. Which trips show the new experience is a per-trip setting, not this.
 *
 * Each sub-feature also has an emergency kill switch, `COMMONS_BETA_KILL_<FEATURE>=true`, so an operator can turn one part off
 * without turning the rework off. A kill switch can only reduce what the master flag turns on.
 */
export type Env = Record<string, unknown>;

export const BETA_FEATURES = [
  "payment_reports",
  "closure",
  "recap",
  "successor",
  "inquiry",
  "attribution",
  "feedback_guard",
  "usage",
  "operator_tools",
  "map",
] as const;
export type BetaFeature = (typeof BETA_FEATURES)[number];

/** Pauses new link polls and answers on them while the rest of the app keeps working. Vercel env changes need a redeploy; the firewall is faster. */
export function publicPollsPaused(env: Env = process.env) {
  return betaReworkEnabled(env) && env.COMMONS_BETA_KILL_PUBLIC_POLLS === "true";
}

/** On unless set to "false": no variable is needed. Each trip decides its own experience, and this remains the emergency off. */
export function betaReworkEnabled(env: Env = process.env) {
  return env.COMMONS_BETA_REWORK_ENABLED !== "false";
}

export function betaFeatureEnabled(feature: BetaFeature, env: Env = process.env) {
  return betaReworkEnabled(env) && env[`COMMONS_BETA_KILL_${feature.toUpperCase()}`] !== "true";
}

/** The trip map is available when the existing flag is on, or when this trip is on the new experience (unless the map kill switch is set). */
export function tripMapAvailable(env: Env = process.env, newExperience = false) {
  return env.COMMONS_TRIP_MAP_ENABLED === "true" || (newExperience && betaFeatureEnabled("map", env));
}
