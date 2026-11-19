import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "./client";
import { commons, conversationDigestDeliveries, conversationDigestItems, eventDigestPreferences, memberships, people } from "./schema";

export class EventDigestAccessError extends Error {}

// Apply at ingestion AND queue selection; the watermark prevents replay after unmute.
export function eventDigestAllowed(event: SQL, person: SQL, at?: SQL) {
  return sql`not exists (select 1 from ${eventDigestPreferences}
    where ${eventDigestPreferences.commonsId} = ${event}
      and ${eventDigestPreferences.personId} = ${person}
      and (${eventDigestPreferences.enabled} = false ${at ? sql`or ${eventDigestPreferences.resumeAfter} >= ${at}` : sql``}))`;
}

export async function listEventDigestPreferences(personId: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.select({ eventId: commons.id, name: commons.name,
      enabled: sql<boolean>`coalesce(${eventDigestPreferences.enabled}, true)` })
      .from(memberships).innerJoin(commons, eq(commons.id, memberships.commonsId))
      .innerJoin(people, eq(people.id, memberships.personId))
      .leftJoin(eventDigestPreferences, and(eq(eventDigestPreferences.commonsId, commons.id), eq(eventDigestPreferences.personId, personId)))
      .where(and(eq(memberships.personId, personId), eq(memberships.status, "active"), eq(memberships.accessMode, "account")))
      .orderBy(commons.name);
  } finally { await database.close(); }
}

export async function updateEventDigestPreference(personId: string, input: unknown, databaseUrl?: string) {
  const { eventId, enabled } = z.object({ eventId: z.string().uuid(), enabled: z.boolean() }).strict().parse(input);
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [member] = await tx.select({ id: memberships.id }).from(memberships)
        .where(and(eq(memberships.personId, personId), eq(memberships.commonsId, eventId),
          eq(memberships.status, "active"), eq(memberships.accessMode, "account"))).for("update").limit(1);
      if (!member) throw new EventDigestAccessError("This event is not available to you.");
      const [previous] = await tx.select().from(eventDigestPreferences)
        .where(and(eq(eventDigestPreferences.personId, personId), eq(eventDigestPreferences.commonsId, eventId)));
      const now = new Date();
      await tx.insert(eventDigestPreferences).values({ personId, commonsId: eventId, enabled,
        resumeAfter: enabled ? null : now, updatedAt: now }).onConflictDoUpdate({
        target: [eventDigestPreferences.personId, eventDigestPreferences.commonsId],
        set: { enabled, updatedAt: now, resumeAfter: previous?.enabled === enabled ? previous.resumeAfter : now },
      });
      if (!enabled) {
        await tx.delete(conversationDigestItems).where(and(eq(conversationDigestItems.recipientPersonId, personId),
          eq(conversationDigestItems.commonsId, eventId), isNull(conversationDigestItems.deliveryId)));
        const [event] = await tx.select({ slug: commons.slug }).from(commons).where(eq(commons.id, eventId));
        const pending = await tx.select().from(conversationDigestDeliveries).where(and(
          eq(conversationDigestDeliveries.recipientPersonId, personId),
          inArray(conversationDigestDeliveries.status, ["queued", "leased", "failed"]))).for("update");
        for (const delivery of pending) {
          const payload = { ...delivery.payload, events: delivery.payload.events.filter(item => item.slug !== event.slug) };
          await tx.update(conversationDigestDeliveries).set({ payload, updatedAt: now,
            ...(!payload.events.length ? { status: "cancelled" as const, leaseExpiresAt: null } : {}) })
            .where(eq(conversationDigestDeliveries.id, delivery.id));
        }
      }
      return { eventId, enabled };
    });
  } finally { await database.close(); }
}
