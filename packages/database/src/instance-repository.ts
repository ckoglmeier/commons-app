import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, identities, instanceSettings, invitations, messagingWebNudges, people } from "./schema";
import { messagingMessages } from "./messaging-schema";
import { hashNormalizedEmail } from "./tokens";

export type InstanceSignupMode = "invited" | "domains" | "anyone";
export type InstanceSettingsView = { adminPersonId: string | null; signupMode: InstanceSignupMode; allowedDomains: string[] };

export class InstanceAdminRequiredError extends Error {
  constructor() { super("Only the instance admin can change who can join."); this.name = "InstanceAdminRequiredError"; }
}

const DEFAULTS: InstanceSettingsView = { adminPersonId: null, signupMode: "invited", allowedDomains: [] };

async function withDb<T>(databaseUrl: string | undefined, run: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>) {
  const database = createDatabase(databaseUrl);
  try { return await run(database.db); } finally { await database.close(); }
}

export async function readInstanceSettings(databaseUrl?: string): Promise<InstanceSettingsView> {
  return withDb(databaseUrl, async db => {
    const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.id, 1)).limit(1);
    return row ? { adminPersonId: row.adminPersonId, signupMode: row.signupMode, allowedDomains: row.allowedDomains } : DEFAULTS;
  });
}

/** Admins already recorded, per database URL, so the common case costs no query. */
const knownAdmins = new Map<string, string>();

/**
 * The first person to sign in becomes the instance admin. Safe under concurrency: the single settings row is created or filled only while
 * no admin is set, so exactly one person wins. Returns the admin's person id.
 */
export async function claimInstanceAdminIfUnset(personId: string, databaseUrl?: string): Promise<string> {
  const cacheKey = databaseUrl ?? process.env.DATABASE_URL ?? "";
  const known = knownAdmins.get(cacheKey);
  if (known) return known;
  return withDb(databaseUrl, async db => {
    const [row] = await db.insert(instanceSettings).values({ id: 1, adminPersonId: personId })
      .onConflictDoUpdate({ target: instanceSettings.id, set: { adminPersonId: sql`coalesce(${instanceSettings.adminPersonId}, excluded.admin_person_id)`, updatedAt: sql`case when ${instanceSettings.adminPersonId} is null then now() else ${instanceSettings.updatedAt} end` } })
      .returning({ adminPersonId: instanceSettings.adminPersonId });
    const admin = row?.adminPersonId ?? personId;
    knownAdmins.set(cacheKey, admin);
    return admin;
  });
}

/** Test-only: forget cached admins after a test database is reset. */
export function forgetKnownInstanceAdminsForTests() { knownAdmins.clear(); }

export async function isInstanceAdmin(personId: string, databaseUrl?: string) {
  return (await readInstanceSettings(databaseUrl)).adminPersonId === personId;
}

export async function updateInstanceSignup(actorPersonId: string, input: { signupMode: InstanceSignupMode; allowedDomains: string[] }, databaseUrl?: string) {
  return withDb(databaseUrl, async db => {
    const updated = await db.update(instanceSettings)
      .set({ signupMode: input.signupMode, allowedDomains: input.allowedDomains, updatedByPersonId: actorPersonId, updatedAt: new Date() })
      .where(and(eq(instanceSettings.id, 1), eq(instanceSettings.adminPersonId, actorPersonId)))
      .returning({ signupMode: instanceSettings.signupMode, allowedDomains: instanceSettings.allowedDomains, adminPersonId: instanceSettings.adminPersonId });
    if (!updated[0]) throw new InstanceAdminRequiredError();
    return updated[0];
  });
}

/** Whether anyone has signed in yet (no admin recorded). */
export async function instanceHasNoAdmin(databaseUrl?: string) {
  return (await readInstanceSettings(databaseUrl)).adminPersonId === null;
}

/** An account already exists for this email: a person with a sign-in holds it as an email identity. */
export async function emailHasAccount(email: string, databaseUrl?: string) {
  return withDb(databaseUrl, async db => {
    const rows = await db.select({ id: people.id }).from(identities).innerJoin(people, eq(people.id, identities.personId))
      .where(and(eq(identities.kind, "email"), eq(identities.normalizedHash, hashNormalizedEmail(email)), sql`${people.authUserId} is not null`)).limit(1);
    return rows.length > 0;
  });
}

/** A pending, unexpired trip invitation names this email. */
export async function emailHasPendingInvitation(email: string, databaseUrl?: string, now = new Date()) {
  return withDb(databaseUrl, async db => {
    const rows = await db.select({ id: invitations.id }).from(invitations)
      .where(and(eq(invitations.status, "pending"), sql`lower(trim(${invitations.recipientEmail})) = ${email.trim().toLowerCase()}`, or(isNull(invitations.expiresAt), gt(invitations.expiresAt, now)))).limit(1);
    return rows.length > 0;
  });
}

/** The generated invitation key, created once and kept in the database when COMMONS_INVITATION_TOKEN_KEY isn't set. */
export async function storedInvitationTokenKey(databaseUrl?: string): Promise<string> {
  return withDb(databaseUrl, async db => {
    const candidate = randomBytes(32).toString("base64");
    const [row] = await db.insert(instanceSettings).values({ id: 1, invitationTokenKey: candidate })
      .onConflictDoUpdate({ target: instanceSettings.id, set: { invitationTokenKey: sql`coalesce(${instanceSettings.invitationTokenKey}, excluded.invitation_token_key)` } })
      .returning({ key: instanceSettings.invitationTokenKey });
    return row!.key!;
  });
}

// ---- Messages with Commons email notices ----

/**
 * Of these people, the ones to email about new messages now: never emailed, or emailed before they last opened their thread. Claims them
 * (records the notice) in the same statement, so two batches can't both email the same person.
 */
export async function claimMessageNotices(personIds: readonly string[], now: Date, databaseUrl?: string): Promise<string[]> {
  if (!personIds.length) return [];
  return withDb(databaseUrl, async db => {
    const claimed: string[] = [];
    for (const personId of new Set(personIds)) {
      const [row] = await db.insert(messagingWebNudges).values({ personId, lastNudgedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: messagingWebNudges.personId,
          set: { lastNudgedAt: now, updatedAt: now },
          // Not while they're reading (opened in the last 15 minutes), and at most once until they open the thread again.
          setWhere: sql`(${messagingWebNudges.lastReadAt} is null or ${messagingWebNudges.lastReadAt} < ${new Date(now.getTime() - 15 * 60_000).toISOString()}::timestamptz) and (${messagingWebNudges.lastNudgedAt} is null or (${messagingWebNudges.lastReadAt} is not null and ${messagingWebNudges.lastReadAt} >= ${messagingWebNudges.lastNudgedAt}))`,
        })
        .returning({ personId: messagingWebNudges.personId });
      if (row) claimed.push(row.personId);
    }
    return claimed;
  });
}

/** Undo a claim when the email couldn't be sent, so the next batch tries again. */
export async function releaseMessageNotice(personId: string, previous: Date | null, databaseUrl?: string) {
  return withDb(databaseUrl, async db => { await db.update(messagingWebNudges).set({ lastNudgedAt: previous }).where(eq(messagingWebNudges.personId, personId)); });
}

export async function markMessagesRead(personId: string, now: Date, databaseUrl?: string) {
  return withDb(databaseUrl, async db => {
    await db.insert(messagingWebNudges).values({ personId, lastReadAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: messagingWebNudges.personId, set: { lastReadAt: now, updatedAt: now } });
  });
}

export type UnreadWebRecipient = { personId: string; displayName: string; authUserId: string | null; commonsId: string | null; tripName: string | null; timezone: string | null };

/** People with Messages with Commons sent to their thread since `since` that they haven't opened since and haven't been emailed about. */
export async function unreadWebMessageRecipients(since: Date, databaseUrl?: string): Promise<UnreadWebRecipient[]> {
  return withDb(databaseUrl, async db => {
    const rows = await db.selectDistinctOn([messagingMessages.personId, messagingMessages.commonsId], {
      personId: messagingMessages.personId, displayName: people.displayName, authUserId: people.authUserId,
      commonsId: messagingMessages.commonsId, tripName: commons.name, timezone: commons.timezone,
    }).from(messagingMessages)
      .innerJoin(people, eq(people.id, messagingMessages.personId))
      .leftJoin(commons, eq(commons.id, messagingMessages.commonsId))
      .leftJoin(messagingWebNudges, eq(messagingWebNudges.personId, messagingMessages.personId))
      .where(and(
        eq(messagingMessages.provider, "web"), eq(messagingMessages.direction, "outbound"),
        sql`${messagingMessages.status} in ('sent','delivered')`, gt(messagingMessages.sentAt, since),
        sql`(${messagingWebNudges.lastReadAt} is null or ${messagingMessages.sentAt} > ${messagingWebNudges.lastReadAt})`,
        sql`(${messagingWebNudges.lastNudgedAt} is null or ${messagingMessages.sentAt} > ${messagingWebNudges.lastNudgedAt})`,
      ))
      .limit(500);
    return rows.filter((row): row is UnreadWebRecipient => Boolean(row.personId));
  });
}

/** The email a traveler was invited at, for copies without Supabase admin access (local development). */
export async function invitedEmailForPerson(personId: string, databaseUrl?: string) {
  return withDb(databaseUrl, async db => {
    const [row] = await db.select({ email: invitations.recipientEmail }).from(invitations)
      .where(and(or(eq(invitations.acceptedByPersonId, personId), eq(invitations.provisionalPersonId, personId)), sql`${invitations.recipientEmail} is not null`))
      .orderBy(sql`${invitations.acceptedAt} desc nulls last`).limit(1);
    return row?.email?.trim().toLowerCase() ?? null;
  });
}
