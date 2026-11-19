import { PollAudienceSchema, PollCommunicationSchema, PollWorkingDraftSchema, SavePollDraftRequestSchema, LegacyItineraryRevisionSchema, type LegacyItineraryRevision } from "@commons/contracts";
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { commandFingerprint, CommandAccessError, CommandConflictError, type CommandTransaction } from "./event-command";
import { commons, coordinatorThreads, memberships, pollDrafts, polls, pollDeliveries, processedCommands, auditEvents, coordinatorTurns } from "./schema";
import { CoordinatorAccessError, CoordinatorConflictError } from "./coordinator-errors";
import { inArray } from "drizzle-orm";
import type { PollRepositoryOptions } from "./poll-repository";
import { resolvePollRecipients } from "./poll-delivery-repository";
import { canEditCoordinatorDraft, coordinatorDraftAccess } from "./coordinator-draft-access";
import { resolveWorkflowTemplateInTransaction } from "./workflow-repository";
import { workflowReferencePreserved, itineraryContentEqual } from "@commons/contracts";
import { projectGoalEventInTransaction } from "./coordinator-goal-repository";
import { assertFoodGoalQuestions } from "./food-goal-guard";

/** Pre-mapping generated projections remain snapshots, even when their stored data predates the identity field. */
export async function isGeneratedItineraryProjection(tx: CommandTransaction, commonsId: string, draftId: string) {
  const [reference] = await tx.select({ id: coordinatorTurns.id }).from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, commonsId), sql`${coordinatorTurns.workspace}->'itineraryDraft'->'sharingDraft'->>'draftId' = ${draftId}`)).limit(1);
  return Boolean(reference);
}

async function activeEvent(tx: CommandTransaction, identifier: string, personId: string) {
  // Same event lock as publish and membership mutations; permission is rechecked
  // on every operation, including idempotent retries.
  const [event] = await tx.select({ id: commons.id }).from(commons)
    .where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).for("update").limit(1);
  const [member] = event ? await tx.select({ status: memberships.status }).from(memberships)
    .where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, personId))).limit(1) : [];
  if (!event || member?.status !== "active") throw new CommandAccessError();
  return event.id;
}

export async function getPollDraftRecipientReview(identifier: string, draftId: string, version: number, options: PollRepositoryOptions) {
  PollWorkingDraftSchema.shape.id.parse(draftId);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const commonsId = await activeEvent(tx, identifier, options.actorPersonId);
      const [member] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, options.actorPersonId)));
      if (member.role !== "organizer") throw new CommandAccessError();
      const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, draftId), eq(pollDrafts.commonsId, commonsId), coordinatorDraftAccess(options.actorPersonId, member.role)));
      if (!draft) throw new CommandAccessError();
      if (draft.version !== version || draft.publishedPollId) throw new CommandConflictError();
      const audience = PollAudienceSchema.parse(draft.data.audience);
      const selected = await resolvePollRecipients(tx, { commonsId, audience }, options.resolveVerifiedEmail);
      return { fingerprint: commandFingerprint("", "poll_delivery", { audience, selected }), recipients: selected,
        missingPersonIds: audience.personIds.filter(id => !selected.some(row => row.personId === id)),
        missingEmails: audience.guestEmails.filter(email => !selected.some(row => row.email === email)) };
    });
  } finally { await database.close(); }
}

export async function saveCommonsPollDraft(identifier: string, rawInput: unknown, options: PollRepositoryOptions, attach?: { threadId: string }) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => saveCommonsPollDraftInTransaction(tx, identifier, rawInput, options, attach));
  } finally { await database.close(); }
}

/** Internal transaction boundary for atomic thread replies plus artifact edits. */
export async function saveCommonsPollDraftInTransaction(tx: CommandTransaction, identifier: string, rawInput: unknown, options: PollRepositoryOptions, attach?: { threadId: string }, revisionSource: "human" | "coordinator" = "human") {
      const input = SavePollDraftRequestSchema.parse(rawInput);
      const commonsId = await activeEvent(tx, identifier, options.actorPersonId);
      const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, options.actorPersonId)));
      if (input.data.communication || input.data.review || input.data.questions.some(question => question.kind === "choice" && question.itinerary)) {
        const [member] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, options.actorPersonId)));
        if (member.role !== "organizer") throw new CommandAccessError();
      }
      const [existing] = await tx.select().from(pollDrafts).where(eq(pollDrafts.id, input.id)).for("update").limit(1);
      if (existing?.commonsId === commonsId) await assertFoodGoalQuestions(tx, commonsId, existing.runId, input.data.questions, actor.role);
      if (existing && attach && input.expectedVersion === 0 && existing.commonsId === commonsId && existing.threadId === attach.threadId && actor.role === "organizer" && canEditCoordinatorDraft(existing, options.actorPersonId, actor.role) && existing.data.privateItineraryDocument?.id === input.data.privateItineraryDocument?.id && Boolean(input.data.privateItineraryDocument) && itineraryContentEqual({ ...existing.data, privateItineraryDocument: undefined }, { ...input.data, privateItineraryDocument: undefined })) {
        return PollWorkingDraftSchema.parse({ ...existing, archivedAt: existing.archivedAt?.toISOString() ?? null, updatedAt: existing.updatedAt.toISOString() });
      }
      if (input.data.privateItineraryDocument && !attach || existing?.data.privateItineraryDocument || existing && await isGeneratedItineraryProjection(tx, commonsId, existing.id)) throw new CommandConflictError();
      const fingerprint = commandFingerprint(options.actorPersonId, "poll.draft_saved", input);
      const workflow = input.data.workflow ?? existing?.data.workflow;
      if (existing?.data.workflow && input.data.workflow && !workflowReferencePreserved(existing.data.workflow, input.data.workflow)) throw new CommandConflictError();
      if (workflow) {
        if (actor.role !== "organizer") throw new CommandAccessError();
        const template = await resolveWorkflowTemplateInTransaction(tx, workflow.key, workflow);
        if (template.purpose === "itinerary") throw new CommandConflictError();
      }
      if (existing) {
        if (existing.commonsId !== commonsId || !canEditCoordinatorDraft(existing, options.actorPersonId, actor.role)) throw new CommandAccessError();
        // Itinerary retries retain an immutable receipt even after another writer advances the draft.
        const [prior] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, commonsId), eq(processedCommands.commandId, input.commandId)));
        if (prior?.result.legacyItineraryRevision) {
          if (prior.result.fingerprint !== fingerprint) throw new CommandConflictError();
          return PollWorkingDraftSchema.parse(prior.result.snapshot);
        }
        if (existing.lastCommandId === input.commandId) {
          if (existing.lastCommandFingerprint !== fingerprint) throw new CommandConflictError();
          return PollWorkingDraftSchema.parse({ ...existing, archivedAt: existing.archivedAt?.toISOString() ?? null, updatedAt: existing.updatedAt.toISOString() });
        }
        if (existing.publishedPollId || existing.archivedAt || existing.version !== input.expectedVersion) throw new CommandConflictError();
        const [saved] = await tx.update(pollDrafts).set({ data: { ...input.data, workflow, lifecycle: existing.data.lifecycle }, version: existing.version + 1,
          lastCommandId: input.commandId, lastCommandFingerprint: fingerprint, updatedAt: new Date() })
          .where(eq(pollDrafts.id, existing.id)).returning();
        const snapshot = PollWorkingDraftSchema.parse({ ...saved, archivedAt: saved.archivedAt?.toISOString() ?? null, updatedAt: saved.updatedAt.toISOString() });
        if (existing.data.questions.some(question => question.kind === "choice" && question.itinerary)) {
          const revision = LegacyItineraryRevisionSchema.parse({ commandId: input.commandId, documentId: saved.id, threadId: saved.threadId, version: saved.version, actorId: options.actorPersonId, source: revisionSource, at: saved.updatedAt.toISOString(), before: existing.data, after: saved.data });
          await tx.insert(processedCommands).values({ commonsId, commandId: input.commandId, result: { fingerprint, legacyItineraryRevision: revision, snapshot } });
          await tx.insert(auditEvents).values({ commonsId, commandId: input.commandId, actorId: options.actorPersonId, actorType: "human", action: "itinerary.document_saved", resourceType: "legacy_itinerary", resourceId: saved.id, summary: "Saved a private itinerary document revision." });
        }
        return snapshot;
      }
      if (input.expectedVersion !== 0) throw new CommandConflictError();
      // A draft started from a conversation is created inside that thread, never adopted later by a second request.
      if (attach) {
        if (actor.role !== "organizer") throw new CoordinatorAccessError("organizer_required");
        const [thread] = await tx.select({ status: coordinatorThreads.status }).from(coordinatorThreads).where(and(eq(coordinatorThreads.id, attach.threadId), eq(coordinatorThreads.commonsId, commonsId))).for("update");
        if (!thread) throw new CoordinatorAccessError("thread_unavailable");
        if (thread.status !== "active") throw new CoordinatorConflictError("thread_archived");
      }
      const [saved] = await tx.insert(pollDrafts).values({ id: input.id, commonsId, ownerPersonId: options.actorPersonId, ...(attach ? { threadId: attach.threadId } : {}),
        organizerShared: Boolean(options.sharedCoordinator && input.data.communication && actor.role === "organizer"),
        data: { ...input.data, workflow, lifecycle: undefined }, lastCommandId: input.commandId, lastCommandFingerprint: fingerprint }).returning();
      return PollWorkingDraftSchema.parse({ ...saved, archivedAt: saved.archivedAt?.toISOString() ?? null, updatedAt: saved.updatedAt.toISOString() });
}

export async function reopenCoordinatorDraft(identifier: string, draftId: string, version: number, options: PollRepositoryOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(tx => reopenCoordinatorDraftInTransaction(tx, identifier, draftId, version, options)); }
  finally { await database.close(); }
}

/** Shared by recipe revision so its command receipt and replacement commit atomically. */
export async function reopenCoordinatorDraftInTransaction(tx: CommandTransaction, identifier: string, draftId: string, version: number, options: PollRepositoryOptions) {
      const commonsId = await activeEvent(tx, identifier, options.actorPersonId);
      const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, options.actorPersonId)));
      if (actor.role !== "organizer") throw new CommandAccessError();
      const [original] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, draftId), eq(pollDrafts.commonsId, commonsId), coordinatorDraftAccess(options.actorPersonId, actor.role))).for("update");
      if (!original?.publishedPollId) throw new CommandAccessError();
      if (original.data.privateItineraryDocument || await isGeneratedItineraryProjection(tx, commonsId, original.id)) throw new CommandConflictError();
      const [published] = await tx.select({ status: polls.status }).from(polls).where(eq(polls.id, original.publishedPollId)).for("update");
      if (!published || published.status === "revoked") throw new CommandAccessError();
      if (original.data.lifecycle?.replacementDraftId) {
        const [existing] = await tx.select().from(pollDrafts).where(eq(pollDrafts.id, original.data.lifecycle.replacementDraftId));
        if (!existing) throw new CommandConflictError();
        return PollWorkingDraftSchema.parse({ ...existing, archivedAt: existing.archivedAt?.toISOString() ?? null, updatedAt: existing.updatedAt.toISOString() });
      }
      if (original.version !== version) throw new CommandConflictError();
      const id = randomUUID(), now = new Date();
      const data = { ...original.data, review: undefined, audience: undefined, lifecycle: { reopenedFromPollId: original.publishedPollId } };
      const [created] = await tx.insert(pollDrafts).values({ id, commonsId, threadId: original.threadId, ownerPersonId: options.actorPersonId, organizerShared: original.organizerShared, runId: original.runId, data, lastCommandId: randomUUID(), lastCommandFingerprint: commandFingerprint(options.actorPersonId, "poll.reopened", { draftId, version }) }).returning();
      await tx.update(pollDrafts).set({ data: { ...original.data, lifecycle: { ...original.data.lifecycle, replacementDraftId: id } }, updatedAt: now }).where(eq(pollDrafts.id, original.id));
      await tx.update(polls).set({ status: "closed", closedAt: now, updatedAt: now }).where(eq(polls.id, original.publishedPollId));
      await tx.update(pollDeliveries).set({ status: "cancelled", errorCode: "access_changed", updatedAt: now }).where(and(eq(pollDeliveries.pollId, original.publishedPollId), inArray(pollDeliveries.status, ["queued", "processing", "failed"])));
      await projectGoalEventInTransaction(tx, commonsId, original.publishedPollId, now);
      return PollWorkingDraftSchema.parse({ ...created, archivedAt: created.archivedAt?.toISOString() ?? null, updatedAt: created.updatedAt.toISOString() });
}

export async function savePublishedPollDeliveryNote(identifier: string, draftId: string, version: number, rawCommunication: unknown, options: PollRepositoryOptions) {
  PollWorkingDraftSchema.shape.id.parse(draftId);
  const communication = rawCommunication === null ? undefined : PollCommunicationSchema.parse(rawCommunication);
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const commonsId = await activeEvent(tx, identifier, options.actorPersonId);
    const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, options.actorPersonId)));
    if (actor.role !== "organizer") throw new CommandAccessError();
    const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, draftId), eq(pollDrafts.commonsId, commonsId), coordinatorDraftAccess(options.actorPersonId, actor.role))).for("update");
    if (!draft?.publishedPollId || draft.version !== version) throw new CommandConflictError();
    const data = { ...draft.data, presentationVersion: 2 as const, communication };
    const [saved] = await tx.update(pollDrafts).set({ data, version: draft.version + 1, updatedAt: new Date() }).where(eq(pollDrafts.id, draft.id)).returning();
    return PollWorkingDraftSchema.parse({ ...saved, archivedAt: saved.archivedAt?.toISOString() ?? null, updatedAt: saved.updatedAt.toISOString() });
  }); } finally { await database.close(); }
}

export async function listCommonsPollDrafts(identifier: string, options: PollRepositoryOptions, draftId?: string) {
  if (draftId) PollWorkingDraftSchema.shape.id.parse(draftId);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const commonsId = await activeEvent(tx, identifier, options.actorPersonId);
      const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, options.actorPersonId)));
      const rows = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.commonsId, commonsId),
        coordinatorDraftAccess(options.actorPersonId, actor.role), draftId ? eq(pollDrafts.id, draftId) : undefined)).orderBy(desc(pollDrafts.updatedAt)).limit(20);
      return rows.map(row => PollWorkingDraftSchema.parse({ ...row, archivedAt: row.archivedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() }));
    });
  } finally { await database.close(); }
}

export async function readLegacyItineraryRevisions(identifier: string, documentId: string, options: PollRepositoryOptions): Promise<LegacyItineraryRevision[]> {
  const db = createDatabase(options.databaseUrl);
  try { return await db.db.transaction(async tx => {
    const event = await activeEvent(tx, identifier, options.actorPersonId);
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, event), eq(memberships.personId, options.actorPersonId)));
    const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, documentId), eq(pollDrafts.commonsId, event), coordinatorDraftAccess(options.actorPersonId, member.role)));
    if (member.role !== "organizer" || !draft?.data.questions.some(question => question.kind === "choice" && question.itinerary)) throw new CommandAccessError();
    const rows = await tx.select({ result: processedCommands.result }).from(auditEvents).innerJoin(processedCommands, and(eq(processedCommands.commonsId, auditEvents.commonsId), eq(processedCommands.commandId, auditEvents.commandId)))
      .where(and(eq(auditEvents.commonsId, event), eq(auditEvents.resourceType, "legacy_itinerary"), eq(auditEvents.resourceId, documentId))).orderBy(desc(auditEvents.occurredAt)).limit(50);
    return rows.flatMap(row => { const parsed = LegacyItineraryRevisionSchema.safeParse(row.result.legacyItineraryRevision); return parsed.success ? [parsed.data] : []; });
  }); } finally { await db.close(); }
}
