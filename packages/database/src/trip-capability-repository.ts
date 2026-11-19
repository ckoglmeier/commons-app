import { and, count, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { commons, eventCreationAccess, identities, memberships, people } from "./schema";
import { hashNormalizedEmail } from "./tokens";

/*
 * Explicit pilot access for the free beta capability boundary (docs/plans/2026-10-26-free-beta-builder-handoff.md).
 * A person has pilot access only through an explicit decision: an operator-approved (or operator-invited and claimed)
 * event-creation grant, or a claimed email an operator listed in configuration. Open public signup never creates
 * either. A beta invite approval is not a pilot grant: its row has grants_pilot_capabilities = false. Feature policy
 * only: membership and organizer checks still run in each command.
 */

export type PilotEmailList = readonly string[];

function emailHashes(emails: PilotEmailList) {
  return [...new Set(emails.map(email => email.trim().toLowerCase()).filter(email => email.includes("@")))].map(hashNormalizedEmail);
}

async function pilotPersonIds(tx: ReturnType<typeof createDatabase>["db"], personIds: string[], emails: PilotEmailList) {
  if (!personIds.length) return new Set<string>();
  const approved = await tx.select({ personId: eventCreationAccess.personId }).from(eventCreationAccess)
    .where(and(inArray(eventCreationAccess.personId, personIds), eq(eventCreationAccess.status, "approved"), eq(eventCreationAccess.grantsPilotCapabilities, true)));
  const hashes = emailHashes(emails);
  const listed = hashes.length ? await tx.select({ personId: identities.personId }).from(identities)
    .innerJoin(people, eq(people.id, identities.personId))
    .where(and(inArray(identities.personId, personIds), eq(identities.kind, "email"), eq(identities.state, "claimed"),
      inArray(identities.normalizedHash, hashes), isNotNull(people.authUserId))) : [];
  return new Set([...approved, ...listed].map(row => row.personId));
}

/** Whether this account has explicit pilot access. */
export async function personHasPilotAccess(personId: string, emails: PilotEmailList, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try { return (await pilotPersonIds(database.db, [personId], emails)).has(personId); }
  finally { await database.close(); }
}

/**
 * The trip keeps pilot capabilities while at least one active organizer has explicit pilot access. Removed, left and
 * invited organizers do not count. Returns null for an unknown trip.
 */
export async function tripPilotAccess(identifier: string, emails: PilotEmailList, databaseUrl?: string): Promise<{ tripId: string; pilot: boolean } | null> {
  const database = createDatabase(databaseUrl);
  try {
    const [trip] = await database.db.select({ id: commons.id, activationDraftId: commons.activationDraftId }).from(commons)
      .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
    if (!trip) return null;
    // A trip created under activation is Trip · Plan · Money, whoever organizes it. Only an operator-listed trip ID differs.
    if (trip.activationDraftId) return { tripId: trip.id, pilot: false };
    const organizers = await database.db.select({ personId: memberships.personId }).from(memberships)
      .where(and(eq(memberships.commonsId, trip.id), eq(memberships.role, "organizer"), eq(memberships.status, "active")));
    const pilots = await pilotPersonIds(database.db, organizers.map(row => row.personId), emails);
    return { tripId: trip.id, pilot: pilots.size > 0 };
  } finally { await database.close(); }
}

/** Trips this person created since `since` (free beta creation cap). */
export async function tripsCreatedSince(personId: string, since: Date, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select({ total: count() }).from(commons).where(and(eq(commons.createdByPersonId, personId), gte(commons.createdAt, since)));
    return Number(row?.total ?? 0);
  } finally { await database.close(); }
}

/** Whether the trip was created under first-invite activation. Trips from before cutover have no marker and return false, as does an unknown trip. */
export async function tripCreatedUnderBeta(identifier: string, databaseUrl?: string): Promise<boolean> {
  const database = createDatabase(databaseUrl);
  try {
    const [trip] = await database.db.select({ activationDraftId: commons.activationDraftId, newExperience: commons.newExperience }).from(commons)
      .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
    return Boolean(trip?.activationDraftId || trip?.newExperience);
  } finally { await database.close(); }
}
