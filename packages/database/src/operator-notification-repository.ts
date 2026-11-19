import { and, eq, lt, lte, or, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { operatorNotificationDeliveries as deliveries } from "./schema";

export async function leaseOperatorNotification(databaseUrl?: string, dedupeKey?: string) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const now = new Date();
      const [row] = await tx.select().from(deliveries).where(and(
        dedupeKey ? eq(deliveries.dedupeKey, dedupeKey) : undefined,
        or(and(eq(deliveries.status, "queued"), lte(deliveries.availableAt, now)),
          and(eq(deliveries.status, "processing"), lt(deliveries.leaseExpiresAt, now))),
      )).orderBy(deliveries.createdAt).for("update", { skipLocked: true }).limit(1);
      if (!row) return null;
      // Do not replay an ambiguous provider result beyond its 24-hour
      // idempotency window. Keep the record for operator review instead.
      const ambiguous = row.status === "processing" || row.errorCode === "provider_unavailable";
      if (row.attempts >= 5 || (ambiguous && row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= 23 * 60 * 60 * 1000)) {
        await tx.update(deliveries).set({ status: "failed", errorCode: "operator_review_required", leaseExpiresAt: null }).where(eq(deliveries.id, row.id));
        return { skipped: true as const, id: row.id };
      }
      const attempt = row.attempts + 1;
      await tx.update(deliveries).set({ status: "processing", attempts: attempt,
        firstAttemptAt: row.firstAttemptAt ?? now, leaseExpiresAt: new Date(now.getTime() + 60_000) }).where(eq(deliveries.id, row.id));
      return { skipped: false as const, id: row.id, attempt, payload: row.payload };
    });
  } finally { await database.close(); }
}

export async function completeOperatorNotification(id: string, attempt: number,
  result: { sent: boolean; providerMessageId?: string; errorCode?: string }, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const now = new Date();
    const updated = await database.db.update(deliveries).set({
      status: result.sent ? "sent" : attempt >= 5 ? "failed" : "queued",
      sentAt: result.sent ? now : null,
      providerMessageId: result.providerMessageId ?? null,
      errorCode: result.errorCode ?? null,
      leaseExpiresAt: null,
      availableAt: new Date(now.getTime() + Math.min(60, 2 ** attempt) * 60_000),
    }).where(and(eq(deliveries.id, id), eq(deliveries.status, "processing"), eq(deliveries.attempts, attempt),
      sql`${deliveries.leaseExpiresAt} > now()`)).returning({ id: deliveries.id });
    return updated.length === 1;
  } finally { await database.close(); }
}
