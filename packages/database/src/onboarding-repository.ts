import { claimInstanceAdminIfUnset } from "./instance-repository";
import { randomBytes } from "node:crypto";
import {
    AddCommonsPersonRequestSchema,
    CommitSetupImportRequestSchema,
    CommonsPeopleSchema,
    CommonsSetupSchema,
    CreateCommonsDraftRequestSchema,
    CreateCommonsDraftResultSchema,
    InvitationPreviewSchema,
    SaveSetupTravelersRequestSchema,
    UpdateCommonsInvitationRequestSchema,
    UpdateCommonsPersonRoleRequestSchema,
    type CommonsSetup,
    type CreateCommonsDraftResult,
    type CommonsMembershipSummary,
    type InvitationPreview,
} from "@commons/contracts";
import { and, count, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DELIVERY_LEASE_MS, DELIVERY_MAX_ATTEMPTS, DELIVERY_RETRY_MS, ownsDeliveryLease } from "./delivery-lease";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import {
    auditEvents,
    commons,
    consentEvents,
    identities,
    invitations,
    invitationDeliveryAttempts,
    expenses,
    expenseShares,
    itineraryItems,
    memberships,
    people,
    processedCommands
} from "./schema";
import {
    generateOpaqueToken,
    hashNormalizedEmail,
    hashNormalizedPhone,
    hashOpaqueToken,
    protectOpaqueToken,
    revealOpaqueToken,
    revokedOpaqueTokenHash,
} from "./tokens";

export type AuthenticatedIdentity = {
  authUserId: string;
  email?: string;
  phone?: string;
  displayName?: string;
  /**
   * Whether the account's email proves who this is. The web layer sets it from this copy's sign-in method: true with emailed sign-in
   * links, false on a copy that signs in with a password, where the address is only what the person typed. When false, nothing is
   * matched by email: only an invitation's private link lets someone accept it or claim the invited person. Left out, it counts as true.
   */
  emailProvesIdentity?: boolean;
};

/** The email to match people and invitations by, or undefined when the address proves nothing (password sign-in). */
function provenEmail(identity: AuthenticatedIdentity) {
  return identity.emailProvesIdentity === false ? undefined : identity.email;
}

/** A personal invitation's private link works for 30 days from when the link was made. Replacing the link starts a new 30 days. */
export const PERSONAL_INVITATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function personalInvitationExpiry(now = new Date()) {
  return new Date(now.getTime() + PERSONAL_INVITATION_LIFETIME_MS);
}

/** A pending invitation with no expiry (made before links expired) stays valid until its link is next copied, replaced or re-sent. */
export function personalInvitationExpired(expiresAt: Date | null, now = new Date()) {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

export type DemoUserProvisioningRequest = {
  authUserId: string;
  displayName: string;
  email?: string;
  commonsSlugs: string[];
};

export type ParticipantEmailProvisioningRequest = {
  commonsSlug: string;
  participants: Array<{
    displayName: string;
    email: string;
  }>;
};

export type PendingCommonsInvitationSummary = {
  token: string;
  commons: {
    id: string;
    slug: string;
    name: string;
    startsOn: string | null;
    endsOn: string | null;
    locationName: string | null;
  };
  inviterName: string;
  recipientName: string;
  expiresAt: string | null;
};

export class OnboardingRepositoryError extends Error {
  constructor(
    public readonly code:
      | "invitation_not_found"
      | "invitation_unavailable"
      | "identity_conflict"
      | "invitation_conflict"
      | "removal_blocked"
      | "role_change_blocked",
    message: string,
  ) {
    super(message);
    this.name = "OnboardingRepositoryError";
  }
}

function emailHash(value: string) {
  return hashNormalizedEmail(value);
}

function slugBase(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return normalized || "trip";
}

function setupSummary(row: {
  id: string;
  slug: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  locationName: string | null;
  timezone: string;
  status: "planning" | "active" | "closing" | "archived";
  coverImageUrl: string | null;
  coverCardImageUrl?: string | null;
  setupCompletedAt: Date | null;
  firstSharedAt: Date | null;
}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    locationName: row.locationName,
    timezone: row.timezone,
    status: row.status,
    coverImageUrl: row.coverImageUrl,
    coverCardImageUrl: row.coverCardImageUrl,
    setupCompletedAt: row.setupCompletedAt?.toISOString() ?? null,
    firstSharedAt: row.firstSharedAt?.toISOString() ?? null,
  };
}

async function requireOrganizer(
  transaction: Parameters<
    Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]
  >[0],
  identifier: string,
  actorPersonId: string,
) {
  const [row] = await transaction
    .select({
      id: commons.id,
      slug: commons.slug,
      name: commons.name,
      startsOn: commons.startsOn,
      endsOn: commons.endsOn,
      locationName: commons.locationName,
      timezone: commons.timezone,
      status: commons.status,
      coverImageUrl: commons.coverImageUrl,
      coverCardImageUrl: commons.coverCardImageUrl,
      setupCompletedAt: commons.setupCompletedAt,
      firstSharedAt: commons.firstSharedAt,
      createdByPersonId: commons.createdByPersonId,
      organizerName: people.displayName,
      role: memberships.role,
      membershipStatus: memberships.status,
    })
    .from(commons)
    .innerJoin(
      memberships,
      and(
        eq(memberships.commonsId, commons.id),
        eq(memberships.personId, actorPersonId),
      ),
    )
    .innerJoin(people, eq(people.id, commons.createdByPersonId))
    .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier))
    .for("update", { of: commons })
    .limit(1);
  if (!row || row.role !== "organizer" || row.membershipStatus !== "active") {
    throw new Error("Only an organizer can change trip setup.");
  }
  return row;
}

function localDateTimeToUtc(date: string, time: string, timeZone: string) {
  const intendedUtc = Date.parse(`${date}T${time}:00.000Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  let candidate = intendedUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value]),
    );
    const renderedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate += intendedUtc - renderedAsUtc;
  }
  return new Date(candidate);
}

async function attachEmailIdentity(
  transaction: Parameters<
    Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]
  >[0],
  personId: string,
  email: string | undefined,
) {
  if (!email) return;
  await transaction
    .insert(identities)
    .values({
      personId,
      kind: "email",
      normalizedHash: emailHash(email),
      state: "claimed",
      verifiedAt: new Date(),
    })
    .onConflictDoNothing();
}

async function attachPhoneIdentity(
  transaction: Parameters<
    Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]
  >[0],
  personId: string,
  phone: string | undefined,
) {
  if (!phone) return;
  await transaction
    .insert(identities)
    .values({
      personId,
      kind: "phone",
      normalizedHash: hashNormalizedPhone(phone),
      state: "claimed",
      verifiedAt: new Date(),
    })
    .onConflictDoNothing();
}

async function attachAuthenticatedIdentities(
  transaction: Parameters<
    Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]
  >[0],
  personId: string,
  identity: AuthenticatedIdentity,
) {
  await attachEmailIdentity(transaction, personId, identity.email);
  await attachPhoneIdentity(transaction, personId, identity.phone);
}

export async function findPersonIdForAuthUser(
  authUserId: string,
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    const [person] = await database.db
      .select({ id: people.id })
      .from(people)
      .where(eq(people.authUserId, authUserId))
      .limit(1);
    return person?.id ?? null;
  } finally {
    await database.close();
  }
}

export async function findPersonProfileForAuthUser(
  authUserId: string,
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    const [person] = await database.db
      .select({ id: people.id, displayName: people.displayName })
      .from(people)
      .where(eq(people.authUserId, authUserId))
      .limit(1);
    return person ?? null;
  } finally {
    await database.close();
  }
}

/** The person for a signed-in account, creating or claiming it as needed. The first person resolved this way becomes the instance admin. */
export async function findOrClaimPersonForAuthIdentity(
  identity: AuthenticatedIdentity,
  databaseUrl?: string,
) {
  const personId = await resolvePersonForAuthIdentity(identity, databaseUrl);
  if (personId) await claimInstanceAdminIfUnset(personId, databaseUrl);
  return personId;
}

export type InvitationLinkPersonResult =
  | { status: "claimed"; personId: string }
  /** A managed traveler's invitation: no profile is made for the account; accepting the invitation claims the traveler. */
  | { status: "managed" }
  /** The link can't place this account (not found, not pending, expired, or the person already has an account). */
  | { status: "unavailable" };

/**
 * Password sign-in only (the address proves nothing): a new account that arrived through a personal invitation's private link becomes
 * that invited person, as a confirmed email does with sign-in links. Holding the link is the proof. The invitation itself still has to
 * be accepted. An account that already has a profile keeps it.
 */
export async function findOrClaimPersonForInvitationLink(
  token: string,
  identity: AuthenticatedIdentity,
  databaseUrl?: string,
): Promise<InvitationLinkPersonResult> {
  const existingPersonId = await findPersonIdForAuthUser(identity.authUserId, databaseUrl);
  if (existingPersonId) return { status: "claimed", personId: existingPersonId };
  const database = createDatabase(databaseUrl);
  let result: InvitationLinkPersonResult;
  try {
    result = await database.db.transaction(async (transaction): Promise<InvitationLinkPersonResult> => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('commons.auth_identity'), hashtext(${identity.authUserId}))`);
      const [boundPerson] = await transaction.select({ id: people.id }).from(people).where(eq(people.authUserId, identity.authUserId)).limit(1);
      if (boundPerson) return { status: "claimed", personId: boundPerson.id };
      const [invitation] = await transaction.select().from(invitations)
        .where(eq(invitations.tokenHash, hashOpaqueToken(token))).for("update").limit(1);
      if (!invitation || invitation.status !== "pending" || personalInvitationExpired(invitation.expiresAt)) return { status: "unavailable" };
      const [membership] = await transaction.select({ accessMode: memberships.accessMode, status: memberships.status }).from(memberships)
        .where(and(eq(memberships.commonsId, invitation.commonsId), eq(memberships.personId, invitation.provisionalPersonId))).limit(1);
      if (membership?.accessMode === "managed") return { status: "managed" };
      if (membership?.status !== "invited") return { status: "unavailable" };
      const displayName = identity.displayName?.trim();
      const claimed = await transaction.update(people)
        .set({ authUserId: identity.authUserId, ...(displayName ? { displayName } : {}), updatedAt: new Date() })
        .where(and(eq(people.id, invitation.provisionalPersonId), isNull(people.authUserId)))
        .returning({ id: people.id });
      if (claimed.length !== 1) return { status: "unavailable" };
      await attachAuthenticatedIdentities(transaction, invitation.provisionalPersonId, identity);
      await transaction.insert(auditEvents).values({
        commonsId: invitation.commonsId,
        commandId: `claim-identity-${invitation.provisionalPersonId}-${identity.authUserId}`,
        actorId: invitation.provisionalPersonId,
        actorType: "human",
        action: "identity.claimed",
        resourceType: "person",
        resourceId: invitation.provisionalPersonId,
        summary: "A participant opened their private invitation link and claimed their profile.",
      }).onConflictDoNothing();
      return { status: "claimed", personId: invitation.provisionalPersonId };
    });
  } finally {
    await database.close();
  }
  if (result.status === "claimed") await claimInstanceAdminIfUnset(result.personId, databaseUrl);
  return result;
}

async function resolvePersonForAuthIdentity(
  identity: AuthenticatedIdentity,
  databaseUrl?: string,
) {
  const existingPersonId = await findPersonIdForAuthUser(
    identity.authUserId,
    databaseUrl,
  );
  if (existingPersonId) return existingPersonId;
  // With password sign-in the typed address proves nothing, so it never finds or claims an invited person.
  const matchEmail = provenEmail(identity);
  const identityMatchers = [
    matchEmail
      ? and(eq(identities.kind, "email"), eq(identities.normalizedHash, emailHash(matchEmail)))
      : null,
    identity.phone
      ? and(eq(identities.kind, "phone"), eq(identities.normalizedHash, hashNormalizedPhone(identity.phone)))
      : null,
  ].filter((matcher): matcher is NonNullable<typeof matcher> => Boolean(matcher));

  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      // Serialize first-time account resolution across simultaneous invitations.
      // A verified contact/account remains the identity boundary, never a name.
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('commons.auth_identity'), hashtext(${identity.authUserId}))`);
      const [boundPerson] = await transaction.select({ id: people.id }).from(people).where(eq(people.authUserId, identity.authUserId)).limit(1);
      if (boundPerson) return boundPerson.id;
      if (matchEmail) {
        const pendingManaged = await transaction.select({id: invitations.id}).from(invitations)
          .innerJoin(memberships, and(eq(memberships.commonsId, invitations.commonsId), eq(memberships.personId, invitations.provisionalPersonId)))
          .where(and(eq(invitations.status, "pending"), eq(memberships.accessMode, "managed"), eq(memberships.status, "active"),
            sql`lower(trim(${invitations.recipientEmail})) = ${matchEmail.trim().toLowerCase()}`)).limit(1);
        if (pendingManaged.length) return null;
      }
      const mappedIdentities = identityMatchers.length
        ? await transaction
            .select({
              identityId: identities.id,
              personId: people.id,
              authUserId: people.authUserId,
            })
            .from(identities)
            .innerJoin(people, eq(identities.personId, people.id))
            .where(or(...identityMatchers))
        : [];
      const mappedPersonIds = new Set(mappedIdentities.map((item) => item.personId));
      if (mappedPersonIds.size > 1) {
        throw new OnboardingRepositoryError(
          "identity_conflict",
          "These contact details belong to different Commons accounts.",
        );
      }
      const mappedIdentity = mappedIdentities[0];
      if (!mappedIdentity) {
        const displayName = identity.displayName?.trim();
        if (!displayName) return null;
        const [created] = await transaction
          .insert(people)
          .values({ authUserId: identity.authUserId, displayName })
          .returning({ id: people.id });
        await attachAuthenticatedIdentities(transaction, created.id, identity);
        return created.id;
      }
      if (
        mappedIdentity.authUserId &&
        mappedIdentity.authUserId !== identity.authUserId
      ) {
        throw new OnboardingRepositoryError(
          "identity_conflict",
          "This email is already connected to another account.",
        );
      }

      if (!mappedIdentity.authUserId) {
        const claimed = await transaction
          .update(people)
          .set({ authUserId: identity.authUserId, updatedAt: new Date() })
          .where(
            and(
              eq(people.id, mappedIdentity.personId),
              isNull(people.authUserId),
            ),
          )
          .returning({ id: people.id });
        if (claimed.length !== 1) {
          throw new OnboardingRepositoryError(
            "identity_conflict",
            "This participant profile was claimed by another account.",
          );
        }
      }

      await transaction
        .update(identities)
        .set({ state: "claimed", verifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(identities.id, mappedIdentity.identityId));

      if (identity.displayName?.trim()) {
        await transaction
          .update(people)
          .set({ displayName: identity.displayName.trim(), updatedAt: new Date() })
          .where(eq(people.id, mappedIdentity.personId));
      }
      await attachAuthenticatedIdentities(transaction, mappedIdentity.personId, identity);

      const participantMemberships = await transaction
        .select({ commonsId: memberships.commonsId })
        .from(memberships)
        .where(
          and(
            eq(memberships.personId, mappedIdentity.personId),
            inArray(memberships.status, ["active", "invited"]),
          ),
        );
      for (const membership of participantMemberships) {
        await transaction
          .insert(auditEvents)
          .values({
            commonsId: membership.commonsId,
            commandId: `claim-identity-${mappedIdentity.personId}-${identity.authUserId}`,
            actorId: mappedIdentity.personId,
            actorType: "human",
            action: "identity.claimed",
            resourceType: "person",
            resourceId: mappedIdentity.personId,
            summary: "A participant verified a contact method and claimed their profile.",
          })
          .onConflictDoNothing();
      }
      return mappedIdentity.personId;
    });
  } finally {
    await database.close();
  }
}

export async function provisionParticipantEmails(
  request: ParticipantEmailProvisioningRequest,
  databaseUrl?: string,
) {
  const commonsSlug = request.commonsSlug.trim();
  const entries = request.participants.map((participant) => ({
    displayName: participant.displayName.trim(),
    email: participant.email.trim().toLowerCase(),
  }));
  if (!commonsSlug) throw new Error("A Commons slug is required.");
  if (!entries.length) throw new Error("At least one participant email is required.");
  if (entries.some((entry) => !entry.displayName || !/^\S+@\S+\.\S+$/.test(entry.email))) {
    throw new Error("Every participant needs a display name and valid email.");
  }
  if (new Set(entries.map((entry) => entry.email)).size !== entries.length) {
    throw new Error("Each participant email must be unique.");
  }

  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const [trip] = await transaction
        .select({ id: commons.id, name: commons.name })
        .from(commons)
        .where(eq(commons.slug, commonsSlug))
        .limit(1);
      if (!trip) throw new Error(`Commons not found: ${commonsSlug}`);

      const participantRows = await transaction
        .select({
          personId: people.id,
          displayName: people.displayName,
        })
        .from(memberships)
        .innerJoin(people, eq(memberships.personId, people.id))
        .where(
          and(
            eq(memberships.commonsId, trip.id),
            inArray(memberships.status, ["active", "invited"]),
          ),
        );
      const participantsByName = new Map(
        participantRows.map((participant) => [
          participant.displayName.toLowerCase(),
          participant,
        ]),
      );

      for (const entry of entries) {
        const participant = participantsByName.get(entry.displayName.toLowerCase());
        if (!participant) {
          throw new Error(`${entry.displayName} is not a participant in ${trip.name}.`);
        }
        const normalizedHash = emailHash(entry.email);
        const [existingIdentity] = await transaction
          .select({ personId: identities.personId })
          .from(identities)
          .where(
            and(
              eq(identities.kind, "email"),
              eq(identities.normalizedHash, normalizedHash),
            ),
          )
          .limit(1);
        if (existingIdentity?.personId !== undefined) {
          if (existingIdentity.personId !== participant.personId) {
            throw new OnboardingRepositoryError(
              "identity_conflict",
              `${entry.displayName}’s email is already mapped to another profile.`,
            );
          }
          continue;
        }
        await transaction.insert(identities).values({
          personId: participant.personId,
          kind: "email",
          normalizedHash,
          state: "observed",
        });
      }

      return {
        commonsSlug,
        commonsName: trip.name,
        participantNames: entries.map((entry) => entry.displayName),
      };
    });
  } finally {
    await database.close();
  }
}

export async function listCommonsMembershipsForPerson(
  personId: string,
  databaseUrl?: string,
): Promise<CommonsMembershipSummary[]> {
  const database = createDatabase(databaseUrl);
  try {
    const membershipRows = await database.db
      .select({
        id: commons.id,
        slug: commons.slug,
        name: commons.name,
        startsOn: commons.startsOn,
        endsOn: commons.endsOn,
        locationName: commons.locationName,
        coverImageUrl: commons.coverImageUrl,
        coverCardImageUrl: commons.coverCardImageUrl,
        timezone: commons.timezone,
        status: commons.status,
        setupCompletedAt: commons.setupCompletedAt,
        firstSharedAt: commons.firstSharedAt,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(commons, eq(memberships.commonsId, commons.id))
      .where(
        and(
          eq(memberships.personId, personId),
          eq(memberships.status, "active"),
        ),
      )
      .orderBy(desc(commons.startsOn));

    if (!membershipRows.length) return [];

    const participantRows = await database.db
      .select({
        commonsId: memberships.commonsId,
        participantCount: count(memberships.id),
      })
      .from(memberships)
      .where(
        and(
          inArray(
            memberships.commonsId,
            membershipRows.map((row) => row.id),
          ),
          inArray(memberships.status, ["active", "invited"]),
        ),
      )
      .groupBy(memberships.commonsId);
    const participantCounts = new Map(
      participantRows.map((row) => [row.commonsId, row.participantCount]),
    );

    return membershipRows.map((row) => ({
      commons: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        locationName: row.locationName,
        timezone: row.timezone,
        status: row.status,
        coverImageUrl: row.coverImageUrl,
        coverCardImageUrl: row.coverCardImageUrl,
        setupCompletedAt: row.setupCompletedAt?.toISOString() ?? null,
        firstSharedAt: row.firstSharedAt?.toISOString() ?? null,
      },
      role: row.role,
      participantCount: participantCounts.get(row.id) ?? 0,
    }));
  } finally {
    await database.close();
  }
}

export async function listPendingCommonsInvitationsForIdentity(
  identity: AuthenticatedIdentity,
  databaseUrl?: string,
): Promise<PendingCommonsInvitationSummary[]> {
  // With password sign-in an address match proves nothing; the invitation's private link is the only way in.
  const email = provenEmail(identity);
  if (!email) return [];
  const database = createDatabase(databaseUrl);
  try {
    const rows = await database.db
      .select({
        protectedToken: invitations.tokenValue,
        commonsId: commons.id,
        commonsSlug: commons.slug,
        commonsName: commons.name,
        startsOn: commons.startsOn,
        endsOn: commons.endsOn,
        locationName: commons.locationName,
        createdByPersonId: invitations.createdByPersonId,
        recipientName: invitations.recipientName,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(commons, eq(invitations.commonsId, commons.id))
      .where(and(
        eq(invitations.status, "pending"),
        sql`${invitations.tokenValue} is not null`,
        sql`lower(trim(${invitations.recipientEmail})) = ${email.trim().toLowerCase()}`,
        or(isNull(invitations.expiresAt), gt(invitations.expiresAt, new Date())),
      ))
      .orderBy(desc(invitations.createdAt));

    if (!rows.length) return [];
    const inviterRows = await database.db
      .select({ id: people.id, displayName: people.displayName })
      .from(people)
      .where(inArray(people.id, [...new Set(rows.map((row) => row.createdByPersonId))]));
    const inviters = new Map(inviterRows.map((row) => [row.id, row.displayName]));

    return rows.flatMap((row) => row.protectedToken ? [{
      token: revealOpaqueToken(row.protectedToken),
      commons: {
        id: row.commonsId,
        slug: row.commonsSlug,
        name: row.commonsName,
        startsOn: row.startsOn,
        endsOn: row.endsOn,
        locationName: row.locationName,
      },
      inviterName: inviters.get(row.createdByPersonId) ?? "An organizer",
      recipientName: row.recipientName,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    }] : []);
  } finally {
    await database.close();
  }
}

export async function provisionDemoUser(
  request: DemoUserProvisioningRequest,
  databaseUrl?: string,
) {
  const displayName = request.displayName.trim();
  const requestedSlugs = [...new Set(request.commonsSlugs.map((slug) => slug.trim()))]
    .filter(Boolean);
  if (!displayName) throw new Error("A display name is required.");
  if (!requestedSlugs.length) throw new Error("At least one Commons slug is required.");

  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const [existingPerson] = await transaction
        .select({ id: people.id })
        .from(people)
        .where(eq(people.authUserId, request.authUserId))
        .limit(1);
      const personId = existingPerson?.id
        ? existingPerson.id
        : (
            await transaction
              .insert(people)
              .values({
                authUserId: request.authUserId,
                displayName,
              })
              .returning({ id: people.id })
          )[0].id;

      if (existingPerson) {
        await transaction
          .update(people)
          .set({ displayName, updatedAt: new Date() })
          .where(eq(people.id, personId));
      }
      await attachEmailIdentity(transaction, personId, request.email);

      const tripRows = await transaction
        .select({ id: commons.id, slug: commons.slug, name: commons.name })
        .from(commons)
        .where(inArray(commons.slug, requestedSlugs));
      const foundSlugs = new Set(tripRows.map((trip) => trip.slug));
      const missingSlugs = requestedSlugs.filter((slug) => !foundSlugs.has(slug));
      if (missingSlugs.length) {
        throw new Error(`Commons not found: ${missingSlugs.join(", ")}`);
      }

      for (const trip of tripRows) {
        await transaction
          .insert(memberships)
          .values({
            commonsId: trip.id,
            personId,
            role: "member",
            status: "active",
            joinedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [memberships.commonsId, memberships.personId],
            set: {
              status: "active",
              joinedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        await transaction
          .insert(auditEvents)
          .values({
            commonsId: trip.id,
            commandId: `demo-provision-${personId}`,
            actorId: personId,
            actorType: "human",
            action: "member.provisioned",
            resourceType: "membership",
            resourceId: personId,
            summary: `${displayName} was provisioned for the demo.`,
          })
          .onConflictDoNothing();
      }

      return {
        personId,
        displayName,
        memberships: tripRows.map((trip) => ({ slug: trip.slug, name: trip.name })),
      };
    });
  } finally {
    await database.close();
  }
}

export type SetupRepositoryOptions = {
  databaseUrl?: string;
  actorPersonId: string;
  /** People Add/Invite actions commit delivery with the traveler; setup draft editors leave this false. */
  queueDelivery?: boolean;
};

export async function createCommonsDraft(
  input: unknown,
  identity: AuthenticatedIdentity,
  databaseUrl?: string,
): Promise<CreateCommonsDraftResult> {
  const request = CreateCommonsDraftRequestSchema.parse(input);
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const [existingPerson] = await transaction
        .select({ id: people.id })
        .from(people)
        .where(eq(people.authUserId, identity.authUserId))
        .limit(1);
      const organizerId = existingPerson?.id
        ? existingPerson.id
        : (
            await transaction
              .insert(people)
              .values({
                authUserId: identity.authUserId,
                displayName: request.organizerDisplayName,
              })
              .returning({ id: people.id })
          )[0].id;

      if (existingPerson) {
        await transaction
          .update(people)
          .set({ displayName: request.organizerDisplayName, updatedAt: new Date() })
          .where(eq(people.id, organizerId));
      }
      await attachEmailIdentity(transaction, organizerId, identity.email);

      const slug = `${slugBase(request.name)}-${randomBytes(3).toString("hex")}`;
      const [createdCommons] = await transaction
        .insert(commons)
        .values({
          slug,
          name: request.name,
          startsOn: request.startsOn,
          endsOn: request.endsOn,
          locationName: request.locationName,
          timezone: request.timezone,
          status: "planning",
          createdByPersonId: organizerId,
        })
        .returning({ id: commons.id });

      await transaction.insert(memberships).values({
        commonsId: createdCommons.id,
        personId: organizerId,
        role: "organizer",
        status: "active",
        joinedAt: new Date(),
      });
      await transaction.insert(consentEvents).values({
        commonsId: createdCommons.id,
        personId: organizerId,
        scope: "commons_membership",
        noticeVersion: "pilot-v1",
        action: "accepted",
        source: "created_commons",
      });
      await transaction.insert(auditEvents).values({
        commonsId: createdCommons.id,
        commandId: `create-draft-${createdCommons.id}`,
        actorId: organizerId,
        actorType: "human",
        action: "commons.draft_created",
        resourceType: "commons",
        resourceId: createdCommons.id,
        summary: `${request.organizerDisplayName} created a private draft for ${request.name}.`,
      });

      return CreateCommonsDraftResultSchema.parse({
        commonsId: createdCommons.id,
        slug,
      });
    });
  } finally {
    await database.close();
  }
}

export async function getCommonsSetup(
  slug: string,
  options: SetupRepositoryOptions,
): Promise<CommonsSetup | null> {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
      const travelerRows = await transaction
        .select({
          invitationId: invitations.id,
          displayName: invitations.recipientName,
          email: invitations.recipientEmail,
          invitationStatus: invitations.status,
          deliveryState: invitations.deliveryState,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.commonsId, context.id),
            inArray(invitations.status, ["pending", "accepted"]),
          ),
        )
        .orderBy(desc(invitations.createdAt));
      const [planCount] = await transaction
        .select({ value: count(itineraryItems.id) })
        .from(itineraryItems)
        .where(eq(itineraryItems.commonsId, context.id));

      return CommonsSetupSchema.parse({
        commons: setupSummary(context),
        organizerName: context.organizerName,
        travelers: travelerRows
          .filter((row) => Boolean(row.email))
          .map((row) => ({
            invitationId: row.invitationId,
            displayName: row.displayName,
            email: row.email,
            invitationStatus: row.invitationStatus,
            deliveryState: row.deliveryState,
          })),
        importedPlanCount: planCount?.value ?? 0,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Only an organizer can change trip setup.") {
      return null;
    }
    throw error;
  } finally {
    await database.close();
  }
}

export async function getCommonsPeople(
  slug: string,
  options: SetupRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
      const memberRows = await transaction
        .select({
          membershipId: memberships.id,
          personId: memberships.personId,
          displayName: people.displayName,
          role: memberships.role,
          membershipStatus: memberships.status,
          joinedAt: memberships.joinedAt,
          accessMode: memberships.accessMode,
          managedByPersonIds: memberships.managedByPersonIds,
          canClaimAccess: memberships.canClaimAccess,
        })
        .from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId))
        .where(
          and(
            eq(memberships.commonsId, context.id),
            inArray(memberships.status, ["active", "invited"]),
          ),
        )
        .orderBy(desc(memberships.role), people.displayName);

      const invitationRows = await transaction
        .select({
          id: invitations.id,
          personId: invitations.provisionalPersonId,
          recipientName: invitations.recipientName,
          email: invitations.recipientEmail,
          status: invitations.status,
          deliveryState: invitations.deliveryState,
          deliveryErrorCode: invitations.deliveryErrorCode,
          message: invitations.message,
          sentAt: invitations.sentAt,
          lastAttemptAt: invitations.lastAttemptAt,
          expiresAt: invitations.expiresAt,
          createdAt: invitations.createdAt,
        })
        .from(invitations)
        .where(eq(invitations.commonsId, context.id))
        .orderBy(desc(invitations.createdAt));
      const latestInvitationByPerson = new Map<string, typeof invitationRows[number]>();
      for (const invitation of invitationRows) {
        if (!latestInvitationByPerson.has(invitation.personId)) {
          latestInvitationByPerson.set(invitation.personId, invitation);
        }
      }

      const moneyRows = await transaction
        .select({ personId: expenseShares.personId, value: count(expenseShares.id) })
        .from(expenseShares)
        .innerJoin(expenses, eq(expenses.id, expenseShares.expenseId))
        .where(eq(expenses.commonsId, context.id))
        .groupBy(expenseShares.personId);
      const paidRows = await transaction
        .select({ personId: expenses.paidByPersonId, value: count(expenses.id) })
        .from(expenses)
        .where(eq(expenses.commonsId, context.id))
        .groupBy(expenses.paidByPersonId);
      const moneyByPerson = new Map<string, number>();
      for (const row of [...moneyRows, ...paidRows]) {
        moneyByPerson.set(row.personId, (moneyByPerson.get(row.personId) ?? 0) + row.value);
      }

      return CommonsPeopleSchema.parse({
        commons: setupSummary(context),
        organizerName: context.organizerName,
        currentPersonId: options.actorPersonId,
        people: memberRows.map((member) => {
          const invitation = latestInvitationByPerson.get(member.personId);
          const moneyItems = moneyByPerson.get(member.personId) ?? 0;
          return {
            ...member,
            displayName: member.membershipStatus === "invited" && invitation
              ? invitation.recipientName
              : member.displayName,
            joinedAt: member.joinedAt?.toISOString() ?? null,
            accessMode: member.accessMode === "managed" ? "managed" : "account",
            managedByPersonIds: member.managedByPersonIds ?? null,
            canClaimAccess: member.canClaimAccess,
            email: invitation?.email ?? null,
            invitation: invitation
              ? {
                  id: invitation.id,
                  // A pending invitation whose private link has run out reads as expired until the organizer replaces the link.
                  status: invitation.status === "pending" && personalInvitationExpired(invitation.expiresAt) ? "expired" : invitation.status,
                  deliveryState: invitation.deliveryState,
                  deliveryErrorCode: invitation.deliveryErrorCode,
                  message: invitation.message,
                  sentAt: invitation.sentAt?.toISOString() ?? null,
                  lastAttemptAt: invitation.lastAttemptAt?.toISOString() ?? null,
                  expiresAt: invitation.expiresAt?.toISOString() ?? null,
                }
              : null,
            removal: {
              blocked: member.membershipStatus === "active",
              moneyItems,
              responsibilityItems: 0,
            },
          };
        }),
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Only an organizer can change trip setup.") {
      return null;
    }
    throw error;
  } finally {
    await database.close();
  }
}

export async function updateCommonsMemberRole(
  slug: string,
  personId: string,
  input: unknown,
  options: SetupRepositoryOptions,
) {
  const request = UpdateCommonsPersonRoleRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${context.id}))`);
      const [target] = await transaction
        .select({
          membershipId: memberships.id,
          role: memberships.role,
          status: memberships.status,
          accessMode: memberships.accessMode,
          displayName: people.displayName,
        })
        .from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId))
        .where(and(
          eq(memberships.commonsId, context.id),
          eq(memberships.personId, personId),
        ))
        .for("update")
        .limit(1);

      if (!target || !["active", "invited"].includes(target.status) || target.accessMode === "managed") {
        throw new OnboardingRepositoryError(
          "role_change_blocked",
          "Only an account traveler with active access or a pending invitation can be made an organizer.",
        );
      }
      if (target.status === "invited") {
        const [pendingInvite] = await transaction.select({ id: invitations.id }).from(invitations).where(and(
          eq(invitations.commonsId, context.id), eq(invitations.provisionalPersonId, personId), eq(invitations.status, "pending"),
          or(isNull(invitations.expiresAt), gt(invitations.expiresAt, new Date())),
        )).limit(1);
        if (!pendingInvite) throw new OnboardingRepositoryError("role_change_blocked", "That invitation is no longer active.");
      }
      if (target.role === request.role) return { personId, role: target.role };

      if (request.role === "member") {
        if (personId === options.actorPersonId) {
          throw new OnboardingRepositoryError(
            "role_change_blocked",
            "Ask another organizer to remove your organizer access.",
          );
        }
        const [organizerCount] = await transaction
          .select({ value: count(memberships.id) })
          .from(memberships)
          .where(and(
            eq(memberships.commonsId, context.id),
            eq(memberships.role, "organizer"),
            eq(memberships.status, "active"),
          ));
        if (target.status === "active" && target.role === "organizer" && (organizerCount?.value ?? 0) <= 1) {
          throw new OnboardingRepositoryError(
            "role_change_blocked",
            "Every trip needs at least one organizer.",
          );
        }
      }

      const [actor] = await transaction
        .select({ displayName: people.displayName })
        .from(people)
        .where(eq(people.id, options.actorPersonId))
        .limit(1);
      await transaction
        .update(memberships)
        .set({ role: request.role, updatedAt: new Date() })
        .where(eq(memberships.id, target.membershipId));
      await transaction.insert(auditEvents).values({
        commonsId: context.id,
        commandId: `membership-role-${target.membershipId}-${request.role}-${randomBytes(8).toString("hex")}`,
        actorId: options.actorPersonId,
        actorType: "human",
        action: request.role === "organizer" ? "membership.organizer_granted" : "membership.organizer_removed",
        resourceType: "membership",
        resourceId: target.membershipId,
        summary: request.role === "organizer"
          ? `${actor?.displayName ?? "An organizer"} made ${target.displayName} an organizer.`
          : `${actor?.displayName ?? "An organizer"} removed organizer access for ${target.displayName}.`,
      });
      return { personId, role: request.role };
    });
  } finally {
    await database.close();
  }
}

async function ensureInvitationEmailAvailable(
  transaction: Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0],
  commonsId: string,
  email: string,
  currentPersonId?: string,
) {
  const normalizedHash = emailHash(email);
  const [identity] = await transaction
    .select({ personId: identities.personId })
    .from(identities)
    .where(and(eq(identities.kind, "email"), eq(identities.normalizedHash, normalizedHash)))
    .limit(1);
  if (!identity || identity.personId === currentPersonId) return identity?.personId ?? null;
  const [existingMembership] = await transaction
    .select({ status: memberships.status })
    .from(memberships)
    .where(
      and(
        eq(memberships.commonsId, commonsId),
        eq(memberships.personId, identity.personId),
        inArray(memberships.status, ["active", "invited"]),
      ),
    )
    .limit(1);
  if (existingMembership) {
    throw new OnboardingRepositoryError(
      "invitation_conflict",
      "That email already belongs to someone on this trip.",
    );
  }
  return identity.personId;
}

async function addAccountInvitationInTransaction(
  transaction: Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0],
  slug: string, request: ReturnType<typeof AddCommonsPersonRequestSchema.parse>, options: SetupRepositoryOptions,
) {
  const displayName = request.displayName.trim();
  const email = request.email?.trim().toLowerCase();
  if (!email) throw new Error("Email is required for an account traveler.");
  const context = await requireOrganizer(transaction, slug, options.actorPersonId);
  const knownPersonId = await ensureInvitationEmailAvailable(transaction, context.id, email);
  if (knownPersonId === options.actorPersonId) {
    throw new OnboardingRepositoryError(
      "invitation_conflict",
      "You are already the organizer of this trip.",
    );
  }
  const personId = knownPersonId ?? (
    await transaction.insert(people).values({ displayName }).returning({ id: people.id })
  )[0].id;
  if (!knownPersonId) {
    await transaction.insert(identities).values({
      personId,
      kind: "email",
      normalizedHash: emailHash(email),
      state: "observed",
    });
  }
  await transaction.insert(memberships).values({
    commonsId: context.id,
    personId,
    role: request.role,
    status: "invited",
  }).onConflictDoUpdate({
    target: [memberships.commonsId, memberships.personId],
    set: { status: "invited", role: request.role, joinedAt: null, updatedAt: new Date() },
  });
  const token = generateOpaqueToken();
  const [invitation] = await transaction.insert(invitations).values({
    commonsId: context.id,
    provisionalPersonId: personId,
    createdByPersonId: options.actorPersonId,
    recipientName: displayName,
    recipientEmail: email,
    message: request.message,
    tokenHash: hashOpaqueToken(token),
    tokenValue: protectOpaqueToken(token),
    tokenVersion: 1,
    expiresAt: personalInvitationExpiry(),
  }).returning({ id: invitations.id });
  await transaction.insert(auditEvents).values({
    commonsId: context.id,
    commandId: `invite-person-${invitation.id}`,
    actorId: options.actorPersonId,
    actorType: "human",
    action: "invitation.created",
    resourceType: "invitation",
    resourceId: invitation.id,
    summary: `${context.organizerName} invited ${displayName}.`,
  });
  return invitation.id;
}


export async function addCommonsPerson(
  slug: string,
  input: unknown,
  options: SetupRepositoryOptions,
): Promise<{ personId?: string; invitationId?: string; deliveryAttemptId?: string | null }> {
  const request = AddCommonsPersonRequestSchema.parse(input);
  const displayName = request.displayName.trim();
  const email = request.email?.trim().toLowerCase() ?? null;
  const database = createDatabase(options.databaseUrl);
  try {
    if (request.accessMode === "managed") {
      const personId = await database.db.transaction(async (transaction) => {
        const context = await requireOrganizer(transaction, slug, options.actorPersonId);
        const [person] = await transaction.insert(people).values({ displayName }).returning({ id: people.id });
        await transaction.insert(memberships).values({
          commonsId: context.id,
          personId: person.id,
          role: "member",
          status: "active",
          joinedAt: new Date(),
          accessMode: "managed",
          managedByPersonIds: [options.actorPersonId],
          canClaimAccess: request.canClaimAccess,
        });
        await transaction.insert(auditEvents).values({
          commonsId: context.id,
          commandId: `add-managed-person-${person.id}`,
          actorId: options.actorPersonId,
          actorType: "human",
          action: "participant.managed_added",
          resourceType: "person",
          resourceId: person.id,
          summary: `${context.organizerName} added ${displayName} as a managed traveler.`,
        });
        return person.id;
      });
      return { personId };
    }
    if (!email) throw new Error("Email is required for an account traveler.");
    return await database.db.transaction(async transaction => {
      const invitationId = await addAccountInvitationInTransaction(transaction, slug, request, options);
      const [delivery] = options.queueDelivery && request.role === "member" ? await queueInvitationDeliveriesInTransaction(transaction, slug, invitationId, options) : [];
      return { invitationId, deliveryAttemptId: delivery?.deliveryAttemptId ?? null };
    });
  } finally {
    await database.close();
  }
}

async function requireSingleTripManagedClaim(
  transaction: Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0],
  personId: string, commonsId: string,
) {
  const links = await transaction.select({commonsId: memberships.commonsId}).from(memberships)
    .where(and(eq(memberships.personId, personId), inArray(memberships.status, ["active", "invited"])));
  if (links.some(link => link.commonsId !== commonsId)) {
    throw new OnboardingRepositoryError("identity_conflict", "This managed profile is used by more than one trip. It cannot be claimed from a single trip yet.");
  }
}

/** Offer account access for the existing traveler; People queues delivery in this same transaction. */
export async function inviteManagedTraveler(slug: string, personId: string, input: unknown, options: SetupRepositoryOptions) {
  const request = UpdateCommonsInvitationRequestSchema.parse(input);
  const email = request.email.trim().toLowerCase();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
          const [person] = await transaction.select().from(people).where(eq(people.id, personId)).for("update").limit(1);
      const [member] = await transaction.select().from(memberships).where(and(
        eq(memberships.commonsId, context.id), eq(memberships.personId, personId),
      )).for("update").limit(1);
      if (!person || person.authUserId || member?.accessMode !== "managed" || member.status !== "active") {
        throw new OnboardingRepositoryError("invitation_unavailable", "Only an active traveler without an account can be invited this way.");
      }
      await requireSingleTripManagedClaim(transaction, personId, context.id);
      const knownPersonId = await ensureInvitationEmailAvailable(transaction, context.id, email, personId);
      if (knownPersonId && knownPersonId !== personId) {
        throw new OnboardingRepositoryError("identity_conflict", "That email already has a different Commons profile. This traveler has not been changed. Account profiles cannot be combined yet.");
      }
      // Prevent two people being offered the same verified identity. Do not add an
      // observed identity: sign-in must not grant access before explicit acceptance.
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
      const pending = await transaction.select().from(invitations).where(and(
        eq(invitations.status, "pending"),
        or(eq(invitations.provisionalPersonId, personId), sql`lower(trim(${invitations.recipientEmail})) = ${email}`),
      ));
      const same = pending.find(row => row.provisionalPersonId === personId && row.commonsId === context.id);
      if (same && same.recipientEmail === email) {
        const [delivery] = options.queueDelivery && ["not_sent", "failed"].includes(same.deliveryState) ? await queueInvitationDeliveriesInTransaction(transaction, slug, same.id, options) : [];
        return { invitationId: same.id, deliveryAttemptId: delivery?.deliveryAttemptId ?? null };
      }
      if (pending.length) throw new OnboardingRepositoryError("invitation_conflict", "An invitation is already pending for this traveler or email. Edit or revoke it first.");
      const token = generateOpaqueToken();
      const [invitation] = await transaction.insert(invitations).values({
        commonsId: context.id, provisionalPersonId: personId, createdByPersonId: options.actorPersonId,
        recipientName: person.displayName, recipientEmail: email, message: request.message,
        tokenHash: hashOpaqueToken(token), tokenValue: protectOpaqueToken(token), tokenVersion: 1, expiresAt: personalInvitationExpiry(),
      }).returning({id: invitations.id});
      await transaction.update(memberships).set({canClaimAccess: true, updatedAt: new Date()}).where(eq(memberships.id, member.id));
      await transaction.insert(auditEvents).values({commonsId: context.id, commandId: `invite-managed-${invitation.id}`,
        actorId: options.actorPersonId, actorType: "human", action: "invitation.created", resourceType: "invitation", resourceId: invitation.id,
        summary: `${context.organizerName} prepared an invitation for ${person.displayName} to manage their own profile.`});
      const [delivery] = options.queueDelivery ? await queueInvitationDeliveriesInTransaction(transaction, slug, invitation.id, options) : [];
      return {invitationId: invitation.id, deliveryAttemptId: delivery?.deliveryAttemptId ?? null};
    });
  } finally { await database.close(); }
}

export async function updateCommonsPendingInvitation(
  slug: string,
  invitationId: string,
  input: unknown,
  options: SetupRepositoryOptions,
) {
  const request = UpdateCommonsInvitationRequestSchema.parse(input);
  const displayName = request.displayName.trim();
  const email = request.email.trim().toLowerCase();
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
          const [invitation] = await transaction.select().from(invitations).where(
        and(eq(invitations.id, invitationId), eq(invitations.commonsId, context.id)),
      ).for("update").limit(1);
      if (!invitation || invitation.status !== "pending") {
        throw new OnboardingRepositoryError(
          "invitation_unavailable",
          "Only a pending invitation can be edited.",
        );
      }
      const [membership] = await transaction.select().from(memberships).where(and(
        eq(memberships.commonsId, context.id), eq(memberships.personId, invitation.provisionalPersonId),
      )).limit(1);
      const managed = membership?.accessMode === "managed";
      const emailChanged = invitation.recipientEmail?.toLowerCase() !== email;
      if (emailChanged) {
        if (managed) {
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
          const duplicate = await transaction.select({id: invitations.id}).from(invitations).where(and(
            eq(invitations.status, "pending"), sql`${invitations.id} <> ${invitation.id}`,
            sql`lower(trim(${invitations.recipientEmail})) = ${email}`)).limit(1);
          if (duplicate.length) throw new OnboardingRepositoryError("invitation_conflict", "An invitation is already pending for this email.");
        }
        const mappedPersonId = await ensureInvitationEmailAvailable(
          transaction, context.id, email, invitation.provisionalPersonId,
        );
        const [person] = await transaction.select({ authUserId: people.authUserId })
          .from(people).where(eq(people.id, invitation.provisionalPersonId)).for("update").limit(1);
        const links = await transaction.select({ id: memberships.id }).from(memberships)
          .where(eq(memberships.personId, invitation.provisionalPersonId));
        const knownIdentities = await transaction.select().from(identities)
          .where(eq(identities.personId, invitation.provisionalPersonId));
        // Correct only an unclaimed, event-local contact. Account linking and
        // changes to a person used by other events require identity proof.
        if (person?.authUserId || links.length !== 1
          || (mappedPersonId && mappedPersonId !== invitation.provisionalPersonId)
          || knownIdentities.some((row) => row.state !== "observed")) {
          throw new OnboardingRepositoryError("identity_conflict",
            "Contact not changed. This person is linked to another account or trip. Revoke this invitation to invite someone else.");
        }
        if (invitation.recipientEmail) {
          await transaction.delete(identities).where(and(
            eq(identities.personId, invitation.provisionalPersonId),
            eq(identities.kind, "email"),
            eq(identities.normalizedHash, emailHash(invitation.recipientEmail)),
            eq(identities.state, "observed"),
          ));
        }
        if (!managed) await transaction.insert(identities).values({
          personId: invitation.provisionalPersonId, kind: "email",
          normalizedHash: emailHash(email), state: "observed",
        }).onConflictDoNothing();
      }
      const tokenMissing = !invitation.tokenValue;
      const tokenRotated = emailChanged || tokenMissing;
      const token = emailChanged
        ? generateOpaqueToken()
        : invitation.tokenValue
          ? revealOpaqueToken(invitation.tokenValue)
          : generateOpaqueToken();
      await transaction.update(invitations).set({
        recipientName: displayName,
        recipientEmail: email,
        message: request.message,
        tokenHash: hashOpaqueToken(token),
        tokenValue: protectOpaqueToken(token),
        tokenVersion: tokenRotated ? invitation.tokenVersion + 1 : invitation.tokenVersion,
        // A new link gets a fresh 30 days. Editing without a new link keeps the link's expiry.
        expiresAt: tokenRotated ? personalInvitationExpiry() : invitation.expiresAt,
        deliveryState: tokenRotated ? "not_sent" : invitation.deliveryState,
        deliveryErrorCode: null,
        queuedAt: tokenRotated ? null : invitation.queuedAt,
        sentAt: tokenRotated ? null : invitation.sentAt,
        updatedAt: new Date(),
      }).where(eq(invitations.id, invitation.id));
      if (tokenRotated) {
        await transaction.update(invitationDeliveryAttempts).set({ status: "cancelled", updatedAt: new Date() }).where(and(
          eq(invitationDeliveryAttempts.invitationId, invitation.id),
          inArray(invitationDeliveryAttempts.status, ["queued", "processing"]),
        ));
      }
    });
  } finally {
    await database.close();
  }
}

export async function revokeCommonsInvitation(
  slug: string,
  invitationId: string,
  options: SetupRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
      const [invitation] = await transaction.select().from(invitations).where(
        and(eq(invitations.id, invitationId), eq(invitations.commonsId, context.id)),
      ).for("update").limit(1);
      if (!invitation || !["pending", "expired"].includes(invitation.status)) {
        throw new OnboardingRepositoryError("invitation_unavailable", "That invitation is no longer pending.");
      }
      await transaction.update(invitations).set({
        status: "revoked",
        tokenHash: revokedOpaqueTokenHash(),
        tokenValue: null,
        tokenVersion: invitation.tokenVersion + 1,
        deliveryState: "not_sent",
        deliveryErrorCode: null,
        updatedAt: new Date(),
      }).where(eq(invitations.id, invitation.id));
      await transaction.update(memberships).set({ status: "removed", updatedAt: new Date() }).where(and(
        eq(memberships.commonsId, context.id),
        eq(memberships.personId, invitation.provisionalPersonId),
        eq(memberships.status, "invited"),
      ));
      await transaction.update(invitationDeliveryAttempts).set({ status: "cancelled", updatedAt: new Date() }).where(and(
        eq(invitationDeliveryAttempts.invitationId, invitation.id),
        inArray(invitationDeliveryAttempts.status, ["queued", "processing"]),
      ));
    });
  } finally {
    await database.close();
  }
}

export async function rotateCommonsInvitationLink(
  slug: string,
  invitationId: string,
  options: SetupRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
          const [invitation] = await transaction.select().from(invitations).where(
        and(eq(invitations.id, invitationId), eq(invitations.commonsId, context.id)),
      ).for("update").limit(1);
      if (!invitation || !["pending", "expired"].includes(invitation.status)) {
        throw new OnboardingRepositoryError("invitation_unavailable", "That invitation is no longer pending.");
      }
      const token = generateOpaqueToken();
      const expiresAt = personalInvitationExpiry();
      await transaction.update(invitations).set({
        status: "pending",
        tokenHash: hashOpaqueToken(token),
        tokenValue: protectOpaqueToken(token),
        tokenVersion: invitation.tokenVersion + 1,
        expiresAt,
        deliveryState: "not_sent",
        queuedAt: null,
        sentAt: null,
        deliveryErrorCode: null,
        updatedAt: new Date(),
      }).where(eq(invitations.id, invitation.id));
      await transaction.update(invitationDeliveryAttempts).set({ status: "cancelled", updatedAt: new Date() }).where(and(
        eq(invitationDeliveryAttempts.invitationId, invitation.id),
        inArray(invitationDeliveryAttempts.status, ["queued", "processing"]),
      ));
      return { invitationId: invitation.id, token, expiresAt: expiresAt.toISOString() };
    });
  } finally {
    await database.close();
  }
}

export async function getCommonsInvitationLink(
  slug: string,
  invitationId: string,
  options: SetupRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
          const [invitation] = await transaction.select().from(invitations).where(
        and(eq(invitations.id, invitationId), eq(invitations.commonsId, context.id)),
      ).for("update").limit(1);
      if (!invitation || invitation.status !== "pending") {
        throw new OnboardingRepositoryError("invitation_unavailable", "That invitation is no longer pending.");
      }
      if (personalInvitationExpired(invitation.expiresAt)) {
        throw new OnboardingRepositoryError("invitation_unavailable", "This private link has expired. Replace the link and send the new one.");
      }
      if (invitation.tokenValue) {
        // An invitation from before links expired gets its 30 days the first time its link is copied.
        const expiresAt = invitation.expiresAt ?? personalInvitationExpiry();
        if (!invitation.expiresAt) {
          await transaction.update(invitations).set({ expiresAt, updatedAt: new Date() }).where(eq(invitations.id, invitation.id));
        }
        return { invitationId: invitation.id, token: revealOpaqueToken(invitation.tokenValue), expiresAt: expiresAt.toISOString() };
      }
      const token = generateOpaqueToken();
      const expiresAt = personalInvitationExpiry();
      await transaction.update(invitations).set({
        tokenHash: hashOpaqueToken(token),
        tokenValue: protectOpaqueToken(token),
        tokenVersion: invitation.tokenVersion + 1,
        expiresAt,
        deliveryState: "not_sent",
        sentAt: null,
        updatedAt: new Date(),
      }).where(eq(invitations.id, invitation.id));
      return { invitationId: invitation.id, token, expiresAt: expiresAt.toISOString() };
    });
  } finally {
    await database.close();
  }
}

export async function blockCommonsMemberRemoval(
  slug: string,
  personId: string,
  options: SetupRepositoryOptions,
): Promise<never> {
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
      const [member] = await transaction.select({ role: memberships.role, status: memberships.status }).from(memberships).where(and(
        eq(memberships.commonsId, context.id),
        eq(memberships.personId, personId),
      )).limit(1);
      if (!member || member.status !== "active" || member.role === "organizer") {
        throw new OnboardingRepositoryError("invitation_unavailable", "That traveler cannot be removed.");
      }
      throw new OnboardingRepositoryError(
        "removal_blocked",
        "Removal is blocked until their money and trip responsibilities can be reassigned safely.",
      );
    });
    throw new OnboardingRepositoryError("removal_blocked", "Removal is not available yet.");
  } finally {
    await database.close();
  }
}

export async function saveCommonsSetupTravelers(
  slug: string,
  input: unknown,
  options: SetupRepositoryOptions,
) {
  const request = SaveSetupTravelersRequestSchema.parse(input);
  const normalized = request.travelers.map((traveler) => ({
    displayName: traveler.displayName.trim(),
    email: traveler.email.trim().toLowerCase(),
  }));
  if (new Set(normalized.map((traveler) => traveler.email)).size !== normalized.length) {
    throw new Error("Each traveler needs a different email.");
  }

  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
          const existing = await transaction
        .select({
          invitationId: invitations.id,
          personId: invitations.provisionalPersonId,
          recipientEmail: invitations.recipientEmail,
          tokenValue: invitations.tokenValue,
          tokenVersion: invitations.tokenVersion,
        })
        .from(invitations)
        .where(
          and(
            eq(invitations.commonsId, context.id),
            eq(invitations.status, "pending"),
          ),
        );
      const requestedEmails = new Set(normalized.map((traveler) => traveler.email));
      const removed = existing.filter((row) => !row.recipientEmail || !requestedEmails.has(row.recipientEmail.trim().toLowerCase()));
      if (removed.length) {
        for (const invitation of removed) {
          await transaction
            .update(invitations)
            .set({
              status: "revoked",
              tokenHash: revokedOpaqueTokenHash(),
              tokenValue: null,
              tokenVersion: invitation.tokenVersion + 1,
              updatedAt: new Date(),
            })
            .where(eq(invitations.id, invitation.invitationId));
        }
        await transaction
          .update(memberships)
          .set({ status: "removed", updatedAt: new Date() })
          .where(
            and(
              eq(memberships.commonsId, context.id),
              inArray(memberships.personId, removed.map((row) => row.personId)),
              eq(memberships.status, "invited"),
            ),
          );
        await transaction.update(invitationDeliveryAttempts).set({
          status: "cancelled",
          updatedAt: new Date(),
        }).where(and(
          inArray(invitationDeliveryAttempts.invitationId, removed.map((row) => row.invitationId)),
          inArray(invitationDeliveryAttempts.status, ["queued", "processing"]),
        ));
      }

      const existingByEmail = new Map(existing.flatMap((invitation) => {
        const email = invitation.recipientEmail?.trim().toLowerCase();
        return email && requestedEmails.has(email) ? [[email, invitation] as const] : [];
      }));
      for (const traveler of normalized) {
        const current = existingByEmail.get(traveler.email);
        if (current) {
          const missingToken = !current.tokenValue;
          const token = missingToken ? generateOpaqueToken() : null;
          await transaction.update(invitations).set({
            recipientName: traveler.displayName,
            ...(token ? {
              tokenHash: hashOpaqueToken(token),
              tokenValue: protectOpaqueToken(token),
              tokenVersion: current.tokenVersion + 1,
              deliveryState: "not_sent",
              queuedAt: null,
              sentAt: null,
              // A new link gets a fresh 30 days; resaving without one keeps the link's expiry.
              expiresAt: personalInvitationExpiry(),
            } : {}),
            updatedAt: new Date(),
          }).where(eq(invitations.id, current.invitationId));
          continue;
        }
        const normalizedHash = emailHash(traveler.email);
        const [existingIdentity] = await transaction
          .select({ personId: identities.personId })
          .from(identities)
          .where(
            and(
              eq(identities.kind, "email"),
              eq(identities.normalizedHash, normalizedHash),
            ),
          )
          .limit(1);
        if (existingIdentity?.personId === options.actorPersonId) {
          throw new Error("You are already the organizer of this Commons.");
        }
        const personId = existingIdentity?.personId ?? (
          await transaction
            .insert(people)
            .values({ displayName: traveler.displayName })
            .returning({ id: people.id })
        )[0].id;
        if (!existingIdentity) {
          await transaction.insert(identities).values({
            personId,
            kind: "email",
            normalizedHash,
            state: "observed",
          });
        }
        const [joined] = await transaction.select({ status: memberships.status }).from(memberships)
          .where(and(eq(memberships.commonsId, context.id), eq(memberships.personId, personId))).limit(1);
        if (joined?.status === "active") continue;
        await transaction
          .insert(memberships)
          .values({
            commonsId: context.id,
            personId,
            role: "member",
            status: "invited",
          })
          .onConflictDoUpdate({
            target: [memberships.commonsId, memberships.personId],
            set: { status: "invited", updatedAt: new Date() },
          });
        const token = generateOpaqueToken();
        await transaction.insert(invitations).values({
          commonsId: context.id,
          provisionalPersonId: personId,
          createdByPersonId: options.actorPersonId,
          recipientName: traveler.displayName,
          recipientEmail: traveler.email,
          tokenHash: hashOpaqueToken(token),
          tokenValue: protectOpaqueToken(token),
          expiresAt: personalInvitationExpiry(),
        });
      }
      await transaction.insert(auditEvents).values({
        commonsId: context.id,
        commandId: `setup-travelers-${randomBytes(8).toString("hex")}`,
        actorId: options.actorPersonId,
        actorType: "human",
        action: "commons.travelers_updated",
        resourceType: "commons",
        resourceId: context.id,
        summary: `${context.organizerName} added ${normalized.length} ${normalized.length === 1 ? "traveler" : "travelers"} to the private draft.`,
      });
    });
  } finally {
    await database.close();
  }
}

export async function commitCommonsSetupImport(
  slug: string,
  input: unknown,
  options: SetupRepositoryOptions,
) {
  const request = CommitSetupImportRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
      const [processed] = await transaction
        .select({ result: processedCommands.result })
        .from(processedCommands)
        .where(
          and(
            eq(processedCommands.commonsId, context.id),
            eq(processedCommands.commandId, request.commandId),
          ),
        )
        .limit(1);
      if (processed) return processed.result;

      for (const item of request.items) {
        await transaction.insert(itineraryItems).values({
          commonsId: context.id,
          title: item.title,
          startsAt: localDateTimeToUtc(item.date, item.time, context.timezone),
          timezone: context.timezone,
          locationName: item.location ?? null,
          audience: item.participantScope === "optional" ? "individual" : item.participantScope,
          status: "planned",
          provenanceLabel: item.sourceLabel,
        });
      }
      const result = { importedPlanCount: request.items.length };
      await transaction.insert(processedCommands).values({
        commonsId: context.id,
        commandId: request.commandId,
        result,
      });
      await transaction.insert(auditEvents).values({
        commonsId: context.id,
        commandId: `audit-${request.commandId}`,
        actorId: options.actorPersonId,
        actorType: "human",
        action: "itinerary.imported",
        resourceType: "commons",
        resourceId: context.id,
        summary: `${context.organizerName} reviewed and imported ${request.items.length} plans.`,
      });
      return result;
    });
  } finally {
    await database.close();
  }
}

export type PreparedSetupInvitation = {
  invitationId: string;
  recipientName: string;
  recipientEmail: string;
  token: string;
  inviterName: string;
  tripName: string;
  startsOn: string | null;
  endsOn: string | null;
  locationName: string | null;
  message: string | null;
};

export type QueuedInvitationDelivery = PreparedSetupInvitation & {
  deliveryAttemptId: string;
  tokenVersion: number;
};

async function queueInvitationDeliveriesInTransaction(
  transaction: Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0],
  slug: string, invitationId: string | null, options: SetupRepositoryOptions,
): Promise<QueuedInvitationDelivery[]> {
  const context = await requireOrganizer(transaction, slug, options.actorPersonId);
  // Sending invitations is saying the trip is on. Trips on the older experience have no stage to change.
  await transaction.update(commons).set({ goingAt: new Date() }).where(and(eq(commons.id, context.id), eq(commons.newExperience, true), isNull(commons.goingAt)));
  const conditions = [
    eq(invitations.commonsId, context.id),
    eq(invitations.status, "pending"),
  ];
  if (invitationId) conditions.push(eq(invitations.id, invitationId));
  else conditions.push(inArray(invitations.deliveryState, ["not_sent", "failed"]));
  const pending = await transaction
    .select()
    .from(invitations)
    .where(and(...conditions))
    .for("update");
  if (invitationId && pending.length !== 1) {
    throw new OnboardingRepositoryError(
      "invitation_unavailable",
      "That invitation is no longer pending.",
    );
  }

  const queued: QueuedInvitationDelivery[] = [];
  for (const invitation of pending) {
    if (!invitation.recipientEmail) continue;
    // Never send a link that no longer works. The organizer replaces it first.
    if (personalInvitationExpired(invitation.expiresAt)) {
      if (invitationId) throw new OnboardingRepositoryError("invitation_unavailable", "This private link has expired. Replace the link and send the new one.");
      continue;
    }
    let token = invitation.tokenValue ? revealOpaqueToken(invitation.tokenValue) : null;
    let tokenVersion = invitation.tokenVersion;
    if (!token) {
      token = generateOpaqueToken();
      tokenVersion += 1;
      await transaction.update(invitations).set({
        tokenHash: hashOpaqueToken(token),
        tokenValue: protectOpaqueToken(token),
        tokenVersion,
        expiresAt: personalInvitationExpiry(),
      }).where(eq(invitations.id, invitation.id));
    } else if (!invitation.expiresAt) {
      // An invitation from before links expired gets its 30 days the first time it is sent again.
      await transaction.update(invitations).set({ expiresAt: personalInvitationExpiry() }).where(eq(invitations.id, invitation.id));
    }
    await transaction.update(invitationDeliveryAttempts).set({
      status: "cancelled",
      updatedAt: new Date(),
    }).where(and(
      eq(invitationDeliveryAttempts.invitationId, invitation.id),
      inArray(invitationDeliveryAttempts.status, ["queued", "processing"]),
    ));
    const [attempt] = await transaction.insert(invitationDeliveryAttempts).values({
      commonsId: context.id,
      invitationId: invitation.id,
      tokenVersion,
      status: "queued",
    }).returning({ id: invitationDeliveryAttempts.id });
    await transaction.update(invitations).set({
      deliveryState: "queued",
      queuedAt: new Date(),
      deliveryErrorCode: null,
      updatedAt: new Date(),
    }).where(eq(invitations.id, invitation.id));
    queued.push({
      deliveryAttemptId: attempt.id,
      invitationId: invitation.id,
      recipientName: invitation.recipientName,
      recipientEmail: invitation.recipientEmail,
      token,
      tokenVersion,
      inviterName: context.organizerName,
      tripName: context.name,
      startsOn: context.startsOn,
      endsOn: context.endsOn,
      locationName: context.locationName,
      message: invitation.message,
    });
  }
  await transaction.update(commons).set({ setupCompletedAt: new Date(), updatedAt: new Date() }).where(eq(commons.id, context.id));
  return queued;
}


export async function queueCommonsInvitationDeliveries(
  slug: string,
  invitationId: string | null,
  options: SetupRepositoryOptions,
): Promise<QueuedInvitationDelivery[]> {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(transaction => queueInvitationDeliveriesInTransaction(transaction, slug, invitationId, options));
  } finally {
    await database.close();
  }
}

export async function leaseInvitationDeliveryAttempt(
  deliveryAttemptId: string | null,
  databaseUrl?: string,
): Promise<(QueuedInvitationDelivery & { leaseAttempt: number; authenticationEntry: string | null; returnPollPublicId: string | null }) | null> {
  const database = createDatabase(databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const now = new Date();
      while (true) {
        const candidates = await transaction
          .select({
            commonsId: invitationDeliveryAttempts.commonsId,
            attemptId: invitationDeliveryAttempts.id,
            attempts: invitationDeliveryAttempts.attempts,
            authenticationEntry: invitationDeliveryAttempts.authenticationEntry,
            returnPollPublicId: invitationDeliveryAttempts.returnPollPublicId,
            expiresAt: invitations.expiresAt,
            attemptTokenVersion: invitationDeliveryAttempts.tokenVersion,
            invitationId: invitations.id,
            invitationTokenVersion: invitations.tokenVersion,
            token: invitations.tokenValue,
            recipientName: invitations.recipientName,
            recipientEmail: invitations.recipientEmail,
            message: invitations.message,
            invitationStatus: invitations.status,
            inviterName: people.displayName,
            tripName: commons.name,
            startsOn: commons.startsOn,
            endsOn: commons.endsOn,
            locationName: commons.locationName,
          })
          .from(invitationDeliveryAttempts)
          .innerJoin(invitations, eq(invitations.id, invitationDeliveryAttempts.invitationId))
          .innerJoin(commons, eq(commons.id, invitationDeliveryAttempts.commonsId))
          .innerJoin(people, eq(people.id, invitations.createdByPersonId))
          .where(and(
            deliveryAttemptId ? eq(invitationDeliveryAttempts.id, deliveryAttemptId) : lte(invitationDeliveryAttempts.availableAt, now),
            or(
              and(eq(invitationDeliveryAttempts.status, "processing"), lte(invitationDeliveryAttempts.leaseExpiresAt, now)),
              eq(invitationDeliveryAttempts.status, "queued"),
              and(
                eq(invitationDeliveryAttempts.status, "failed"),
                inArray(invitationDeliveryAttempts.errorCode, ["provider_unavailable", "delivery_interrupted", "delivery_failed"]),
              ),
            ),
          ))
          .orderBy(invitationDeliveryAttempts.availableAt)
          .for("update", { of: invitationDeliveryAttempts, skipLocked: true })
          .limit(1);
        const candidate = candidates[0];
        if (!candidate) return null;
        if (
          candidate.attempts >= DELIVERY_MAX_ATTEMPTS ||
          !["pending", "accepted"].includes(candidate.invitationStatus) ||
          (candidate.invitationStatus === "pending" && personalInvitationExpired(candidate.expiresAt, now)) ||
          candidate.attemptTokenVersion !== candidate.invitationTokenVersion ||
          !candidate.token ||
          !candidate.recipientEmail
        ) {
          await transaction.update(invitationDeliveryAttempts).set({ status: "cancelled", leaseExpiresAt: null, errorCode: candidate.attempts >= DELIVERY_MAX_ATTEMPTS ? "attempts_exhausted" : "invitation_unavailable", updatedAt: now }).where(eq(invitationDeliveryAttempts.id, candidate.attemptId));
          if (deliveryAttemptId) return null;
          continue;
        }
        const leaseExpiresAt = new Date(now.getTime() + DELIVERY_LEASE_MS);
        await transaction.update(invitationDeliveryAttempts).set({
          status: "processing",
          attempts: sql`${invitationDeliveryAttempts.attempts} + 1`,
          leaseExpiresAt,
          errorCode: null,
          updatedAt: now,
        }).where(eq(invitationDeliveryAttempts.id, candidate.attemptId));
        return {
          deliveryAttemptId: candidate.attemptId,
          leaseAttempt: candidate.attempts + 1,
          authenticationEntry: candidate.authenticationEntry,
          returnPollPublicId: candidate.returnPollPublicId,
          invitationId: candidate.invitationId,
          recipientName: candidate.recipientName,
          recipientEmail: candidate.recipientEmail,
          token: revealOpaqueToken(candidate.token),
          tokenVersion: candidate.invitationTokenVersion,
          inviterName: candidate.inviterName,
          tripName: candidate.tripName,
          startsOn: candidate.startsOn,
          endsOn: candidate.endsOn,
          locationName: candidate.locationName,
          message: candidate.message,
        };
      }
    });
  } finally {
    await database.close();
  }
}

export async function completeInvitationDeliveryAttempt(
  deliveryAttemptId: string,
  delivery: { leaseAttempt: number; sent: boolean; errorCode?: string; providerMessageId?: string },
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    const [location] = await database.db.select({ commonsId: invitationDeliveryAttempts.commonsId })
      .from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.id, deliveryAttemptId)).limit(1);
    if (!location) return false;
    return await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons)
        .where(eq(commons.id, location.commonsId)).for("update");
      const [attempt] = await transaction.select({
        invitationId: invitationDeliveryAttempts.invitationId,
        status: invitationDeliveryAttempts.status,
        attempts: invitationDeliveryAttempts.attempts,
        leaseExpiresAt: invitationDeliveryAttempts.leaseExpiresAt,
        commonsId: invitationDeliveryAttempts.commonsId,
        tokenVersion: invitationDeliveryAttempts.tokenVersion,
      }).from(invitationDeliveryAttempts).where(eq(invitationDeliveryAttempts.id, deliveryAttemptId)).for("update").limit(1);
      const now = new Date();
      if (!attempt || !ownsDeliveryLease(attempt, delivery.leaseAttempt, now)) return false;
      await transaction.update(invitationDeliveryAttempts).set({
        status: delivery.sent ? "sent" : "failed",
        errorCode: delivery.sent ? null : delivery.errorCode ?? "delivery_failed",
        providerMessageId: delivery.providerMessageId ?? null,
        leaseExpiresAt: null,
        availableAt: delivery.sent ? now : new Date(now.getTime() + DELIVERY_RETRY_MS),
        updatedAt: now,
      }).where(eq(invitationDeliveryAttempts.id, deliveryAttemptId));
      await transaction.update(invitations).set({
        deliveryState: delivery.sent ? "sent" : "failed",
        sentAt: delivery.sent ? now : null,
        lastAttemptAt: now,
        deliveryErrorCode: delivery.sent ? null : delivery.errorCode ?? "delivery_failed",
        updatedAt: now,
      }).where(and(
        eq(invitations.id, attempt.invitationId),
        eq(invitations.tokenVersion, attempt.tokenVersion),
      ));
      if (delivery.sent) {
        await transaction.update(commons).set({ firstSharedAt: now, updatedAt: now }).where(and(
          eq(commons.id, attempt.commonsId),
          isNull(commons.firstSharedAt),
        ));
      }
      return true;
    });
  } finally {
    await database.close();
  }
}

export async function revalidateInvitationDeliveryAttempt(deliveryAttemptId: string, leaseAttempt: number, databaseUrl?: string) {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select({ attempt: invitationDeliveryAttempts, invitation: invitations })
      .from(invitationDeliveryAttempts).innerJoin(invitations, eq(invitations.id, invitationDeliveryAttempts.invitationId))
      .where(eq(invitationDeliveryAttempts.id, deliveryAttemptId)).limit(1);
    const now = new Date();
    return Boolean(row && ownsDeliveryLease(row.attempt, leaseAttempt, now)
      && ["pending", "accepted"].includes(row.invitation.status)
      && !(row.invitation.status === "pending" && personalInvitationExpired(row.invitation.expiresAt, now))
      && row.invitation.tokenVersion === row.attempt.tokenVersion && row.invitation.recipientEmail);
  } finally { await database.close(); }
}

export async function completeCommonsSetupWithoutSharing(
  slug: string,
  options: SetupRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async (transaction) => {
      const context = await requireOrganizer(transaction, slug, options.actorPersonId);
      await transaction
        .update(commons)
        .set({ setupCompletedAt: new Date(), updatedAt: new Date() })
        .where(eq(commons.id, context.id));
    });
  } finally {
    await database.close();
  }
}

export async function getCommonsInvitationPreview(
  token: string,
  databaseUrl?: string,
): Promise<InvitationPreview | null> {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db
      .select({
        commonsId: commons.id,
        commonsSlug: commons.slug,
        commonsName: commons.name,
        startsOn: commons.startsOn,
        endsOn: commons.endsOn,
        locationName: commons.locationName,
        coverImageUrl: commons.coverImageUrl,
        coverCardImageUrl: commons.coverCardImageUrl,
        coverOriginalStoragePath: commons.coverOriginalStoragePath,
        createdByPersonId: invitations.createdByPersonId,
        recipientName: invitations.recipientName,
        provisionalPersonId: invitations.provisionalPersonId,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(commons, eq(invitations.commonsId, commons.id))
      .where(eq(invitations.tokenHash, hashOpaqueToken(token)))
      .limit(1);
    if (!row) return null;
    const [inviter] = await database.db
      .select({ displayName: people.displayName })
      .from(people)
      .where(eq(people.id, row.createdByPersonId))
      .limit(1);
    if (!inviter) return null;
    const [member] = await database.db.select({accessMode: memberships.accessMode}).from(memberships)
      .where(and(eq(memberships.commonsId, row.commonsId), eq(memberships.personId, row.provisionalPersonId))).limit(1);
    const legacyPublicCover = row.coverImageUrl?.startsWith("/moments/") ? row.coverImageUrl : null;
    return InvitationPreviewSchema.parse({
      ...row,
      coverImageUrl: row.coverOriginalStoragePath ? `/api/v1/invitations/${encodeURIComponent(token)}/cover` : legacyPublicCover,
      inviterName: inviter.displayName,
      managedTraveler: member?.accessMode === "managed",
      // An expired private link shows the same page as a cancelled one.
      status: row.status === "pending" && personalInvitationExpired(row.expiresAt) ? "expired" : row.status,
      expiresAt: row.expiresAt?.toISOString() ?? null,
    });
  } finally {
    await database.close();
  }
}

export async function claimCommonsInvitation(
  token: string,
  identity: AuthenticatedIdentity,
  databaseUrl?: string,
) {
  const database = createDatabase(databaseUrl);
  try {
    const [location] = await database.db.select({ commonsId: invitations.commonsId }).from(invitations)
      .where(eq(invitations.tokenHash, hashOpaqueToken(token))).limit(1);
    if (!location) throw new OnboardingRepositoryError("invitation_not_found", "That invitation could not be found.");
    return await database.db.transaction(async (transaction) => {
      await transaction.select({ id: commons.id }).from(commons).where(eq(commons.id, location.commonsId)).for("update");
      const [invitation] = await transaction
        .select()
        .from(invitations)
        .where(eq(invitations.tokenHash, hashOpaqueToken(token)))
        .for("update")
        .limit(1);
      if (!invitation) {
        throw new OnboardingRepositoryError(
          "invitation_not_found",
          "That invitation could not be found.",
        );
      }

      const [trip] = await transaction
        .select({ slug: commons.slug })
        .from(commons)
        .where(eq(commons.id, invitation.commonsId))
        .limit(1);
      if (invitation.status === "accepted") {
        const [acceptedPerson] = await transaction
          .select({ authUserId: people.authUserId })
          .from(people)
          .where(eq(people.id, invitation.acceptedByPersonId!))
          .limit(1);
        const [activeMember] = await transaction.select({ id: memberships.id }).from(memberships).where(and(
          eq(memberships.commonsId, invitation.commonsId), eq(memberships.personId, invitation.acceptedByPersonId!),
          eq(memberships.status, "active"), inArray(memberships.attendanceState, ["helping", "attending"]),
        )).limit(1);
        if (acceptedPerson?.authUserId === identity.authUserId && activeMember) return trip.slug;
        throw new OnboardingRepositoryError(
          "invitation_unavailable",
          "This invitation has already been accepted.",
        );
      }
      if (invitation.status !== "pending" || personalInvitationExpired(invitation.expiresAt)) {
        throw new OnboardingRepositoryError(
          "invitation_unavailable",
          "This invitation is no longer active.",
        );
      }
      // With password sign-in the typed address proves nothing: holding this private link is what lets someone accept it.
      const emailProvesIdentity = identity.emailProvesIdentity !== false;
      const [existingPerson] = await transaction
        .select({ id: people.id })
        .from(people)
        .where(eq(people.authUserId, identity.authUserId))
        .limit(1);
      const [invitedMembership] = await transaction.select().from(memberships)
        .where(and(eq(memberships.commonsId, invitation.commonsId), eq(memberships.personId, invitation.provisionalPersonId)))
        .for("update").limit(1);
      const managedClaim = invitedMembership?.accessMode === "managed";
      if (managedClaim && (invitedMembership.status !== "active" || !invitedMembership.canClaimAccess)) {
        throw new OnboardingRepositoryError("invitation_unavailable", "This traveler is no longer available to claim.");
      }
      if (emailProvesIdentity && (managedClaim || invitedMembership?.role === "organizer") && (!identity.email || identity.email.trim().toLowerCase() !== invitation.recipientEmail?.trim().toLowerCase())) {
        throw new OnboardingRepositoryError("identity_conflict", "Sign in with the invited email to accept this invitation.");
      }
      if (existingPerson && existingPerson.id !== invitation.provisionalPersonId) {
        throw new OnboardingRepositoryError("identity_conflict",
          "Invitation not claimed. Your account already has a different participant profile. Ask the organizer to resolve the duplicate.");
      }
      const claimedPersonId = invitation.provisionalPersonId;
      if (managedClaim) {
        await requireSingleTripManagedClaim(transaction, claimedPersonId, invitation.commonsId);
        const claimEmail = provenEmail(identity);
        const emailPerson = claimEmail ? await ensureInvitationEmailAvailable(transaction, invitation.commonsId, claimEmail, claimedPersonId) : null;
        if (emailPerson && emailPerson !== claimedPersonId) throw new OnboardingRepositoryError("identity_conflict", "This email is connected to a different participant profile. No trip records have changed.");
      }

      if (!existingPerson) {
        // A password account reaches its invitation without being matched by email first, so the name it chose arrives here.
        const chosenName = !emailProvesIdentity && !managedClaim ? identity.displayName?.trim() : undefined;
        const updated = await transaction
          .update(people)
          .set({ authUserId: identity.authUserId, ...(chosenName ? { displayName: chosenName } : {}), updatedAt: new Date() })
          .where(
            and(
              eq(people.id, invitation.provisionalPersonId),
              isNull(people.authUserId),
            ),
          )
          .returning({ id: people.id });
        if (updated.length !== 1) {
          throw new OnboardingRepositoryError(
            "identity_conflict",
            "This invitation is already connected to another account.",
          );
        }
      }
      await transaction.update(memberships)
        .set({ status: "active", accessMode: "account", managedByPersonIds: null, canClaimAccess: false,
          ...(managedClaim ? {} : {attendanceState: "helping" as const, attendanceDates: null, joinedAt: new Date()}), updatedAt: new Date() })
        .where(and(eq(memberships.commonsId, invitation.commonsId), eq(memberships.personId, claimedPersonId)));
      await attachEmailIdentity(transaction, claimedPersonId, identity.email);
      await transaction
        .update(invitations)
        .set({
          status: "accepted",
          acceptedByPersonId: claimedPersonId,
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(invitations.id, invitation.id));
      await transaction.insert(consentEvents).values({
        commonsId: invitation.commonsId,
        personId: claimedPersonId,
        scope: "commons_membership",
        noticeVersion: "pilot-v1",
        action: "accepted",
        source: "invitation_link",
      });
      await transaction.insert(auditEvents).values({
        commonsId: invitation.commonsId,
        commandId: `claim-invitation-${invitation.id}-${identity.authUserId}`,
        actorId: claimedPersonId,
        actorType: "human",
        action: "membership.claimed",
        resourceType: "membership",
        resourceId: claimedPersonId,
        summary: `${invitation.recipientName} joined the Commons.`,
      });
      return trip.slug;
    });
  } finally {
    await database.close();
  }
}
