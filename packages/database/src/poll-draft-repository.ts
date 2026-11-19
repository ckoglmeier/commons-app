import { PollWorkingDraftSchema, SavePollDraftRequestSchema } from "@commons/contracts";
import { and, desc, eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { commandFingerprint, CommandAccessError, CommandConflictError, type CommandTransaction } from "./event-command";
import { commons, memberships, pollDrafts, processedCommands } from "./schema";
import type { PollRepositoryOptions } from "./poll-repository";
import { canEditPollDraft, pollDraftAccess } from "./poll-draft-access";

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

export async function saveCommonsPollDraft(identifier: string, rawInput: unknown, options: PollRepositoryOptions) {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(tx => saveCommonsPollDraftInTransaction(tx, identifier, rawInput, options));
  } finally { await database.close(); }
}

export async function saveCommonsPollDraftInTransaction(tx: CommandTransaction, identifier: string, rawInput: unknown, options: PollRepositoryOptions) {
  const input = SavePollDraftRequestSchema.parse(rawInput);
  const commonsId = await activeEvent(tx, identifier, options.actorPersonId);
  const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, options.actorPersonId)));
  if (input.data.communication || input.data.review || input.data.questions.some(question => question.kind === "choice" && question.itinerary)) {
    if (actor.role !== "organizer") throw new CommandAccessError();
  }
  const [existing] = await tx.select().from(pollDrafts).where(eq(pollDrafts.id, input.id)).for("update").limit(1);
  if (existing?.data.privateItineraryDocument || input.data.privateItineraryDocument) throw new CommandConflictError();
  const fingerprint = commandFingerprint(options.actorPersonId, "poll.draft_saved", input);
  const snapshotOf = (row: typeof pollDrafts.$inferSelect) => PollWorkingDraftSchema.parse({ ...row, archivedAt: row.archivedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() });
  if (existing) {
    if (existing.commonsId !== commonsId || !canEditPollDraft(existing, options.actorPersonId, actor.role)) throw new CommandAccessError();
    const [prior] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, commonsId), eq(processedCommands.commandId, input.commandId)));
    if (prior?.result.legacyItineraryRevision) {
      if (prior.result.fingerprint !== fingerprint) throw new CommandConflictError();
      return PollWorkingDraftSchema.parse(prior.result.snapshot);
    }
    if (existing.lastCommandId === input.commandId) {
      if (existing.lastCommandFingerprint !== fingerprint) throw new CommandConflictError();
      return snapshotOf(existing);
    }
    if (existing.publishedPollId || existing.archivedAt || existing.version !== input.expectedVersion) throw new CommandConflictError();
    const [saved] = await tx.update(pollDrafts).set({ data: { ...input.data, lifecycle: existing.data.lifecycle }, version: existing.version + 1,
      lastCommandId: input.commandId, lastCommandFingerprint: fingerprint, updatedAt: new Date() })
      .where(eq(pollDrafts.id, existing.id)).returning();
    return snapshotOf(saved);
  }
  if (input.expectedVersion !== 0) throw new CommandConflictError();
  const [saved] = await tx.insert(pollDrafts).values({ id: input.id, commonsId, ownerPersonId: options.actorPersonId,
    organizerShared: Boolean(input.data.communication && actor.role === "organizer"),
    data: { ...input.data, lifecycle: undefined }, lastCommandId: input.commandId, lastCommandFingerprint: fingerprint }).returning();
  return snapshotOf(saved);
}

export async function listCommonsPollDrafts(identifier: string, options: PollRepositoryOptions, draftId?: string) {
  if (draftId) PollWorkingDraftSchema.shape.id.parse(draftId);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const commonsId = await activeEvent(tx, identifier, options.actorPersonId);
      const [actor] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, commonsId), eq(memberships.personId, options.actorPersonId)));
      const rows = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.commonsId, commonsId),
        pollDraftAccess(options.actorPersonId, actor.role), draftId ? eq(pollDrafts.id, draftId) : undefined)).orderBy(desc(pollDrafts.updatedAt)).limit(20);
      return rows.map(row => PollWorkingDraftSchema.parse({ ...row, archivedAt: row.archivedAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() }));
    });
  } finally { await database.close(); }
}
