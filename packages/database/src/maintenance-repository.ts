import { and, eq, gt, inArray, lte, or, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { DELIVERY_LEASE_MS, DELIVERY_MAX_ATTEMPTS, DELIVERY_RETRY_MS } from "./delivery-lease";
import { eventCreationDrafts, photoDeletions } from "./schema";

export async function expireEventDraftSources(databaseUrl?: string, now = new Date()) {
  const database = createDatabase(databaseUrl);
  try {
    const rows = await database.db.update(eventCreationDrafts).set({ description: null, sourceDeleteAfter: null, updatedAt: now })
      .where(lte(eventCreationDrafts.sourceDeleteAfter, now)).returning({ id: eventCreationDrafts.id });
    return rows.length;
  } finally { await database.close(); }
}

export async function leasePhotoDeletion(databaseUrl?: string, now = new Date()) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      while (true) {
        const [row] = await tx.select().from(photoDeletions).where(and(lte(photoDeletions.availableAt, now), or(
          eq(photoDeletions.status, "pending"),
          and(eq(photoDeletions.status, "processing"), lte(photoDeletions.leaseExpiresAt, now)),
        ))).orderBy(photoDeletions.availableAt).for("update", { skipLocked: true }).limit(1);
        if (!row) return null;
        if (row.attempts >= DELIVERY_MAX_ATTEMPTS) {
          await tx.update(photoDeletions).set({ status: "failed", errorCode: "attempts_exhausted", leaseExpiresAt: null, updatedAt: now })
            .where(eq(photoDeletions.id, row.id));
          continue;
        }
        await tx.update(photoDeletions).set({ status: "processing", attempts: row.attempts + 1,
          leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS), updatedAt: now }).where(eq(photoDeletions.id, row.id));
        return { id: row.id, storagePath: row.storagePath, leaseAttempt: row.attempts + 1 };
      }
    });
  } finally { await database.close(); }
}

export async function completePhotoDeletion(id: string, leaseAttempt: number, deleted: boolean, databaseUrl?: string, now = new Date()) {
  const database = createDatabase(databaseUrl);
  try {
    const rows = await database.db.update(photoDeletions).set({
      status: deleted ? "deleted" : sql`CASE WHEN attempts >= ${DELIVERY_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
      errorCode: deleted ? null : "storage_delete_failed", leaseExpiresAt: null,
      availableAt: new Date(now.getTime() + DELIVERY_RETRY_MS), updatedAt: now,
    }).where(and(eq(photoDeletions.id, id), eq(photoDeletions.status, "processing"),
      eq(photoDeletions.attempts, leaseAttempt), gt(photoDeletions.leaseExpiresAt, now))).returning({ id: photoDeletions.id });
    return rows.length === 1;
  } finally { await database.close(); }
}

export async function getPhotoDeletionCounts(databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.select({ status: photoDeletions.status, count: sql<number>`count(*)::int` })
      .from(photoDeletions).where(inArray(photoDeletions.status, ["pending", "processing", "failed"]))
      .groupBy(photoDeletions.status);
  } finally { await database.close(); }
}

/** Proves the database answers. Used by the health endpoint. */
export async function pingDatabase(databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try { await database.db.execute(sql`select 1`); return true; }
  finally { await database.close(); }
}
