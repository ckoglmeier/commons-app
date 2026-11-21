import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { createDatabase } from "./client";
import { invitations, invitationDeliveryAttempts, memberships, people } from "./schema";
import { hashOpaqueToken, protectOpaqueToken, revealOpaqueToken } from "./tokens";
import { personalInvitationExpired } from "./onboarding-repository";

export const INVITATION_SIGN_IN_LIFETIME_MS = 60 * 60 * 1000;
export type InvitationEmailProof = {
  purpose: "invitation-sign-in-v1";
  invitationHash: string;
  tokenVersion: number;
  email: string;
  authUserId: string;
  tokenHash: string;
  type: "magiclink" | "signup";
  expiresAt: number;
};

export function sealInvitationEmailProof(input: Omit<InvitationEmailProof, "purpose" | "invitationHash" | "expiresAt"> & { token: string }, now = Date.now()) {
  const { token, ...proof } = input;
  return protectOpaqueToken(JSON.stringify({ ...proof, email: proof.email.trim().toLowerCase(), purpose: "invitation-sign-in-v1", invitationHash: hashOpaqueToken(token), expiresAt: now + INVITATION_SIGN_IN_LIFETIME_MS }));
}

// Decryption is not authentication. Only the provider can consume this single-use proof.
export function readInvitationEmailProof(entry: string, token: string, now = Date.now()): InvitationEmailProof | null {
  try {
    if (entry.length > 4096) return null;
    const proof = JSON.parse(revealOpaqueToken(entry)) as InvitationEmailProof;
    if (proof.purpose !== "invitation-sign-in-v1" || proof.invitationHash !== hashOpaqueToken(token)
      || !Number.isInteger(proof.tokenVersion) || typeof proof.email !== "string"
      || typeof proof.authUserId !== "string" || typeof proof.tokenHash !== "string"
      || !["magiclink", "signup"].includes(proof.type) || !Number.isFinite(proof.expiresAt)
      || proof.expiresAt <= now || proof.expiresAt > now + INVITATION_SIGN_IN_LIFETIME_MS) return null;
    return proof;
  } catch { return null; }
}

// Server-only recipient context. Never include this object in a public API/snapshot.
export async function getInvitationEntryContext(token: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [invite] = await database.db.select().from(invitations).where(eq(invitations.tokenHash, hashOpaqueToken(token))).limit(1);
    if (!invite || !["pending", "accepted"].includes(invite.status) || !invite.recipientEmail) return null;
    if (invite.status === "pending" && personalInvitationExpired(invite.expiresAt)) return null;
    let acceptedAuthUserId: string | null = null;
    if (invite.status === "accepted") {
      const [member] = await database.db.select({ authUserId: people.authUserId }).from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId)).where(and(
          eq(memberships.commonsId, invite.commonsId), eq(memberships.personId, invite.acceptedByPersonId!),
          eq(memberships.status, "active"), inArray(memberships.attendanceState, ["helping", "attending"]),
        )).limit(1);
      if (!member?.authUserId) return null;
      acceptedAuthUserId = member.authUserId;
    }
    return { invitationId: invite.id, commonsId: invite.commonsId, tokenVersion: invite.tokenVersion,
      recipientEmail: invite.recipientEmail, status: invite.status, acceptedAuthUserId };
  } finally { await database.close(); }
}

export function invitationProofMatches(proof: InvitationEmailProof, context: NonNullable<Awaited<ReturnType<typeof getInvitationEntryContext>>>) {
  return proof.tokenVersion === context.tokenVersion && (context.acceptedAuthUserId
    ? proof.authUserId === context.acceptedAuthUserId
    : proof.email === context.recipientEmail.trim().toLowerCase());
}

// Stable across provider timeouts/retries. An organizer-visible delivery ID is never a credential.
export async function cacheInvitationAuthenticationEntry(id: string, leaseAttempt: number, entry: string, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [stored] = await database.db.update(invitationDeliveryAttempts).set({ authenticationEntry: entry }).where(and(
      eq(invitationDeliveryAttempts.id, id), eq(invitationDeliveryAttempts.status, "processing"),
      eq(invitationDeliveryAttempts.attempts, leaseAttempt), gte(invitationDeliveryAttempts.leaseExpiresAt, new Date()),
      isNull(invitationDeliveryAttempts.authenticationEntry),
    )).returning({ entry: invitationDeliveryAttempts.authenticationEntry });
    if (!stored?.entry) throw new Error("Invitation delivery lease changed.");
    return stored.entry;
  } finally { await database.close(); }
}

// Anonymous recovery may only send to the server-resolved recipient, with a durable per-invite limit.
export async function queueInvitationEntryRecovery(token: string, pollPublicId: string | null, databaseUrl?: string) {
  if (pollPublicId && !/^[0-9a-f]{12}$/.test(pollPublicId)) throw new Error("Invalid poll return.");
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [invite] = await tx.select().from(invitations).where(eq(invitations.tokenHash, hashOpaqueToken(token))).for("update").limit(1);
      if (!invite || !["pending", "accepted"].includes(invite.status) || !invite.recipientEmail) throw new Error("Invitation unavailable.");
      const now = new Date();
      if (invite.status === "pending" && personalInvitationExpired(invite.expiresAt, now)) throw new Error("Invitation unavailable.");
      const recent = await tx.select({ createdAt: invitationDeliveryAttempts.createdAt }).from(invitationDeliveryAttempts).where(and(
        eq(invitationDeliveryAttempts.invitationId, invite.id), gte(invitationDeliveryAttempts.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ));
      if (recent.length >= 5 || recent.some(row => row.createdAt.getTime() > now.getTime() - 60_000)) return { status: "limited" as const };
      await tx.update(invitationDeliveryAttempts).set({ status: "cancelled", updatedAt: now }).where(and(
        eq(invitationDeliveryAttempts.invitationId, invite.id), inArray(invitationDeliveryAttempts.status, ["queued", "processing"]),
      ));
      const [attempt] = await tx.insert(invitationDeliveryAttempts).values({
        commonsId: invite.commonsId, invitationId: invite.id, tokenVersion: invite.tokenVersion, returnPollPublicId: pollPublicId,
      }).returning({ id: invitationDeliveryAttempts.id });
      await tx.update(invitations).set({ deliveryState: "queued", queuedAt: now, deliveryErrorCode: null, updatedAt: now }).where(eq(invitations.id, invite.id));
      return { status: "queued" as const, deliveryAttemptId: attempt.id };
    });
  } finally { await database.close(); }
}
