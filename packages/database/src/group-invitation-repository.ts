import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { GroupInvitationSchema, GroupInvitationTokenSchema, JoinGroupInvitationSchema, ManageGroupInvitationSchema, type GroupInvitationPreview } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError, commandFingerprint, runEventCommand, type CommandTransaction } from "./event-command";
import { isCommonsId } from "./commons-identifier";
import { findOrClaimPersonForAuthIdentity, type AuthenticatedIdentity } from "./onboarding-repository";
import { auditEvents, commons, consentEvents, groupInvitations, invitations, invitationDeliveryAttempts, memberships, people, processedCommands } from "./schema";
import { assertTripMayInvite, readTripInviteGate, TripActivationRequiredError } from "./trip-activation-repository";
import { expiresAfterDays, generateOpaqueToken, hashOpaqueToken, protectOpaqueToken, revealOpaqueToken, revokedOpaqueTokenHash } from "./tokens";

/** Trusted server policy, never a browser-supplied permission or identity. */
export type GroupInvitationCreatorCheck = (authUserId: string, tripId: string) => Promise<boolean>;
type Options = { databaseUrl?: string; actorPersonId: string; creatorCheck?: GroupInvitationCreatorCheck };
async function creatorAuthorized(tx: Pick<CommandTransaction, "select">, tripId: string, personId: string, check?: GroupInvitationCreatorCheck, lock = false) {
  const query = tx.select({ role: memberships.role, status: memberships.status, attendance: memberships.attendanceState, access: memberships.accessMode, authUserId: people.authUserId })
    .from(memberships).innerJoin(people, eq(people.id, memberships.personId))
    .where(and(eq(memberships.commonsId, tripId), eq(memberships.personId, personId)));
  const [creator] = await (lock ? query.for("update") : query);
  if (!creator || creator.role !== "organizer" || creator.status !== "active" || creator.attendance === "declined" || creator.access === "managed") return false;
  if (!check) return true; // Explicit database/local fixture path still requires the live organizer membership.
  if (!creator.authUserId) return false;
  try { return await check(creator.authUserId, tripId); } catch { return false; }
}
export class GroupInvitationUnavailableError extends Error {
  constructor(message = "This group invitation is no longer available. Ask the organizer for a new link.") { super(message); }
}

export async function getGroupInvitation(identifier: string, options: Options, now = new Date()) {
  const database = createDatabase(options.databaseUrl);
  try {
    const [actor] = await database.db.select({ tripId: commons.id, role: memberships.role, status: memberships.status, attendance: memberships.attendanceState })
      .from(commons).innerJoin(memberships, and(eq(memberships.commonsId, commons.id), eq(memberships.personId, options.actorPersonId)))
      .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier));
    if (actor?.role !== "organizer" || actor.status !== "active" || actor.attendance === "declined") throw new CommandAccessError();
    const [row] = await database.db.select({ link: groupInvitations, name: people.displayName }).from(groupInvitations)
      .innerJoin(people, eq(people.id, groupInvitations.createdByPersonId)).where(eq(groupInvitations.commonsId, actor.tripId));
    if (!row) return null;
    const state = row.link.revokedAt || !(await readTripInviteGate(database.db, actor.tripId)).mayInvite || !await creatorAuthorized(database.db, actor.tripId, row.link.createdByPersonId, options.creatorCheck) ? "revoked" : row.link.expiresAt <= now ? "expired" : "active";
    return GroupInvitationSchema.parse({ id: row.link.id, tripId: actor.tripId, version: row.link.version, state,
      expiresAt: row.link.expiresAt.toISOString(), createdByName: row.name,
      token: state === "active" && row.link.protectedToken ? revealOpaqueToken(row.link.protectedToken) : null });
  } finally { await database.close(); }
}

/** Only receipt IDs/versions are persisted by the shared command layer, never bearer credentials. */
export async function manageGroupInvitation(identifier: string, raw: unknown, options: Options) {
  const input = ManageGroupInvitationSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(tx => runEventCommand(tx, {
      identifier, actorPersonId: options.actorPersonId, commandId: input.commandId, action: `group_invitation.${input.action}`, input,
    }, async context => {
      if (context.role !== "organizer") throw new CommandAccessError();
      const [member] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, context.id), eq(memberships.personId, options.actorPersonId)));
      const [trip] = await tx.select({ status: commons.status }).from(commons).where(eq(commons.id, context.id));
      if (member.attendanceState === "declined" || !["planning", "active"].includes(trip.status) && input.action !== "revoke") throw new CommandAccessError();
      // Disabling a link is always allowed; making or rotating one is an invitation.
      if (input.action !== "revoke") await assertTripMayInvite(tx, context.id);
    }, async context => {
      const [old] = await tx.select().from(groupInvitations).where(eq(groupInvitations.commonsId, context.id)).for("update");
      if ((old?.version ?? 0) !== input.expectedVersion || (input.action === "create") !== !old) throw new CommandConflictError();
      const id = old?.id ?? randomUUID(), version = (old?.version ?? 0) + 1;
      if (input.action === "revoke") {
        if (!old || old.revokedAt) throw new CommandConflictError();
        await tx.update(groupInvitations).set({ tokenHash: revokedOpaqueTokenHash(), protectedToken: null, revokedAt: context.now, version, updatedAt: context.now }).where(eq(groupInvitations.id, id));
      } else {
        const token = `g_${generateOpaqueToken()}`;
        const values = { createdByPersonId: options.actorPersonId, tokenHash: hashOpaqueToken(token), protectedToken: protectOpaqueToken(token), version,
          revokedAt: null, expiresAt: expiresAfterDays(input.expiresInDays, context.now), updatedAt: context.now };
        if (old) await tx.update(groupInvitations).set(values).where(eq(groupInvitations.id, id));
        else await tx.insert(groupInvitations).values({ id, commonsId: context.id, ...values });
      }
      return { result: { linkId: id, version }, resourceType: "group_invitation", resourceId: id,
        summary: input.action === "revoke" ? "Disabled the group invitation. Existing members keep their separate access." : "Approved a reusable traveler invitation. No message was sent." };
    }));
  } finally { await database.close(); }
  // Re-read the current state after a lost-success retry; never resurrect a rotated credential.
  return getGroupInvitation(identifier, options);
}

/** Explicit minimal pre-membership projection. No cover, dates, location, roster or planning material. */
export async function getGroupInvitationPreview(token: string, databaseUrl?: string, now = new Date(), creatorCheck?: GroupInvitationCreatorCheck): Promise<GroupInvitationPreview | null> {
  if (!GroupInvitationTokenSchema.safeParse(token).success) return null;
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select({ link: groupInvitations, tripName: commons.name, tripStatus: commons.status, inviterName: people.displayName })
      .from(groupInvitations).innerJoin(commons, eq(commons.id, groupInvitations.commonsId)).innerJoin(people, eq(people.id, groupInvitations.createdByPersonId))
      .where(and(eq(groupInvitations.tokenHash, hashOpaqueToken(token)), isNull(groupInvitations.revokedAt)));
    if (!row || row.link.expiresAt <= now || !["planning", "active"].includes(row.tripStatus) || !(await readTripInviteGate(database.db, row.link.commonsId)).mayInvite || !await creatorAuthorized(database.db, row.link.commonsId, row.link.createdByPersonId, creatorCheck)) return null;
    return { tripId: row.link.commonsId, linkId: row.link.id, version: row.link.version, tripName: row.tripName, inviterName: row.inviterName, expiresAt: row.link.expiresAt.toISOString() };
  } finally { await database.close(); }
}

/** Caller supplies provider-verified identity only; browser fields carry no identity or role. */
export async function joinGroupInvitation(token: string, identity: AuthenticatedIdentity, raw: unknown, databaseUrl?: string, creatorCheck?: GroupInvitationCreatorCheck) {
  const input = JoinGroupInvitationSchema.parse(raw), preview = await getGroupInvitationPreview(token, databaseUrl, new Date(), creatorCheck);
  if (!preview || preview.tripId !== input.tripId || preview.linkId !== input.linkId || preview.version !== input.version) throw new GroupInvitationUnavailableError();
  // Reuse account onboarding's safe verified-contact claim. Managed profiles and
  // conflicting identities require their existing personal-claim flow, never a name/phone merge.
  const actorPersonId = await findOrClaimPersonForAuthIdentity({ authUserId: identity.authUserId, email: identity.email, displayName: identity.displayName }, databaseUrl);
  if (!actorPersonId) throw new GroupInvitationUnavailableError("Use your personal invitation to claim your existing traveler profile, or ask the organizer for help.");
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [trip] = await tx.select().from(commons).where(eq(commons.id, input.tripId)).for("update");
      const [link] = await tx.select().from(groupInvitations).where(and(eq(groupInvitations.id, input.linkId), eq(groupInvitations.commonsId, input.tripId))).for("update");
      const now = new Date();
      if (!trip || !["planning", "active"].includes(trip.status) || !link || link.revokedAt || link.expiresAt <= now || link.version !== input.version || link.tokenHash !== hashOpaqueToken(token)) throw new GroupInvitationUnavailableError();
      // A reusable link adds new people, so revoked approval stops it too. Same answer as any unavailable link.
      await assertTripMayInvite(tx, trip.id).catch((error: unknown) => { if (error instanceof TripActivationRequiredError) throw new GroupInvitationUnavailableError(); throw error; });
      // Hold creator membership/identity locks through the join. A concurrent
      // removal/demotion cannot pass between this check and granting access.
      if (!await creatorAuthorized(tx, trip.id, link.createdByPersonId, creatorCheck, true)) throw new GroupInvitationUnavailableError();
      const [person] = await tx.select().from(people).where(eq(people.id, actorPersonId));
      if (person?.authUserId !== identity.authUserId) throw new CommandAccessError();
      const [member] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, trip.id), eq(memberships.personId, actorPersonId))).for("update");
      const otherInvitations = identity.email ? await tx.select({ personId: invitations.provisionalPersonId, status: invitations.status }).from(invitations)
        .where(and(eq(invitations.commonsId, trip.id), sql`lower(trim(${invitations.recipientEmail})) = ${identity.email.trim().toLowerCase()}`, inArray(invitations.status, ["pending", "revoked"]))) : [];
      if (otherInvitations.some(invite => invite.personId !== actorPersonId)) throw new GroupInvitationUnavailableError("Your existing invitation uses a different traveler profile. Ask the organizer to resolve it; no profiles were merged.");
      if (member && (member.status === "removed" || member.attendanceState === "declined")) throw new GroupInvitationUnavailableError("Your trip access was withdrawn. Ask an organizer to review it; a group link cannot restore it.");
      if (member?.accessMode === "managed") throw new GroupInvitationUnavailableError("Use your personal invitation to claim this managed traveler profile.");
      if (member?.status === "invited" && member.role === "organizer") throw new GroupInvitationUnavailableError("Use your personal organizer invitation. This group link grants traveler access only.");
      const fingerprint = commandFingerprint(actorPersonId, "membership.group_link_joined", { ...input, tokenHash: link.tokenHash });
      const [receipt] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, trip.id), eq(processedCommands.commandId, input.commandId)));
      if (receipt && (receipt.result as { fingerprint: string }).fingerprint !== fingerprint) throw new CommandConflictError();
      if (member?.status === "active") return receipt ? (receipt.result as { result: { tripId: string; alreadyMember: boolean } }).result : { tripId: trip.id, alreadyMember: true };
      if (receipt) throw new CommandConflictError();
      const pending = await tx.select().from(invitations).where(and(eq(invitations.commonsId, trip.id), eq(invitations.provisionalPersonId, actorPersonId), eq(invitations.status, "pending"))).for("update");
      if (member?.status === "invited" && (!identity.email || !pending.length || pending.some(invite => invite.recipientEmail?.trim().toLowerCase() !== identity.email!.trim().toLowerCase())))
        throw new GroupInvitationUnavailableError("Use your personal invitation, or ask the organizer to resolve your participant profile.");
      if (member) await tx.update(memberships).set({ status: "active", role: "member", attendanceState: "helping", attendanceDates: null, joinedAt: now, updatedAt: now }).where(eq(memberships.id, member.id));
      else await tx.insert(memberships).values({ commonsId: trip.id, personId: actorPersonId, role: "member", status: "active", attendanceState: "helping", joinedAt: now });
      for (const invite of pending) {
        await tx.update(invitations).set({ status: "accepted", acceptedByPersonId: actorPersonId, acceptedAt: now, updatedAt: now }).where(eq(invitations.id, invite.id));
        await tx.update(invitationDeliveryAttempts).set({ status: "cancelled", updatedAt: now }).where(and(eq(invitationDeliveryAttempts.invitationId, invite.id), inArray(invitationDeliveryAttempts.status, ["queued", "processing"])));
      }
      const result = { tripId: trip.id, alreadyMember: false };
      await tx.insert(consentEvents).values({ commonsId: trip.id, personId: actorPersonId, scope: "commons_membership", noticeVersion: "group-invitation-v1", action: "accepted", source: "group_invitation_link" });
      await tx.insert(auditEvents).values({ commonsId: trip.id, commandId: input.commandId, actorId: actorPersonId, actorType: "human", action: "membership.group_link_joined", resourceType: "group_invitation", resourceId: link.id, summary: "Joined as a traveler through an approved group invitation." });
      await tx.insert(processedCommands).values({ commonsId: trip.id, commandId: input.commandId, result: { fingerprint, result } });
      return result;
    });
  } finally { await database.close(); }
}
