import type { TrackProductAnalyticsEventRequest } from "@commons/contracts";
import { createDatabase } from "./client";
import { and, eq } from "drizzle-orm";
import { isCommonsId } from "./commons-identifier";
import { commons, memberships, people, productAnalyticsEvents } from "./schema";

export type CreateProductAnalyticsEventInput = TrackProductAnalyticsEventRequest & {
  authUserId?: string;
  userAgent?: string;
  country?: string;
  region?: string;
  city?: string;
};

export async function createProductAnalyticsEvent(
  input: CreateProductAnalyticsEventInput,
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    const [created] = await database.db
      .insert(productAnalyticsEvents)
      .values({
        eventName: input.eventName,
        anonymousId: input.anonymousId,
        sessionId: input.sessionId,
        authUserId: input.authUserId ?? null,
        commonsSlug: input.commonsSlug ?? null,
        pagePath: input.pagePath,
        referrer: input.referrer ?? null,
        properties: input.properties,
        userAgent: input.userAgent ?? null,
        country: input.country ?? null,
        region: input.region ?? null,
        city: input.city ?? null,
        occurredAt: new Date(input.occurredAt),
      })
      .returning({ id: productAnalyticsEvents.id });
    return created;
  } finally {
    await database.close();
  }
}

export type ServerOutcomeRole = "organizer" | "participant" | "guest";

/**
 * Persisted-outcome telemetry (docs/plans/2026-10-26-free-beta-analytics-extension.md). Called only after a command
 * committed. `id` is derived from the event and its command or resource identity, so retries, reloads and duplicate
 * deliveries insert at most one row. Resolves the trip and the actor's current role on the server; no request field
 * can claim either. Stores closed-vocabulary properties only.
 */
export async function recordServerOutcomeEvent(input: {
  id: string;
  eventName: TrackProductAnalyticsEventRequest["eventName"];
  authUserId?: string | null;
  tripIdentifier?: string | null;
  properties: Record<string, string | number | boolean | null>;
  occurredAt?: Date;
}, databaseUrl?: string): Promise<{ inserted: boolean; tripId: string | null; role: ServerOutcomeRole }> {
  const database = createDatabase(databaseUrl);
  try {
    let tripId: string | null = null, role: ServerOutcomeRole = "guest";
    if (input.tripIdentifier) {
      const [trip] = await database.db.select({ id: commons.id }).from(commons)
        .where(isCommonsId(input.tripIdentifier) ? eq(commons.id, input.tripIdentifier) : eq(commons.slug, input.tripIdentifier)).limit(1);
      tripId = trip?.id ?? null;
    }
    if (tripId && input.authUserId) {
      const [membership] = await database.db.select({ role: memberships.role }).from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId))
        .where(and(eq(memberships.commonsId, tripId), eq(people.authUserId, input.authUserId), eq(memberships.status, "active"))).limit(1);
      role = membership ? membership.role === "organizer" ? "organizer" : "participant" : "guest";
    }
    const rows = await database.db.insert(productAnalyticsEvents).values({
      id: input.id, eventName: input.eventName,
      // Server outcomes have no browser identity; the ids are derived from the outcome so they never join a browser session.
      anonymousId: input.id, sessionId: input.id,
      authUserId: input.authUserId ?? null, commonsSlug: tripId, pagePath: "/server/outcome",
      properties: { ...input.properties, role, source: "server" }, occurredAt: input.occurredAt ?? new Date(),
    }).onConflictDoNothing({ target: productAnalyticsEvents.id }).returning({ id: productAnalyticsEvents.id });
    return { inserted: rows.length > 0, tripId, role };
  } finally {
    await database.close();
  }
}
