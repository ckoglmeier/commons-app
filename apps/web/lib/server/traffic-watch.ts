import "server-only";
import { queueTrafficAlert, readHourlyTraffic } from "@commons/database";
import { after } from "next/server";
import { betaReworkEnabled } from "@/lib/beta/flags";
import { breachedSignals, TRAFFIC_LABELS, trafficAlertLevels, type TrafficSignal } from "@/lib/beta/traffic";
import { processOperatorNotification } from "./operator-notifications";
import { commonsDatabaseUrl, readCommonsRuntimeEnvironment } from "./runtime-environment";

/**
 * Compares the current hour with the alert levels and emails an operator once per signal per hour. It runs from real
 * traffic (below), so a spike triggers it without a frequent cron, and from /api/internal/traffic-watch for a scheduler.
 * A complete outage produces no traffic, so that case needs an outside uptime check on /api/health.
 */
export async function runTrafficWatch(now = new Date()) {
  const url = commonsDatabaseUrl();
  if (!url || !betaReworkEnabled()) return { checked: false, alerted: [] as string[] };
  const hour = `${now.toISOString().slice(0, 13)}:00Z`;
  const [current] = (await readHourlyTraffic(1, url)).filter(row => row.hour === hour);
  const counts = current ?? { hour, failures: 0, responses: 0, polls: 0, trips: 0 };
  const levels = trafficAlertLevels(readCommonsRuntimeEnvironment() as unknown as Record<string, unknown>);
  const alerted: TrafficSignal[] = [];
  for (const signal of breachedSignals(counts, levels)) {
    const key = await queueTrafficAlert({ hour, signal, label: TRAFFIC_LABELS[signal], count: counts[signal], level: levels[signal] }, url);
    if (key) { alerted.push(signal); await processOperatorNotification(key).catch(() => undefined); }
  }
  return { checked: true, alerted };
}

const WATCH_INTERVAL_MS = 5 * 60_000;
let lastWatch = 0;

/** At most one check per instance per five minutes, after the response, and it can never fail the request. */
export function scheduleTrafficWatch() {
  if (!betaReworkEnabled() || Date.now() - lastWatch < WATCH_INTERVAL_MS) return;
  lastWatch = Date.now();
  try { after(async () => { await runTrafficWatch().catch(() => console.error("commons.traffic_watch_failed")); }); }
  catch { /* Outside a request: the scheduled route still covers it. */ }
}
