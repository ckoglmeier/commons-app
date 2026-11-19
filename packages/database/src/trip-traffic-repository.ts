import { and, count, eq, gte, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, operatorNotificationDeliveries, pollResponses, polls, productAnalyticsEvents } from "./schema";

export type TrafficHour = { hour: string; failures: number; responses: number; polls: number; trips: number };

/** Counts only, for operators. No trip names, people or answers. */
export async function readHourlyTraffic(hours: number, databaseUrl?: string): Promise<TrafficHour[]> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const database = createDatabase(databaseUrl);
  try {
    const bucket = (column: unknown) => sql<string>`to_char(date_trunc('hour', ${column} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24":00Z"')`;
    const [failures, responses, created, trips] = await Promise.all([
      database.db.select({ hour: bucket(productAnalyticsEvents.createdAt), total: count() }).from(productAnalyticsEvents).where(and(eq(productAnalyticsEvents.eventName, "operation_failed"), gte(productAnalyticsEvents.createdAt, since))).groupBy(sql`1`),
      database.db.select({ hour: bucket(pollResponses.submittedAt), total: count() }).from(pollResponses).where(gte(pollResponses.submittedAt, since)).groupBy(sql`1`),
      database.db.select({ hour: bucket(polls.createdAt), total: count() }).from(polls).where(gte(polls.createdAt, since)).groupBy(sql`1`),
      database.db.select({ hour: bucket(commons.createdAt), total: count() }).from(commons).where(gte(commons.createdAt, since)).groupBy(sql`1`),
    ]);
    const hoursSeen = new Map<string, TrafficHour>();
    const add = (rows: { hour: string; total: number }[], key: "failures" | "responses" | "polls" | "trips") => {
      for (const row of rows) {
        const entry = hoursSeen.get(row.hour) ?? { hour: row.hour, failures: 0, responses: 0, polls: 0, trips: 0 };
        entry[key] = Number(row.total); hoursSeen.set(row.hour, entry);
      }
    };
    add(failures, "failures"); add(responses, "responses"); add(created, "polls"); add(trips, "trips");
    return [...hoursSeen.values()].sort((a, b) => b.hour.localeCompare(a.hour));
  } finally { await database.close(); }
}

/** One alert per signal per hour, however many instances notice it. Returns the keys actually queued. */
export async function queueTrafficAlert(input: { hour: string; signal: string; label: string; count: number; level: number }, databaseUrl?: string) {
  const dedupeKey = `traffic:${input.hour}:${input.signal}`;
  const database = createDatabase(databaseUrl);
  try {
    const rows = await database.db.insert(operatorNotificationDeliveries).values({ dedupeKey, payload: { kind: "traffic_alert", hour: input.hour, signal: input.signal, label: input.label, count: input.count, level: input.level } })
      .onConflictDoNothing().returning({ dedupeKey: operatorNotificationDeliveries.dedupeKey });
    return rows[0]?.dedupeKey ?? null;
  } finally { await database.close(); }
}

/** Proves the database answers. Used by the health endpoint. */
export async function pingDatabase(databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try { await database.db.execute(sql`select 1`); return true; }
  finally { await database.close(); }
}
