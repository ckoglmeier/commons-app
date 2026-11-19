import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons } from "./schema";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCommonsId(identifier: string) {
  return uuidPattern.test(identifier);
}

/** Stable trip id for feature policy only. Membership and organizer checks still run separately. */
export async function resolveCommonsTripId(identifier: string, databaseUrl?: string): Promise<string | null> {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
    return row?.id ?? null;
  } finally { await database.close(); }
}
