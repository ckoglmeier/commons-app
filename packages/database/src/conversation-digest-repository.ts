import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { DELIVERY_LEASE_MS, DELIVERY_MAX_ATTEMPTS, DELIVERY_RETRY_MS } from "./delivery-lease";
import { createDatabase } from "./client";
import { compactDigestEvent } from "./conversation-digest-summary";
import { eventDigestAllowed } from "./event-digest-preferences";
import {
  commons,
  auditEvents,
  conversationDigestDeliveries,
  conversationDigestItems,
  memberships,
  people,
  messages,
  travelerProfiles,
  eventDigestPreferences,
  travelPlans,
  type ConversationDigestPayload,
} from "./schema";

export const CONVERSATION_DIGEST_MAX_ATTEMPTS = 5;
// Existing message and expense items predate the shared changelog. This watermark
// prevents a one-time email containing the full historical audit trail while
// allowing every post-launch change to be recovered after an arbitrarily long
// worker outage.
export const CONVERSATION_DIGEST_SHARED_ACTIVITY_STARTED_AT = new Date("2026-09-03T21:42:32.000Z");

const SHARED_ACTIVITY_ACTIONS = [
  "budget.target_updated",
  "commons.archived",
  "commons.cover_updated",
  "commons.details_updated",
  "commons.restored",
  "commons.title_updated",
  "expense.deleted",
  "expense.updated",
  "expenses.closed",
  "expenses.completed",
  "expenses.reopened",
  "identity.claimed",
  "invitation.created",
  "itinerary.added",
  "itinerary.deleted",
  "itinerary.imported",
  "itinerary.updated",
  "membership.claimed",
  "membership.organizer_granted",
  "membership.organizer_removed",
  "moment.added",
  "moment.deleted",
  "moment.updated",
  "participant.managed_added",
  "participation.updated",
  "poll.closed",
  "poll.created",
  "poll.reopened",
  "proposal.approved",
  "proposal.revised",
  "reimbursement.added",
  "reimbursement.deleted",
  "reimbursement.updated",
  "stay.added",
  "stay.deleted",
  "stay.updated",
  "travel_plan.sharing_updated",
] as const;

type DigestTransaction = Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0];

async function materializeSharedActivityItems(transaction: DigestTransaction, now: Date) {
  const activityRows = await transaction.select({
    id: auditEvents.id,
    commonsId: auditEvents.commonsId,
    action: auditEvents.action,
    resourceType: auditEvents.resourceType,
    resourceId: auditEvents.resourceId,
    summary: auditEvents.summary,
    occurredAt: auditEvents.occurredAt,
  }).from(auditEvents).where(and(
    gte(auditEvents.occurredAt, CONVERSATION_DIGEST_SHARED_ACTIVITY_STARTED_AT),
    lte(auditEvents.occurredAt, now),
    inArray(auditEvents.action, [...SHARED_ACTIVITY_ACTIONS]),
  ));
  if (!activityRows.length) return 0;

  const sharedTravelIds = activityRows
    .filter((row) => row.action === "travel_plan.sharing_updated")
    .map((row) => row.resourceId);
  const visibleTravelIds = new Set(sharedTravelIds.length
    ? (await transaction.select({ id: travelPlans.id }).from(travelPlans).where(and(
        inArray(travelPlans.id, sharedTravelIds),
        or(inArray(travelPlans.kind, ["arrival", "departure"]), inArray(travelPlans.visibility, ["basic", "all"])),
      ))).map((row) => row.id)
    : []);

  const eventIds = [...new Set(activityRows.map((row) => row.commonsId))];
  const recipientRows = await transaction.select({
    commonsId: memberships.commonsId,
    personId: memberships.personId,
    joinedAt: memberships.joinedAt,
    membershipCreatedAt: memberships.createdAt,
    resumeAfter: eventDigestPreferences.resumeAfter,
  }).from(memberships)
    .innerJoin(people, eq(memberships.personId, people.id))
    .leftJoin(travelerProfiles, eq(memberships.personId, travelerProfiles.personId))
    .leftJoin(eventDigestPreferences, and(eq(eventDigestPreferences.personId, memberships.personId), eq(eventDigestPreferences.commonsId, memberships.commonsId)))
    .where(and(
      inArray(memberships.commonsId, eventIds),
      eq(memberships.status, "active"),
      isNotNull(people.authUserId),
      sql`coalesce(${travelerProfiles.dailyDigestEnabled}, true)`,
      eventDigestAllowed(sql`${memberships.commonsId}`, sql`${memberships.personId}`),
    ));

  const values = activityRows.flatMap((activity) => {
    if (activity.action === "travel_plan.sharing_updated" && !visibleTravelIds.has(activity.resourceId)) {
      return [];
    }
    return recipientRows
      .filter((recipient) => {
        const accessStartedAt = recipient.joinedAt ?? recipient.membershipCreatedAt;
        return recipient.commonsId === activity.commonsId && accessStartedAt <= activity.occurredAt &&
          (!recipient.resumeAfter || activity.occurredAt > recipient.resumeAfter);
      })
      .map((recipient) => ({
        recipientPersonId: recipient.personId,
        commonsId: activity.commonsId,
        sourceType: "shared_activity",
        sourceId: activity.id,
        payload: {
          kind: "activity" as const,
          summary: activity.summary,
          occurredAt: activity.occurredAt.toISOString(),
          action: activity.action,
          resourceType: activity.resourceType,
          resourceId: activity.resourceId,
        },
        createdAt: activity.occurredAt,
      }));
  });
  if (!values.length) return 0;
  const inserted = await transaction.insert(conversationDigestItems)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: conversationDigestItems.id });
  return inserted.length;
}

export type LeasedConversationDigest = {
  id: string;
  periodKey: string;
  leaseAttempt: number;
  payload: ConversationDigestPayload;
};

function periodKey(now: Date) {
  return now.toISOString().slice(0, 10);
}

export async function queueConversationDigests(
  now = new Date(),
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      await materializeSharedActivityItems(transaction, now);
      await transaction.delete(conversationDigestItems).where(and(
        isNull(conversationDigestItems.deliveryId),
        isNull(conversationDigestItems.includedAt),
        or(sql`not exists (
          select 1 from ${memberships}
          where ${memberships.commonsId} = ${conversationDigestItems.commonsId}
            and ${memberships.personId} = ${conversationDigestItems.recipientPersonId}
            and ${memberships.status} = 'active'
        )`, sql`exists (
          select 1 from ${travelerProfiles}
          where ${travelerProfiles.personId} = ${conversationDigestItems.recipientPersonId}
            and ${travelerProfiles.dailyDigestEnabled} = false
        )`, sql`not ${eventDigestAllowed(sql`${conversationDigestItems.commonsId}`, sql`${conversationDigestItems.recipientPersonId}`, sql`${conversationDigestItems.createdAt}`)}`),
      ));
      const rows = await transaction
        .select({
          itemId: conversationDigestItems.id,
          recipientPersonId: conversationDigestItems.recipientPersonId,
          recipientAuthUserId: people.authUserId,
          recipientName: people.displayName,
          eventName: commons.name,
          eventSlug: commons.slug,
          eventId: commons.id,
          eventStartsOn: commons.startsOn,
          eventEndsOn: commons.endsOn,
          eventLocationName: commons.locationName,
          eventLocationNames: commons.locationNames,
          sourceId: conversationDigestItems.sourceId,
          payload: conversationDigestItems.payload,
          createdAt: conversationDigestItems.createdAt,
        })
        .from(conversationDigestItems)
        .innerJoin(people, eq(conversationDigestItems.recipientPersonId, people.id))
        .leftJoin(travelerProfiles, eq(conversationDigestItems.recipientPersonId, travelerProfiles.personId))
        .innerJoin(commons, eq(conversationDigestItems.commonsId, commons.id))
        .innerJoin(memberships, and(
          eq(memberships.commonsId, conversationDigestItems.commonsId),
          eq(memberships.personId, conversationDigestItems.recipientPersonId),
        ))
        .where(and(
          isNull(conversationDigestItems.deliveryId),
          isNull(conversationDigestItems.includedAt),
          lte(conversationDigestItems.createdAt, now),
          eq(memberships.status, "active"),
          isNotNull(people.authUserId),
          sql`coalesce(${travelerProfiles.dailyDigestEnabled}, true)`,
          eventDigestAllowed(sql`${conversationDigestItems.commonsId}`, sql`${conversationDigestItems.recipientPersonId}`, sql`${conversationDigestItems.createdAt}`),
        ))
        .orderBy(
          asc(conversationDigestItems.recipientPersonId),
          asc(conversationDigestItems.commonsId),
          asc(conversationDigestItems.createdAt),
        )
        .for("update", { of: conversationDigestItems, skipLocked: true });

      const byRecipient = new Map<string, {
        itemIds: string[];
        windowStartedAt: Date;
        payload: ConversationDigestPayload;
        events: Map<string, ConversationDigestPayload["events"][number]>;
      }>();

      for (const row of rows) {
        if (!row.recipientAuthUserId) continue;
        let recipient = byRecipient.get(row.recipientPersonId);
        if (!recipient) {
          recipient = {
            itemIds: [],
            windowStartedAt: row.createdAt,
            payload: {
              recipientAuthUserId: row.recipientAuthUserId,
              recipientName: row.recipientName,
              events: [],
            },
            events: new Map(),
          };
          byRecipient.set(row.recipientPersonId, recipient);
        }
        recipient.itemIds.push(row.itemId);
        let event = recipient.events.get(row.eventId);
        if (!event) {
          event = {
            name: row.eventName,
            slug: row.eventSlug,
            startsOn: row.eventStartsOn,
            endsOn: row.eventEndsOn,
            locationName: row.eventLocationName,
            locationNames: row.eventLocationNames,
            activityCount: 0,
            messageCount: 0,
            expenseCount: 0,
            activities: [],
            messages: [],
            expenses: [],
          };
          recipient.events.set(row.eventId, event);
          recipient.payload.events.push(event);
        }
        if (row.payload.kind === "activity") {
          event.activityCount = (event.activityCount ?? 0) + 1;
          event.activities ??= [];
          event.activities.push({
            summary: row.payload.summary,
            occurredAt: row.payload.occurredAt,
            action: row.payload.action,
            resourceType: row.payload.resourceType,
            resourceId: row.payload.resourceId,
          });
        } else if (row.payload.kind === "message") {
          event.messageCount += 1;
          event.messages.push({
            actorName: row.payload.actorName,
            body: row.payload.body,
            occurredAt: row.payload.occurredAt,
          });
          if (event.messages.length > 5) event.messages.shift();
        } else {
          event.expenseCount = (event.expenseCount ?? 0) + 1;
          event.expenses ??= [];
          event.expenses.push({
            resourceId: row.payload.resourceId ?? row.sourceId,
            title: row.payload.title,
            amountCents: row.payload.amountCents,
            currency: row.payload.currency,
            paidByName: row.payload.paidByName,
            addedAt: row.payload.addedAt,
          });
        }
      }

      let queued = 0;
      let windowStartedAt = now;
      for (const [recipientPersonId, recipient] of byRecipient) {
        for (const event of recipient.payload.events) {
          const compacted = compactDigestEvent(event.activities ?? [], event.expenses ?? []);
          event.activityCount = compacted.activities.length;
          event.activities = compacted.activities.slice(0, 8);
          event.expenses = compacted.expenses.slice(-5);
          event.expenseCount = compacted.expenses.length;
        }
        recipient.payload.events = recipient.payload.events.filter((event) => (
          (event.activityCount ?? 0) + event.messageCount + (event.expenseCount ?? 0) > 0
        ));
        if (!recipient.payload.events.length) {
          await transaction.update(conversationDigestItems)
            .set({ includedAt: now })
            .where(and(
              inArray(conversationDigestItems.id, recipient.itemIds),
              isNull(conversationDigestItems.deliveryId),
              isNull(conversationDigestItems.includedAt),
            ));
          continue;
        }
        if (recipient.windowStartedAt < windowStartedAt) {
          windowStartedAt = recipient.windowStartedAt;
        }
        const [inserted] = await transaction
          .insert(conversationDigestDeliveries)
          .values({
            recipientPersonId,
            periodKey: periodKey(now),
            windowStartedAt: recipient.windowStartedAt,
            windowEndedAt: now,
            payload: recipient.payload,
            availableAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: conversationDigestDeliveries.id });
        if (!inserted) continue;
        await transaction
          .update(conversationDigestItems)
          .set({ deliveryId: inserted.id, includedAt: now })
          .where(and(
            inArray(conversationDigestItems.id, recipient.itemIds),
            isNull(conversationDigestItems.deliveryId),
            isNull(conversationDigestItems.includedAt),
          ));
        queued += 1;
      }
      return { queued, windowStartedAt, windowEndedAt: now };
    });
  } finally {
    await database.close();
  }
}

export async function leaseConversationDigest(
  now = new Date(),
  databaseUrl?: string,
): Promise<LeasedConversationDigest | null> {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      while (true) {
        const [candidate] = await transaction.select().from(conversationDigestDeliveries)
          .where(and(lt(conversationDigestDeliveries.attempts, DELIVERY_MAX_ATTEMPTS), lte(conversationDigestDeliveries.availableAt, now), or(
            inArray(conversationDigestDeliveries.status, ["queued", "failed"]),
            and(eq(conversationDigestDeliveries.status, "leased"), lte(conversationDigestDeliveries.leaseExpiresAt, now)))))
          .orderBy(asc(conversationDigestDeliveries.availableAt)).for("update", { skipLocked: true }).limit(1);
        if (!candidate) return null;
        const payload = await permittedDigestPayload(transaction, candidate.recipientPersonId, candidate.payload);
        if (!payload.events.length) {
          await transaction.update(conversationDigestDeliveries).set({ status: "cancelled", leaseExpiresAt: null,
            payload: { recipientAuthUserId: "", recipientName: "", events: [] },
            errorCode: "recipient_unavailable", updatedAt: now })
            .where(eq(conversationDigestDeliveries.id, candidate.id));
          continue;
        }
        const leaseAttempt = candidate.attempts + 1;
        await transaction.update(conversationDigestDeliveries).set({ status: "leased", attempts: leaseAttempt,
          leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS), updatedAt: now }).where(eq(conversationDigestDeliveries.id, candidate.id));
        return { id: candidate.id, periodKey: candidate.periodKey, payload, leaseAttempt };
      }
    });
  } finally {
    await database.close();
  }
}

export async function completeConversationDigest(
  id: string,
  result: { leaseAttempt: number; sent: boolean; providerMessageId?: string; errorCode?: string },
  now = new Date(),
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    await database.db
      .update(conversationDigestDeliveries)
      .set({
        status: result.sent ? "sent" : result.errorCode === "recipient_unavailable" ? "cancelled" : "failed",
        ...(result.sent || result.errorCode === "recipient_unavailable" ? { payload: { recipientAuthUserId: "", recipientName: "", events: [] } } : {}),
        providerMessageId: result.providerMessageId ?? null,
        errorCode: result.sent ? null : result.errorCode ?? "delivery_failed",
        sentAt: result.sent ? now : null,
        leaseExpiresAt: null,
        availableAt: result.sent ? now : new Date(now.getTime() + DELIVERY_RETRY_MS),
        updatedAt: now,
      })
      .where(and(
        eq(conversationDigestDeliveries.id, id),
        eq(conversationDigestDeliveries.status, "leased"),
        eq(conversationDigestDeliveries.attempts, result.leaseAttempt),
        gt(conversationDigestDeliveries.leaseExpiresAt, now),
      ));
  } finally {
    await database.close();
  }
}

async function permittedDigestPayload(tx: DigestTransaction, recipientPersonId: string, payload: ConversationDigestPayload) {
  const rows = await tx.select({ slug: commons.slug, resumeAfter: eventDigestPreferences.resumeAfter }).from(memberships)
    .innerJoin(commons, eq(commons.id, memberships.commonsId)).innerJoin(people, eq(people.id, memberships.personId))
    .leftJoin(travelerProfiles, eq(travelerProfiles.personId, memberships.personId))
    .leftJoin(eventDigestPreferences, and(eq(eventDigestPreferences.personId, memberships.personId), eq(eventDigestPreferences.commonsId, memberships.commonsId)))
    .where(and(eq(memberships.personId, recipientPersonId), eq(memberships.status, "active"),
      eq(memberships.accessMode, "account"), eq(people.authUserId, payload.recipientAuthUserId),
      sql`coalesce(${travelerProfiles.dailyDigestEnabled}, true)`,
      eventDigestAllowed(sql`${memberships.commonsId}`, sql`${memberships.personId}`)));
  const allowed = new Map(rows.map(row => [row.slug, row.resumeAfter]));
  return { ...payload, events: payload.events.flatMap(event => {
    if (!allowed.has(event.slug)) return [];
    const after = allowed.get(event.slug);
    if (!after) return [event];
    const messages = event.messages.filter(item => new Date(item.occurredAt) > after);
    const activities = (event.activities ?? []).filter(item => new Date(item.occurredAt) > after);
    const expenses = (event.expenses ?? []).filter(item => new Date(item.addedAt) > after);
    // Payload previews are capped. Keep their full counts when no preview content
    // was excluded; an event with eight new messages still has eight, not five.
    if (messages.length === event.messages.length && activities.length === (event.activities ?? []).length &&
        expenses.length === (event.expenses ?? []).length) return [event];
    return messages.length + activities.length + expenses.length ? [{ ...event, messages, activities, expenses,
      messageCount: messages.length, activityCount: activities.length, expenseCount: expenses.length }] : [];
  }) };
}

export async function revalidateConversationDigest(id: string, leaseAttempt: number, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [row] = await tx.select().from(conversationDigestDeliveries).where(and(eq(conversationDigestDeliveries.id, id),
        eq(conversationDigestDeliveries.status, "leased"), eq(conversationDigestDeliveries.attempts, leaseAttempt),
        gt(conversationDigestDeliveries.leaseExpiresAt, new Date()))).limit(1);
      if (!row) return null;
      const payload = await permittedDigestPayload(tx, row.recipientPersonId, row.payload);
      return payload.events.length ? payload : null;
    });
  } finally { await database.close(); }
}

export async function enqueueMessageDeliveries(tx: DigestTransaction, eventId: string, messageId: string, senderId: string, now: Date) {
  const [message] = await tx.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.actorPersonId, senderId))).limit(1);
  if (!message) throw new Error("Committed message not found.");
  const recipients = await tx.select({ personId: memberships.personId }).from(memberships)
    .innerJoin(people, eq(people.id, memberships.personId)).leftJoin(travelerProfiles, eq(travelerProfiles.personId, memberships.personId))
    .where(and(eq(memberships.commonsId, eventId), eq(memberships.status, "active"), isNotNull(people.authUserId),
      sql`coalesce(${travelerProfiles.dailyDigestEnabled}, true)`,
      eventDigestAllowed(sql`${memberships.commonsId}`, sql`${memberships.personId}`, sql`${now.toISOString()}::timestamptz`)));
  if (recipients.length) await tx.insert(conversationDigestItems).values(recipients.map(row => ({
    recipientPersonId: row.personId, commonsId: eventId, sourceType: "message", sourceId: messageId,
    payload: { kind: "message" as const, actorName: message.actorName, body: message.body, occurredAt: now.toISOString() },
    createdAt: now,
  }))).onConflictDoNothing();
}
