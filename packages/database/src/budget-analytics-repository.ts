import { and, eq, gte, sql } from 'drizzle-orm';
import { createDatabase } from './client';
import { productAnalyticsEvents } from './schema';

export const BUDGET_SNAPSHOT_EVENT = 'marketing_budget_snapshot';
/** One latest estimate per page visit. Includes all calculator fields, without attached account, IP or user-agent. */
export async function saveBudgetSnapshot(input: {
  id: string; destination: string; revision: number;
  properties: Record<string, string | number | boolean | null>;
}, databaseUrl: string) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      // Global hourly bound also works across serverless instances; serialize count + insert.
      await tx.execute(sql`select pg_advisory_xact_lock(667812301)`);
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(productAnalyticsEvents)
        .where(and(eq(productAnalyticsEvents.eventName, BUDGET_SNAPSHOT_EVENT), gte(productAnalyticsEvents.createdAt, new Date(Date.now() - 3_600_000))));
      if (count >= 2000) return { saved: false, limited: true };
      const now = new Date();
      const rows = await tx.insert(productAnalyticsEvents).values({
        id: input.id, eventName: BUDGET_SNAPSHOT_EVENT, anonymousId: input.id, sessionId: input.id,
        pagePath: `/destinations/${input.destination}/`, properties: input.properties, occurredAt: now,
      }).onConflictDoUpdate({ target: productAnalyticsEvents.id,
        set: { properties: input.properties, occurredAt: now },
        setWhere: and(eq(productAnalyticsEvents.eventName, BUDGET_SNAPSHOT_EVENT),
          eq(productAnalyticsEvents.pagePath, `/destinations/${input.destination}/`),
          sql`(${productAnalyticsEvents.properties}->>'revision')::int < ${input.revision}`),
      }).returning({ id: productAnalyticsEvents.id });
      return { saved: rows.length > 0, limited: false };
    });
  } finally { await database.close(); }
}
