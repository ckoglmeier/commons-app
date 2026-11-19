import { and, desc, eq, ilike, inArray, isNotNull, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  commons,
  conversationDigestDeliveries,
  eventCreationAccess,
  eventCreationDrafts,
  identities,
  invitationDeliveryAttempts,
  invitations,
  operatorAuditEvents,
  operatorNotificationDeliveries,
  people,
} from "./schema";
import { hashNormalizedEmail } from "./tokens";
import { assertTripMayInvite } from "./trip-activation-repository";

export type EventCreationAccessState = "requested" | "approved" | "revoked";

export async function searchOperatorAccounts(query: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const normalized = query.trim();
    if (normalized.length < 2) return [];
    const selection = {
      personId: people.id,
      displayName: people.displayName,
      authUserId: people.authUserId,
      accessStatus: eventCreationAccess.status,
      requesterEmail: eventCreationAccess.requesterEmail,
    };
    if (normalized.includes("@")) {
      const rows = await database.db.select(selection).from(identities)
        .innerJoin(people, eq(people.id, identities.personId))
        .leftJoin(eventCreationAccess, eq(eventCreationAccess.personId, people.id))
        .where(and(
          eq(identities.kind, "email"),
          eq(identities.normalizedHash, hashNormalizedEmail(normalized)),
          eq(identities.state, "claimed"),
          isNotNull(people.authUserId),
        ))
        .limit(5);
      return rows;
    }
    const name = normalized.replace(/[\\%_]/g, "").trim();
    if (name.length < 2) return [];
    const rows = await database.db.select(selection).from(people)
      .leftJoin(eventCreationAccess, eq(eventCreationAccess.personId, people.id))
      .where(and(isNotNull(people.authUserId), ilike(people.displayName, `%${name}%`)))
      .orderBy(people.displayName)
      .limit(20);
    return rows;
  } finally { await database.close(); }
}

export async function getEventCreationAccess(personId: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select().from(eventCreationAccess)
      .where(eq(eventCreationAccess.personId, personId)).limit(1);
    return row ?? null;
  } finally { await database.close(); }
}

export async function requestEventCreationAccess(
  input: { personId: string; email: string; resumeDraftId?: string },
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`access-request:${input.personId}`}))`);
      const [existing] = await tx.select().from(eventCreationAccess)
        .where(eq(eventCreationAccess.personId, input.personId)).limit(1);
      if (input.resumeDraftId) {
        // Only the person's own draft can become their return point.
        const [draft] = await tx.select({ id: eventCreationDrafts.id }).from(eventCreationDrafts)
          .where(and(eq(eventCreationDrafts.id, input.resumeDraftId), eq(eventCreationDrafts.createdByPersonId, input.personId)));
        if (!draft) throw new Error("That private draft is no longer available.");
        if (existing?.status === "approved" || existing?.status === "requested") {
          const [updated] = await tx.update(eventCreationAccess).set({ resumeDraftId: input.resumeDraftId, updatedAt: new Date() })
            .where(eq(eventCreationAccess.personId, input.personId)).returning();
          return updated;
        }
      }
      if (existing?.status === "approved" || existing?.status === "requested") return existing;
      const now = new Date();
      const [row] = await tx.insert(eventCreationAccess).values({
        personId: input.personId,
        requesterEmail: input.email.trim().toLowerCase(),
        resumeDraftId: input.resumeDraftId ?? null,
        status: "requested",
        requestedAt: now,
      }).onConflictDoUpdate({
        target: eventCreationAccess.personId,
        set: {
          requesterEmail: input.email.trim().toLowerCase(),
          ...(input.resumeDraftId ? { resumeDraftId: input.resumeDraftId } : {}),
          status: "requested",
          requestedAt: now,
          decidedAt: null,
          decidedByPersonId: null,
          decisionNote: null,
          updatedAt: now,
        },
      }).returning();
      await tx.insert(operatorNotificationDeliveries).values({
        dedupeKey: `beta-access:${row.personId}:${row.requestedAt.toISOString()}`,
        payload: { kind: "beta_access", email: row.requesterEmail, personId: row.personId },
      }).onConflictDoNothing();
      return row;
    });
  } finally { await database.close(); }
}

export async function listOperatorOverview(databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const access = await database.db.select().from(eventCreationAccess)
      .orderBy(desc(eventCreationAccess.requestedAt)).limit(100);
    const invitationRows = await database.db.select({
      invitationId: invitations.id,
      eventId: commons.id,
      eventSlug: commons.slug,
      eventName: commons.name,
      recipientName: invitations.recipientName,
      recipientEmail: invitations.recipientEmail,
      invitationStatus: invitations.status,
      deliveryState: invitations.deliveryState,
      deliveryErrorCode: invitations.deliveryErrorCode,
      lastAttemptAt: invitations.lastAttemptAt,
      updatedAt: invitations.updatedAt,
    }).from(invitations).innerJoin(commons, eq(commons.id, invitations.commonsId))
      .where(inArray(invitations.status, ["pending", "accepted"]))
      .orderBy(desc(invitations.updatedAt)).limit(100);
    const digestAttention = await database.db.select({
      id: conversationDigestDeliveries.id,
      recipientName: people.displayName,
      periodKey: conversationDigestDeliveries.periodKey,
      status: conversationDigestDeliveries.status,
      attempts: conversationDigestDeliveries.attempts,
      availableAt: conversationDigestDeliveries.availableAt,
      leaseExpiresAt: conversationDigestDeliveries.leaseExpiresAt,
      errorCode: conversationDigestDeliveries.errorCode,
      sentAt: conversationDigestDeliveries.sentAt,
      updatedAt: conversationDigestDeliveries.updatedAt,
      eventCount: sql<number>`jsonb_array_length(${conversationDigestDeliveries.payload}->'events')`,
    }).from(conversationDigestDeliveries)
      .innerJoin(people, eq(people.id, conversationDigestDeliveries.recipientPersonId))
      .where(inArray(conversationDigestDeliveries.status, ["queued", "failed", "leased"]))
      .orderBy(desc(conversationDigestDeliveries.updatedAt)).limit(100);
    const recentDigests = await database.db.select({
      id: conversationDigestDeliveries.id,
      recipientName: people.displayName,
      periodKey: conversationDigestDeliveries.periodKey,
      status: conversationDigestDeliveries.status,
      attempts: conversationDigestDeliveries.attempts,
      availableAt: conversationDigestDeliveries.availableAt,
      leaseExpiresAt: conversationDigestDeliveries.leaseExpiresAt,
      errorCode: conversationDigestDeliveries.errorCode,
      sentAt: conversationDigestDeliveries.sentAt,
      updatedAt: conversationDigestDeliveries.updatedAt,
      eventCount: sql<number>`jsonb_array_length(${conversationDigestDeliveries.payload}->'events')`,
    }).from(conversationDigestDeliveries)
      .innerJoin(people, eq(people.id, conversationDigestDeliveries.recipientPersonId))
      .where(eq(conversationDigestDeliveries.status, "sent"))
      .orderBy(desc(conversationDigestDeliveries.sentAt)).limit(20);
    // Public acquisition identifiers only. Never brief text, people or plan details.
    const resumeIds = access.flatMap(row => row.resumeDraftId ? [row.resumeDraftId] : []);
    const entryRows = resumeIds.length ? await database.db.select({ id: eventCreationDrafts.id, entryContext: eventCreationDrafts.entryContext })
      .from(eventCreationDrafts).where(inArray(eventCreationDrafts.id, resumeIds)) : [];
    const entryByDraft = new Map(entryRows.map(row => [row.id, row.entryContext]));
    return { access: access.map(row => ({ ...row, entryContext: row.resumeDraftId ? entryByDraft.get(row.resumeDraftId) ?? null : null })), invitations: invitationRows, digests: [...digestAttention, ...recentDigests] };
  } finally { await database.close(); }
}

export async function decideEventCreationAccess(
  input: {
    personId: string;
    status: "approved" | "revoked";
    actorPersonId: string;
    requesterEmail?: string;
    reason?: string;
    /** False while beta activation is on: an approval to invite is not a grant of Coordinator, research or voice. */
    grantsPilotCapabilities?: boolean;
  },
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`access-request:${input.personId}`}))`);
      const now = new Date();
      const [account] = await transaction.select({ authUserId: people.authUserId }).from(people)
        .where(eq(people.id, input.personId)).limit(1);
      if (!account?.authUserId) throw new Error("Event-creation access requires a claimed account.");
      const [existing] = await transaction.select().from(eventCreationAccess)
        .where(eq(eventCreationAccess.personId, input.personId)).for("update").limit(1);
      let row: typeof eventCreationAccess.$inferSelect | undefined;
      const betaDecision = input.grantsPilotCapabilities === false;
      if (existing) {
        const newlyApproved = input.status === "approved" && existing.status !== "approved";
        [row] = await transaction.update(eventCreationAccess).set({
          status: input.status,
          // Restoring or re-approving an earlier explicit decision keeps it; only a first decision on a request is set here.
          ...(betaDecision && existing.status === "requested" ? { grantsPilotCapabilities: false } : {}),
          ...(betaDecision ? { approvalNoticeStatus: input.status === "revoked" ? "none" : newlyApproved ? "prepared" : existing.approvalNoticeStatus } : {}),
          decidedAt: now,
          decidedByPersonId: input.actorPersonId,
          decisionNote: input.reason?.trim() || null,
          updatedAt: now,
        }).where(eq(eventCreationAccess.personId, input.personId)).returning();
      } else {
        const requesterEmail = input.requesterEmail?.trim().toLowerCase();
        // With approval gone, anyone can pay without a row, so an operator must be able to revoke one who has none.
        if ((input.status !== "approved" && !betaDecision) || !requesterEmail) {
          throw new Error("Search by exact email before granting event-creation access.");
        }
        const [matchingIdentity] = await transaction.select({ id: identities.id }).from(identities)
          .where(and(
            eq(identities.personId, input.personId),
            eq(identities.kind, "email"),
            eq(identities.normalizedHash, hashNormalizedEmail(requesterEmail)),
            eq(identities.state, "claimed"),
          )).limit(1);
        if (!matchingIdentity) throw new Error("That email does not belong to the selected account.");
        [row] = await transaction.insert(eventCreationAccess).values({
          personId: input.personId,
          requesterEmail,
          ...(betaDecision ? { grantsPilotCapabilities: false, approvalNoticeStatus: input.status === "approved" ? "prepared" : "none" } : {}),
          status: input.status,
          requestedAt: now,
          decidedAt: now,
          decidedByPersonId: input.actorPersonId,
          decisionNote: input.reason?.trim() || null,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: eventCreationAccess.personId,
          set: {
            status: input.status,
            decidedAt: now,
            decidedByPersonId: input.actorPersonId,
            decisionNote: input.reason?.trim() || null,
            updatedAt: now,
          },
        }).returning();
      }
      if (!row) throw new Error("That account is no longer available.");
      await transaction.insert(operatorAuditEvents).values({
        actorPersonId: input.actorPersonId,
        action: `event_creation_access.${input.status}`,
        resourceType: "person",
        resourceId: input.personId,
        reason: input.reason?.trim() || null,
      });
      return row;
    });
  } finally { await database.close(); }
}

export async function queueOperatorInvitationRetry(
  input: { invitationId: string; actorPersonId: string; reason?: string },
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const [invitation] = await transaction.select().from(invitations)
        .where(and(eq(invitations.id, input.invitationId), eq(invitations.status, "pending"))).limit(1);
      if (!invitation?.recipientEmail) throw new Error("That pending invitation cannot be emailed.");
      if (!invitation.tokenValue) throw new Error("That private link must be replaced from the event before email can be retried.");
      await assertTripMayInvite(transaction, invitation.commonsId);
      const now = new Date();
      await transaction.update(invitationDeliveryAttempts).set({ status: "cancelled", updatedAt: now })
        .where(and(
          eq(invitationDeliveryAttempts.invitationId, invitation.id),
          inArray(invitationDeliveryAttempts.status, ["queued", "processing"]),
        ));
      const [attempt] = await transaction.insert(invitationDeliveryAttempts).values({
        commonsId: invitation.commonsId,
        invitationId: invitation.id,
        tokenVersion: invitation.tokenVersion,
        status: "queued",
        availableAt: now,
      }).returning({ id: invitationDeliveryAttempts.id });
      await transaction.update(invitations).set({ deliveryState: "queued", queuedAt: now, deliveryErrorCode: null, updatedAt: now })
        .where(eq(invitations.id, invitation.id));
      await transaction.insert(operatorAuditEvents).values({
        actorPersonId: input.actorPersonId,
        action: "invitation_delivery.retry_queued",
        resourceType: "invitation",
        resourceId: invitation.id,
        reason: input.reason?.trim() || null,
      });
      return attempt;
    });
  } finally { await database.close(); }
}

export async function retryOperatorConversationDigest(
  input: { deliveryId: string; actorPersonId: string; reason?: string },
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const [delivery] = await transaction.select({
        id: conversationDigestDeliveries.id,
        status: conversationDigestDeliveries.status,
        leaseExpiresAt: conversationDigestDeliveries.leaseExpiresAt,
      }).from(conversationDigestDeliveries)
        .where(eq(conversationDigestDeliveries.id, input.deliveryId))
        .for("update")
        .limit(1);
      const leaseExpired = delivery?.status === "leased"
        && delivery.leaseExpiresAt !== null
        && delivery.leaseExpiresAt <= new Date();
      if (!delivery || (delivery.status !== "failed" && !leaseExpired)) {
        throw new Error("Only a failed or interrupted daily email can be retried.");
      }
      const now = new Date();
      const [queued] = await transaction.update(conversationDigestDeliveries).set({
        status: "queued",
        attempts: 0,
        availableAt: now,
        leaseExpiresAt: null,
        errorCode: null,
        updatedAt: now,
      }).where(eq(conversationDigestDeliveries.id, delivery.id)).returning({
        id: conversationDigestDeliveries.id,
        status: conversationDigestDeliveries.status,
      });
      await transaction.insert(operatorAuditEvents).values({
        actorPersonId: input.actorPersonId,
        action: "conversation_digest.retry_queued",
        resourceType: "conversation_digest_delivery",
        resourceId: delivery.id,
        reason: input.reason?.trim() || null,
      });
      return queued;
    });
  } finally { await database.close(); }
}

/** Durable approval notice lease. Delivery stays separate from the access decision and queued is never delivered. */
export async function reserveBetaApprovalNotice(personId: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [row] = await tx.select().from(eventCreationAccess).where(eq(eventCreationAccess.personId, personId)).for("update");
      if (!row || row.status !== "approved" || row.grantsPilotCapabilities || !["prepared", "sending", "retry_pending"].includes(row.approvalNoticeStatus)) return null;
      const now = new Date();
      if (row.approvalNoticeStatus === "sending" && row.approvalNoticeLeaseAt && now.getTime() - row.approvalNoticeLeaseAt.getTime() < 60_000) return null;
      const [leased] = await tx.update(eventCreationAccess).set({ approvalNoticeStatus: "sending", approvalNoticeLeaseAt: now })
        .where(eq(eventCreationAccess.personId, personId)).returning();
      return { personId, email: leased.requesterEmail, resumeDraftId: leased.resumeDraftId, decidedAt: (leased.decidedAt ?? leased.requestedAt).toISOString(), leaseAt: now.toISOString() };
    });
  } finally { await database.close(); }
}

export async function betaApprovalNoticeStillCurrent(personId: string, leaseAt: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select({ id: eventCreationAccess.personId }).from(eventCreationAccess).where(and(
      eq(eventCreationAccess.personId, personId), eq(eventCreationAccess.status, "approved"), eq(eventCreationAccess.approvalNoticeStatus, "sending"), eq(eventCreationAccess.approvalNoticeLeaseAt, new Date(leaseAt)),
    ));
    return Boolean(row);
  } finally { await database.close(); }
}

export async function finishBetaApprovalNotice(personId: string, leaseAt: string, sent: boolean, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const rows = await database.db.update(eventCreationAccess).set({ approvalNoticeStatus: sent ? "sent" : "retry_pending", approvalNoticeSentAt: sent ? new Date() : null, approvalNoticeLeaseAt: null }).where(and(
      eq(eventCreationAccess.personId, personId), eq(eventCreationAccess.status, "approved"), eq(eventCreationAccess.approvalNoticeStatus, "sending"), eq(eventCreationAccess.approvalNoticeLeaseAt, new Date(leaseAt)),
    )).returning({ personId: eventCreationAccess.personId });
    return rows.length === 1;
  } finally { await database.close(); }
}
