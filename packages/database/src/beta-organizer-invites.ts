import { and, eq, isNull, sql, desc } from "drizzle-orm";
import { createDatabase } from "./client";
import { betaOrganizerInvites, eventCreationAccess, identities, operatorAuditEvents, people } from "./schema";
import { hashNormalizedEmail } from "./tokens";

export function normalizeBetaInviteEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

export async function prepareBetaOrganizerInvite(emailInput: string, actorPersonId: string, databaseUrl?: string, messageInput = "") {
  const email = normalizeBetaInviteEmail(emailInput);
  const message = messageInput.trim();
  if (message.length > 2000) throw new Error("Keep the message to 2,000 characters.");
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`beta-invite:${email}`}))`);
      const [existing] = await tx.select().from(betaOrganizerInvites).where(eq(betaOrganizerInvites.email, email));
      if (existing) return existing;
      const [invite] = await tx.insert(betaOrganizerInvites).values({ email, message, invitedByPersonId: actorPersonId }).returning();
      await tx.insert(operatorAuditEvents).values({ actorPersonId, action: "beta_organizer.invited", resourceType: "beta_invite", resourceId: invite.id });
      return invite;
    });
  } finally { await database.close(); }
}

export async function markBetaOrganizerInviteSent(id: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try { await database.db.update(betaOrganizerInvites).set({ sentAt: new Date() }).where(eq(betaOrganizerInvites.id, id)); }
  finally { await database.close(); }
}

export async function listBetaOrganizerInvites(databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try { return await database.db.select().from(betaOrganizerInvites).orderBy(desc(betaOrganizerInvites.createdAt)).limit(100); }
  finally { await database.close(); }
}

export async function revokeBetaOrganizerInvite(id: string, actorPersonId: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try { await database.db.transaction(async tx => {
    const [invite] = await tx.select().from(betaOrganizerInvites).where(eq(betaOrganizerInvites.id, id)).for("update");
    if (!invite || invite.revokedAt) return;
    await tx.update(betaOrganizerInvites).set({ revokedAt: new Date() }).where(eq(betaOrganizerInvites.id, id));
    if (invite.claimedByPersonId) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`access-request:${invite.claimedByPersonId}`}))`);
      await tx.update(eventCreationAccess).set({ status: "revoked", decidedAt: new Date(), decidedByPersonId: actorPersonId, updatedAt: new Date() }).where(eq(eventCreationAccess.personId, invite.claimedByPersonId));
    }
    await tx.insert(operatorAuditEvents).values({ actorPersonId, action: "beta_organizer.revoked", resourceType: "beta_invite", resourceId: id });
  }); } finally { await database.close(); }
}

/** Called only with the authenticated account's email; never from request fields. */
export async function claimBetaOrganizerInvite(personId: string, emailInput: string, databaseUrl?: string, grantsPilotCapabilities = true) {
  const email = normalizeBetaInviteEmail(emailInput);
  const database = createDatabase(databaseUrl);
  try { return await database.db.transaction(async tx => {
    const [invite] = await tx.select().from(betaOrganizerInvites).where(and(eq(betaOrganizerInvites.email, email), isNull(betaOrganizerInvites.revokedAt), isNull(betaOrganizerInvites.claimedByPersonId))).for("update");
    if (!invite) return false;
    const [identity] = await tx.select({ id: identities.id }).from(identities).innerJoin(people, eq(people.id, identities.personId)).where(and(eq(identities.personId, personId), eq(identities.kind, "email"), eq(identities.state, "claimed"), eq(identities.normalizedHash, hashNormalizedEmail(email)), sql`${people.authUserId} IS NOT NULL`));
    if (!identity) return false;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`access-request:${personId}`}))`);
    const [access] = await tx.select().from(eventCreationAccess).where(eq(eventCreationAccess.personId, personId));
    // An existing revocation wins. Consuming once also prevents later reactivation.
    if (access?.status !== "revoked") {
      await tx.insert(eventCreationAccess).values({ personId, requesterEmail: email, grantsPilotCapabilities, status: "approved", decidedAt: new Date(), decidedByPersonId: invite.invitedByPersonId, decisionNote: "Beta organizer invitation" }).onConflictDoUpdate({ target: eventCreationAccess.personId, set: { ...(access?.status === "approved" ? {} : { grantsPilotCapabilities }), status: "approved", decidedAt: new Date(), decidedByPersonId: invite.invitedByPersonId, updatedAt: new Date() } });
    }
    await tx.update(betaOrganizerInvites).set({ claimedByPersonId: personId }).where(eq(betaOrganizerInvites.id, invite.id));
    await tx.insert(operatorAuditEvents).values({ actorPersonId: personId, action: "beta_organizer.claimed", resourceType: "beta_invite", resourceId: invite.id });
    return access?.status !== "revoked";
  }); } finally { await database.close(); }
}
