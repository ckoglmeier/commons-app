/** Hourly traffic signals and the levels that alert an operator. Pure, so the thresholds can be tested without a database. */
export const TRAFFIC_SIGNALS = ["failures", "responses", "polls", "trips"] as const;
export type TrafficSignal = (typeof TRAFFIC_SIGNALS)[number];
export type TrafficCounts = Record<TrafficSignal, number>;

export const TRAFFIC_LABELS: Record<TrafficSignal, string> = {
  failures: "server failures", responses: "poll answers", polls: "new polls", trips: "new trips",
};

/** Starting points, not measured limits. Tune them from real use with `COMMONS_TRAFFIC_ALERT_<SIGNAL>`. */
export const DEFAULT_TRAFFIC_ALERTS: TrafficCounts = { failures: 25, responses: 500, polls: 100, trips: 50 };

export function trafficAlertLevels(env: Record<string, unknown>): TrafficCounts {
  const levels = { ...DEFAULT_TRAFFIC_ALERTS };
  for (const signal of TRAFFIC_SIGNALS) {
    const value = Number(env[`COMMONS_TRAFFIC_ALERT_${signal.toUpperCase()}`]);
    if (Number.isSafeInteger(value) && value > 0) levels[signal] = value;
  }
  return levels;
}

export function breachedSignals(counts: TrafficCounts, levels: TrafficCounts) {
  return TRAFFIC_SIGNALS.filter(signal => counts[signal] >= levels[signal]);
}
