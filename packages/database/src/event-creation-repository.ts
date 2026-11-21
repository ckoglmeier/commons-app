import { randomBytes, randomUUID } from "node:crypto";
import {
    CommitEventCreationDraftRequestSchema,
    CommitEventCreationDraftResultSchema,
    CreateEventCreationDraftRequestSchema,
    EventBriefSchema,
    EventCreationDraftSchema,
    RecentReusableEventsSchema,
    UpdateEventCreationDraftPeopleRequestSchema,
    UpdateEventCreationDraftRequestSchema,
    type CommitEventCreationDraftResult,
    type EventCreationDraft,
    type RecentReusableEvent,
} from "@commons/contracts";
import { interpretEventDescription, interpretEventTitle, newPlanTemplate, planTemplateFor } from "@commons/domain";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { createDatabase } from "./client";
import {
    auditEvents,
    commons,
    consentEvents,
    eventCreationDraftPeople,
    eventCreationDrafts,
    identities,
    invitations,
    memberships,
    people,
    tripTasks,
} from "./schema";
import { hashNormalizedEmail, mintRecoverableOpaqueToken } from "./tokens";
import { personalInvitationExpiry } from "./onboarding-repository";

export class EventCreationRepositoryError extends Error {
  constructor(
    public readonly code:
      | "draft_not_found"
      | "draft_conflict"
      | "source_not_available"
      | "creation_not_supported"
      | "identity_conflict",
    message: string,
  ) {
    super(message);
    this.name = "EventCreationRepositoryError";
  }
}

export type EventCreationRepositoryOptions = {
  databaseUrl?: string;
  actorPersonId: string;
  /** Set only by the server: new trips get the two-stage experience. */
  newExperience?: boolean;
  /** Validated by the server's entry-context resolver. Never private brief text. */
  entryContext?: { template?: string; destination?: string; source?: string };
};

function sourceDeleteAfter() {
  const value = new Date();
  value.setDate(value.getDate() + 30);
  return value;
}

function slugBase(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "event";
}

type Transaction = Parameters<Parameters<ReturnType<typeof createDatabase>["db"]["transaction"]>[0]>[0];

async function readDraft(transaction: Transaction, draftId: string, actorPersonId: string): Promise<EventCreationDraft> {
  const [draft] = await transaction
    .select()
    .from(eventCreationDrafts)
    .where(and(
      eq(eventCreationDrafts.id, draftId),
      eq(eventCreationDrafts.createdByPersonId, actorPersonId),
    ))
    .limit(1);
  if (!draft) throw new EventCreationRepositoryError("draft_not_found", "That private draft is no longer available.");

  const personRows = await transaction
    .select()
    .from(eventCreationDraftPeople)
    .where(eq(eventCreationDraftPeople.draftId, draft.id))
    .orderBy(eventCreationDraftPeople.position);

  return EventCreationDraftSchema.parse({
    id: draft.id,
    version: draft.version,
    status: draft.status,
    sourceKind: draft.sourceKind,
    sourceEventId: draft.sourceEventId,
    sourceEventName: draft.sourceEventName,
    description: draft.description,
    proposedName: draft.proposedName,
    startsOn: draft.startsOn,
    endsOn: draft.endsOn,
    locationName: draft.locationName,
    eventTypeKey: draft.eventTypeKey,
    eventContextKeys: draft.eventContextKeys,
    templateKey: draft.templateKey,
    templateVersion: draft.templateVersion,
    supported: draft.supported,
    brief: EventBriefSchema.parse(draft.brief),
    interpretationStatus: draft.interpretationStatus,
    interpretationErrorCode: draft.interpretationErrorCode,
    people: personRows.map((person) => ({
      id: person.id,
      personId: person.personId,
      displayName: person.displayName,
      email: person.source === "prior_event" && person.personId ? null : person.email,
      message: person.message,
      source: person.source,
      included: person.included,
      needsContact: person.needsContact,
    })),
    committedEventId: draft.committedEventId,
    committedEventSlug: draft.committedEventSlug,
    entryContext: draft.entryContext ?? null,
    updatedAt: draft.updatedAt.toISOString(),
  });
}

export async function getEventCreationDraft(
  draftId: string,
  options: EventCreationRepositoryOptions,
) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction((transaction) => readDraft(transaction, draftId, options.actorPersonId));
  } finally {
    await database.close();
  }
}

export async function listRecentReusableEvents(
  options: EventCreationRepositoryOptions,
): Promise<RecentReusableEvent[]> {
  const database = createDatabase(options.databaseUrl);
  try {
    const eventRows = await database.db
      .select({
        id: commons.id,
        name: commons.name,
        startsOn: commons.startsOn,
        endsOn: commons.endsOn,
        locationName: commons.locationName,
        eventTypeKey: commons.eventTypeKey,
      })
      .from(memberships)
      .innerJoin(commons, eq(commons.id, memberships.commonsId))
      .where(and(
        eq(memberships.personId, options.actorPersonId),
        eq(memberships.status, "active"),
        ne(commons.slug, "cape-cod-couples-week"),
      ))
      .orderBy(desc(commons.endsOn), desc(commons.updatedAt))
      .limit(5);

    const results: RecentReusableEvent[] = [];
    for (const event of eventRows) {
      const participantRows = await database.db
        .select({
          personId: people.id,
          displayName: people.displayName,
          avatarUrl: people.avatarUrl,
        })
        .from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId))
        .where(and(
          eq(memberships.commonsId, event.id),
          eq(memberships.status, "active"),
          ne(memberships.personId, options.actorPersonId),
        ))
        .limit(24);
      results.push({ ...event, people: participantRows });
    }
    return RecentReusableEventsSchema.parse(results);
  } finally {
    await database.close();
  }
}

export async function createEventCreationDraft(
  input: unknown,
  options: EventCreationRepositoryOptions,
) {
  const request = CreateEventCreationDraftRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      if (request.sourceKind === "description") {
        let interpretation;
        let interpretationStatus = "succeeded";
        let errorCode: string | null = null;
        try {
          interpretation = interpretEventTitle(request.title);
        } catch {
          interpretationStatus = "failed";
          errorCode = "interpretation_failed";
          interpretation = { ...interpretEventDescription("New trip"), proposedName: "New trip" };
        }
        const chosenTemplate = newPlanTemplate(request.templateKey);
        const [created] = await transaction.insert(eventCreationDrafts).values({
          createdByPersonId: options.actorPersonId,
          sourceKind: request.sourceKind,
          description: request.title,
          proposedName: interpretation.proposedName,
          startsOn: interpretation.startsOn,
          endsOn: interpretation.endsOn,
          locationName: interpretation.locationName,
          timezone: request.timezone,
          eventTypeKey: interpretation.eventTypeKey,
          eventContextKeys: interpretation.eventContextKeys,
          templateKey: chosenTemplate.key,
          templateVersion: chosenTemplate.version,
          supported: interpretation.supported,
          brief: interpretation.brief,
          entryContext: options.entryContext ?? null,
          interpretationStatus,
          interpretationErrorCode: errorCode,
        }).returning({ id: eventCreationDrafts.id });
        if (interpretation.people.length) {
          await transaction.insert(eventCreationDraftPeople).values(interpretation.people.map((person, position) => ({
            id: randomUUID(),
            draftId: created.id,
            displayName: person.displayName,
            email: person.email,
            message: null,
            source: "description",
            included: true,
            needsContact: !person.email,
            position,
          })));
        }
        return readDraft(transaction, created.id, options.actorPersonId);
      }

      const [source] = await transaction
        .select({
          id: commons.id,
          name: commons.name,
          startsOn: commons.startsOn,
          endsOn: commons.endsOn,
          locationName: commons.locationName,
          eventTypeKey: commons.eventTypeKey,
          eventContextKeys: commons.eventContextKeys,
          templateKey: commons.templateKey,
        })
        .from(commons)
        .innerJoin(memberships, and(
          eq(memberships.commonsId, commons.id),
          eq(memberships.personId, options.actorPersonId),
          eq(memberships.status, "active"),
        ))
        .where(eq(commons.id, request.sourceEventId))
        .limit(1);
      if (!source) throw new EventCreationRepositoryError("source_not_available", "That trip is not available to plan again.");

      const [created] = await transaction.insert(eventCreationDrafts).values({
        createdByPersonId: options.actorPersonId,
        sourceKind: request.sourceKind,
        sourceEventId: source.id,
        sourceEventName: source.name,
        proposedName: source.name.replace(/\b20\d{2}\b/g, "").replace(/\s{2,}/g, " ").trim(),
        startsOn: null,
        endsOn: null,
        locationName: source.locationName,
        timezone: request.timezone,
        eventTypeKey: source.eventTypeKey,
        eventContextKeys: source.eventContextKeys,
        templateKey: newPlanTemplate(source.templateKey).key,
        templateVersion: newPlanTemplate(source.templateKey).version,
        supported: source.eventTypeKey === "travel",
        brief: {
          summary: `Planned from ${source.name}`,
          budgetMinimumCents: null,
          budgetMaximumCents: null,
          currency: null,
          goals: [],
          constraints: [],
          suggestedFirstMoves: ["Review the group", "Choose dates", "Add what should be different this time"],
          unresolvedQuestion: null,
        },
        entryContext: options.entryContext ?? null,
        interpretationStatus: "not_required",
      }).returning({ id: eventCreationDrafts.id });

      const sourcePeople = await transaction
        .select({
          membershipId: memberships.id,
          personId: people.id,
          displayName: people.displayName,
        })
        .from(memberships)
        .innerJoin(people, eq(people.id, memberships.personId))
        .where(and(
          eq(memberships.commonsId, source.id),
          eq(memberships.status, "active"),
          ne(memberships.personId, options.actorPersonId),
        ))
        .limit(24);
      const priorInvites = sourcePeople.length ? await transaction
        .select({ personId: invitations.provisionalPersonId, email: invitations.recipientEmail })
        .from(invitations)
        .where(and(
          eq(invitations.commonsId, source.id),
          inArray(invitations.provisionalPersonId, sourcePeople.map((person) => person.personId)),
        )) : [];
      const emailByPerson = new Map(priorInvites.filter((row) => row.email).map((row) => [row.personId, row.email!]));
      if (sourcePeople.length) {
        await transaction.insert(eventCreationDraftPeople).values(sourcePeople.map((person, position) => ({
          id: randomUUID(),
          draftId: created.id,
          personId: person.personId,
          sourceMembershipId: person.membershipId,
          displayName: person.displayName,
          email: emailByPerson.get(person.personId) ?? null,
          message: null,
          source: "prior_event",
          included: true,
          needsContact: !emailByPerson.has(person.personId),
          position,
        })));
      }
      return readDraft(transaction, created.id, options.actorPersonId);
    });
  } finally {
    await database.close();
  }
}

export async function updateEventCreationDraft(
  draftId: string,
  input: unknown,
  options: EventCreationRepositoryOptions,
) {
  const request = UpdateEventCreationDraftRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const updated = await transaction.update(eventCreationDrafts).set({
        proposedName: request.proposedName,
        startsOn: request.startsOn,
        endsOn: request.endsOn,
        locationName: request.locationName || null,
        brief: request.brief,
        ...(request.forceTravel ? { supported: true, eventTypeKey: "travel", templateKey: "travel-general", templateVersion: 1 } : {}),
        version: request.expectedVersion + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(eventCreationDrafts.id, draftId),
        eq(eventCreationDrafts.createdByPersonId, options.actorPersonId),
        eq(eventCreationDrafts.version, request.expectedVersion),
        eq(eventCreationDrafts.status, "reviewing"),
      )).returning({ id: eventCreationDrafts.id });
      if (!updated.length) throw new EventCreationRepositoryError("draft_conflict", "This draft changed. Review the latest version and try again.");
      return readDraft(transaction, draftId, options.actorPersonId);
    });
  } finally {
    await database.close();
  }
}

export async function updateEventCreationDraftPeople(
  draftId: string,
  input: unknown,
  options: EventCreationRepositoryOptions,
) {
  const request = UpdateEventCreationDraftPeopleRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const [draft] = await transaction.select({ id: eventCreationDrafts.id })
        .from(eventCreationDrafts)
        .where(and(
          eq(eventCreationDrafts.id, draftId),
          eq(eventCreationDrafts.createdByPersonId, options.actorPersonId),
          eq(eventCreationDrafts.version, request.expectedVersion),
          eq(eventCreationDrafts.status, "reviewing"),
        )).for("update").limit(1);
      if (!draft) throw new EventCreationRepositoryError("draft_conflict", "This draft changed. Review the latest version and try again.");

      const existing = await transaction.select().from(eventCreationDraftPeople).where(eq(eventCreationDraftPeople.draftId, draftId));
      const existingById = new Map(existing.map((person) => [person.id, person]));
      if (request.people.length) {
        const occupiedRows = await transaction.select({ id: eventCreationDraftPeople.id, draftId: eventCreationDraftPeople.draftId })
          .from(eventCreationDraftPeople)
          .where(inArray(eventCreationDraftPeople.id, request.people.map((person) => person.id)));
        if (occupiedRows.some((row) => row.draftId !== draftId)) {
          throw new EventCreationRepositoryError("identity_conflict", "One of those people belongs to a different private draft.");
        }
      }
      const actorHashes = await transaction.select({ normalizedHash: identities.normalizedHash })
        .from(identities).where(and(eq(identities.personId, options.actorPersonId), eq(identities.kind, "email")));
      const selfHashes = new Set(actorHashes.map((identity) => identity.normalizedHash));

      for (const [position, person] of request.people.entries()) {
        const prior = existingById.get(person.id);
        if (person.personId && (!prior || prior.personId !== person.personId)) {
          throw new EventCreationRepositoryError("identity_conflict", "A person from another trip cannot be added to this draft.");
        }
        if (person.personId === options.actorPersonId || (person.email && selfHashes.has(hashNormalizedEmail(person.email)))) {
          throw new EventCreationRepositoryError("identity_conflict", "You are already the organizer of this trip.");
        }
        await transaction.insert(eventCreationDraftPeople).values({
          id: person.id,
          draftId,
          personId: person.personId,
          sourceMembershipId: prior?.sourceMembershipId ?? null,
          displayName: person.displayName,
          email: person.email?.toLowerCase() ?? prior?.email ?? null,
          source: prior?.source ?? "organizer",
          included: person.included,
          needsContact: !person.email && !prior?.email,
          position,
        }).onConflictDoUpdate({
          target: eventCreationDraftPeople.id,
          set: {
            displayName: person.displayName,
            email: person.email?.toLowerCase() ?? prior?.email ?? null,
            message: person.message,
            included: person.included,
            needsContact: !person.email && !prior?.email,
            position,
            updatedAt: new Date(),
          },
        });
      }
      const retainedIds = request.people.map((person) => person.id);
      for (const prior of existing) {
        if (!retainedIds.includes(prior.id)) {
          await transaction.delete(eventCreationDraftPeople).where(eq(eventCreationDraftPeople.id, prior.id));
        }
      }
      await transaction.update(eventCreationDrafts).set({ version: request.expectedVersion + 1, updatedAt: new Date() })
        .where(eq(eventCreationDrafts.id, draftId));
      return readDraft(transaction, draftId, options.actorPersonId);
    });
  } finally {
    await database.close();
  }
}

export async function commitEventCreationDraft(
  draftId: string,
  input: unknown,
  options: EventCreationRepositoryOptions,
): Promise<CommitEventCreationDraftResult> {
  const request = CommitEventCreationDraftRequestSchema.parse(input);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async (transaction) => {
      const [draft] = await transaction.select().from(eventCreationDrafts)
        .where(and(eq(eventCreationDrafts.id, draftId), eq(eventCreationDrafts.createdByPersonId, options.actorPersonId)))
        .for("update").limit(1);
      if (!draft) throw new EventCreationRepositoryError("draft_not_found", "That private draft is no longer available.");
      if (draft.status === "committed" && draft.committedEventId && draft.committedEventSlug) {
        const peopleNeedingContact = await transaction.select({ name: eventCreationDraftPeople.displayName })
          .from(eventCreationDraftPeople)
          .where(and(eq(eventCreationDraftPeople.draftId, draftId), eq(eventCreationDraftPeople.included, true), eq(eventCreationDraftPeople.needsContact, true)));
        const unsentInvitations = await transaction.select({ id: invitations.id })
          .from(invitations)
          .where(and(
            eq(invitations.commonsId, draft.committedEventId),
            inArray(invitations.deliveryState, ["not_sent", "failed"]),
          ));
        return CommitEventCreationDraftResultSchema.parse({
          eventId: draft.committedEventId,
          slug: draft.committedEventSlug,
          unsentInvitationCount: unsentInvitations.length,
          peopleNeedingContact: peopleNeedingContact.map((person) => person.name),
        });
      }
      if (draft.version !== request.expectedVersion) throw new EventCreationRepositoryError("draft_conflict", "This draft changed. Review the latest version and try again.");
      if (!draft.supported) throw new EventCreationRepositoryError("creation_not_supported", "Confirm this is a trip before creating it.");
      if (!draft.proposedName?.trim()) throw new EventCreationRepositoryError("draft_conflict", "Add a trip name before creating it.");

      const [organizer] = await transaction.select({ displayName: people.displayName }).from(people)
        .where(eq(people.id, options.actorPersonId)).limit(1);
      if (!organizer) throw new EventCreationRepositoryError("identity_conflict", "Your Commons profile is unavailable.");

      const slug = `${slugBase(draft.proposedName)}-${randomBytes(3).toString("hex")}`;
      const [createdEvent] = await transaction.insert(commons).values({
        slug,
        name: draft.proposedName,
        startsOn: draft.startsOn,
        endsOn: draft.endsOn,
        locationName: draft.locationName,
        timezone: draft.timezone,
        status: "planning",
        setupCompletedAt: new Date(),
        createdByPersonId: options.actorPersonId,
        eventTypeKey: draft.eventTypeKey,
        eventContextKeys: draft.eventContextKeys,
        templateKey: draft.templateKey,
        templateVersion: draft.templateVersion,
        creationSourceKind: draft.sourceKind,
        sourceEventId: draft.sourceEventId,
        newExperience: options.newExperience === true,
        eventBrief: EventBriefSchema.parse(draft.brief),
      }).returning({ id: commons.id });
      await transaction.insert(memberships).values({
        commonsId: createdEvent.id,
        personId: options.actorPersonId,
        role: "organizer",
        status: "active",
        joinedAt: new Date(),
      });
      await transaction.insert(consentEvents).values({
        commonsId: createdEvent.id,
        personId: options.actorPersonId,
        scope: "commons_membership",
        noticeVersion: "pilot-v1",
        action: "accepted",
        source: "created_event",
      });

      const draftPeople = await transaction.select().from(eventCreationDraftPeople)
        .where(and(eq(eventCreationDraftPeople.draftId, draftId), eq(eventCreationDraftPeople.included, true)))
        .orderBy(eventCreationDraftPeople.position);
      const peopleNeedingContact: string[] = [];
      let unsentInvitationCount = 0;
      for (const candidate of draftPeople) {
        if (!candidate.email) {
          peopleNeedingContact.push(candidate.displayName);
          const personId = candidate.personId ?? (await transaction.insert(people)
            .values({ displayName: candidate.displayName }).returning({ id: people.id }))[0].id;
          if (personId === options.actorPersonId) continue;
          // Explicitly reusing the same managed person keeps their profile and assigned manager,
          // provided that relationship still exists at approval. Other known people await an account invitation.
          const [priorMembership] = candidate.sourceMembershipId ? await transaction.select({ accessMode: memberships.accessMode, managers: memberships.managedByPersonIds, status: memberships.status, authUserId: people.authUserId }).from(memberships).innerJoin(people, eq(people.id, memberships.personId)).where(and(eq(memberships.id, candidate.sourceMembershipId),eq(memberships.personId,personId))) : [];
          const managed = !candidate.personId || Boolean(priorMembership?.status === "active" && priorMembership.accessMode === "managed" && !priorMembership.authUserId && priorMembership.managers?.includes(options.actorPersonId));
          await transaction.insert(memberships).values({
            commonsId: createdEvent.id, personId, role: "member",
            status: managed ? "active" : "invited",
            accessMode: managed ? "managed" : "account",
            managedByPersonIds: managed ? [options.actorPersonId] : [],
            canClaimAccess: true,
          }).onConflictDoNothing();
          await transaction.update(eventCreationDraftPeople).set({ personId })
            .where(eq(eventCreationDraftPeople.id, candidate.id));
          continue;
        }
        const normalizedEmailHash = hashNormalizedEmail(candidate.email);
        const [knownIdentity] = await transaction.select({ personId: identities.personId })
          .from(identities)
          .where(and(eq(identities.kind, "email"), eq(identities.normalizedHash, normalizedEmailHash)))
          .limit(1);
        if (candidate.personId && knownIdentity && candidate.personId !== knownIdentity.personId) {
          throw new EventCreationRepositoryError(
            "identity_conflict",
            `${candidate.displayName}'s email belongs to a different Commons account. Review their contact details before creating the trip.`,
          );
        }
        const personId = candidate.personId ?? knownIdentity?.personId ?? (await transaction.insert(people).values({
          displayName: candidate.displayName,
        }).returning({ id: people.id }))[0].id;
        if (personId === options.actorPersonId) continue;
        if (!knownIdentity) {
          await transaction.insert(identities).values({
            personId,
            kind: "email",
            normalizedHash: normalizedEmailHash,
            state: "observed",
          }).onConflictDoNothing();
        }
        await transaction.insert(memberships).values({
          commonsId: createdEvent.id,
          personId,
          role: "member",
          status: "invited",
        }).onConflictDoNothing();
        const token = mintRecoverableOpaqueToken();
        await transaction.insert(invitations).values({
          commonsId: createdEvent.id,
          provisionalPersonId: personId,
          createdByPersonId: options.actorPersonId,
          recipientName: candidate.displayName,
          recipientEmail: candidate.email.toLowerCase(),
          message: candidate.message,
          tokenHash: token.tokenHash,
          tokenValue: token.protectedToken,
          tokenVersion: 1,
          status: "pending",
          deliveryState: "not_sent",
          expiresAt: personalInvitationExpiry(),
        });
        unsentInvitationCount += 1;
      }

      // Starter to-dos from the plan template, owned by the organizer, no due date. Same transaction as the trip.
      const starterTodos = planTemplateFor(draft.templateKey).todos;
      if (starterTodos.length) {
        await transaction.insert(tripTasks).values(starterTodos.map((todo) => ({
          id: randomUUID(),
          commonsId: createdEvent.id,
          createdByPersonId: options.actorPersonId,
          ownerPersonId: options.actorPersonId,
          title: todo.title,
        })));
      }

      await transaction.insert(auditEvents).values({
        commonsId: createdEvent.id,
        commandId: request.commandId,
        actorId: options.actorPersonId,
        actorType: "human",
        action: "event.created",
        resourceType: "commons",
        resourceId: createdEvent.id,
        summary: `${organizer.displayName} created the private trip ${draft.proposedName}.`,
      });
      await transaction.update(eventCreationDrafts).set({
        status: "committed",
        committedEventId: createdEvent.id,
        committedEventSlug: slug,
        committedAt: new Date(),
        sourceDeleteAfter: sourceDeleteAfter(),
        version: draft.version + 1,
        updatedAt: new Date(),
      }).where(eq(eventCreationDrafts.id, draftId));

      return CommitEventCreationDraftResultSchema.parse({
        eventId: createdEvent.id,
        slug,
        unsentInvitationCount,
        peopleNeedingContact,
      });
    });
  } finally {
    await database.close();
  }
}
