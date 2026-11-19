import { parseOrganizerActivities, parseOrganizerInvites, COORDINATOR_MAX_SPOKEN_REPLY, COORDINATOR_MAX_TURN_ATTEMPTS, COORDINATOR_MAX_THREAD_TITLE, CoordinatorWorkspaceSchema, PollWorkingDataSchema, TurnCommandSchema, TurnSourceRefSchema, reportsOwnAttendance, coordinatorErrorCatalog, type CoordinatorErrorCode, type CoordinatorInputMode, type CoordinatorTurnLifecycle, type CoordinatorWorkspace, type PollWorkingData, type TurnCommand, type TurnSourceRef, type TurnStatus } from "@commons/contracts";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { itineraryPlanningBasisIsCurrent } from "./itinerary-planning-basis";
import { createDatabase } from "./client";
import { isCommonsId } from "./commons-identifier";
import { commandFingerprint, type CommandTransaction } from "./event-command";
import { commons, coordinatorResearchRuns, coordinatorThreadIdeas, coordinatorThreads, coordinatorTurns, itineraryItems, memberships, pollDrafts, polls, processedCommands, stays } from "./schema";
import { isGeneratedItineraryProjection, saveCommonsPollDraftInTransaction } from "./poll-draft-repository";
import { resolveWorkflowTemplateInTransaction } from "./workflow-repository";
import { workflowReferencePreserved, itineraryContentEqual, ItineraryPlanningBasisSchema } from "@commons/contracts";
import type { PollRepositoryOptions } from "./poll-repository";
import { inviteCoordinatorRecipientsInTransaction } from "./onboarding-repository";
import { recordAttendanceStatementInTransaction } from "./coordinator-repository";
import { addCoordinatorActivitiesInTransaction, activityReceiptReply } from "./coordinator-activities-repository";
import { canEditCoordinatorDraft, isPlanningGoalDraft } from "./coordinator-draft-access";
import { CoordinatorTurnError } from "./coordinator-errors";
import { saveTripTaskInTransaction } from "./trip-task-repository";
import { tripTaskProposalIsCurrent } from "./coordinator-trip-task-repository";
import { buildThreadState, lifecycleOf, placeholderAnswer, publicWorkspace, readThreadMeta, turnLifecycleIs, turnStatusSql, writeLifecycle, type TurnRow } from "./coordinator-turn-lifecycle";
import { closeTurnExecutionInTransaction, finishTurnExecutionInTransaction, insertTurnExecutionInTransaction, turnExecutionClaimIsCurrentInTransaction, TURN_EXECUTION_LEASE_MS, TURN_EXECUTION_MAX_QUEUE_MS, type TurnExecutionHooks, type TurnExecutionInput } from "./coordinator-turn-execution-repository";

/*
 * Coordinator turn lifecycle (docs/COORDINATOR-WORKSPACE-DESIGN.md §5).
 * begin -> (inference outside any transaction) -> complete | fail, with lookup
 * by command id. Every function re-checks active organizer membership under the
 * trip lock; no client-supplied identity or scope is trusted.
 *
 * No schema change: status, attempt, lease, spoken reply, sources and timestamps live in the versioned
 * `workspace.lifecycle` object of the existing row (see coordinator-turn-lifecycle.ts). The rules that CHECK
 * constraints would have held (failed <=> error code, attempts 1..3, completed => non-empty answer, bounded
 * text) are enforced by `writeLifecycle` on every write. Complete/fail are attempt-guarded by a row lock
 * (`FOR UPDATE`) plus a WHERE on the lifecycle attempt inside the jsonb.
 */

export type CoordinatorTurnRecord = {
  turnId: string; commandId: string; threadId: string; sequence: number; attempt: number;
  /** The trip and the organizer that own this turn; used to scope ids derived from the command. */
  tripId: string; actorId: string;
  status: TurnStatus; inputMode: CoordinatorInputMode; errorCode: CoordinatorErrorCode | null;
  userText: string; assistantText: string | null; spokenReply: string | null; sources: TurnSourceRef[];
  workspace: CoordinatorWorkspace | null; draftId: string | null; contextPollId: string | null; contextTurnId: string | null;
  thread: { id: string; title: string; titleSource: "organizer" | "provisional" | "generated"; status: "active" | "archived"; metadataVersion: number; turnVersion: number };
};

export type PersistableTurnOutcome = {
  status: "completed"; assistantText: string; spokenReply: string; sources: TurnSourceRef[];
  workspace?: CoordinatorWorkspace;
  /** Run the direct-attendance exception in the same transaction as the reply. */
  attendanceStatement?: boolean;
  threadUpdate?: { topicTitle?: string; summary?: string; openQuestions?: string[] };
  /**
   * Explicit Ask the group with no draft yet: the private organizer draft is created inside the completing
   * transaction, in this thread, so a failed turn leaves no orphan draft. A proposal in `workspace.proposal`
   * must be based on this draft's first version.
   */
  privateItineraryEdit?: { id: string; baseVersion: number; data: PollWorkingData; basis: z.infer<typeof ItineraryPlanningBasisSchema> };
  newDraft?: { id: string; data: PollWorkingData };
  /** "Start a separate thread": one new thread, created with the receipt turn. The id and command id are derived from the command, never from the model. */
  createThread?: { id: string; title: string; commandId: string };
  /** Link an existing Plan idea to this thread (no copy). Unlink is the undo. */
  linkIdea?: { itineraryItemId: string };
};

export const TURN_LEASE_MS = 120_000;
// Outlive the itinerary route (180s), so reload/retry cannot reclaim active work.
export const ITINERARY_TURN_LEASE_MS = 240_000;
export const MAX_TURN_ATTEMPTS = COORDINATOR_MAX_TURN_ATTEMPTS;
export const COORDINATOR_HOURLY_LIMIT = 100;
export const MAX_THREAD_TITLE = COORDINATOR_MAX_THREAD_TITLE;

/** Resolves the trip and the actor's standing. Never throws: callers decide how to report a lost membership. */
export async function resolveTripActor(tx: CommandTransaction, identifier: string, personId: string, lock: boolean) {
  const query = tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
  const [event] = lock ? await query.for("update") : await query;
  if (!event) return { eventId: null, failure: "membership_lost" as const };
  const [member] = await tx.select({ role: memberships.role, status: memberships.status }).from(memberships)
    .where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, personId))).limit(1);
  if (!member || member.status !== "active") return { eventId: event.id, failure: "membership_lost" as const };
  if (member.role !== "organizer") return { eventId: event.id, failure: "organizer_required" as const };
  return { eventId: event.id, failure: null };
}

/** Same as `resolveTripActor` but throws the stable error; use for entry points that must not proceed. */
export async function requireTripOrganizer(tx: CommandTransaction, identifier: string, personId: string, lock = true) {
  const resolved = await resolveTripActor(tx, identifier, personId, lock);
  if (resolved.failure) throw new CoordinatorTurnError(resolved.failure);
  return resolved.eventId!;
}

/** Bounded, single-line, no trailing punctuation. Used for generated titles. */
export function boundedThreadTitle(value: string) {
  const collapsed = value.replace(/\s+/g, " ").trim().replace(/[\s.,;:!?-]+$/, "");
  if (collapsed.length <= MAX_THREAD_TITLE) return collapsed;
  const cut = collapsed.slice(0, MAX_THREAD_TITLE + 1), space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut.slice(0, MAX_THREAD_TITLE)).replace(/[\s.,;:!?-]+$/, "");
}

async function turnVersion(tx: CommandTransaction, threadId: string) {
  const [row] = await tx.select({ value: sql<number>`coalesce(max(${coordinatorTurns.sequence}), 0)::int` }).from(coordinatorTurns).where(eq(coordinatorTurns.threadId, threadId));
  return row.value;
}

async function toRecord(tx: CommandTransaction, row: TurnRow): Promise<CoordinatorTurnRecord> {
  if (!row.threadId) throw new CoordinatorTurnError("internal_error");
  const [thread] = await tx.select().from(coordinatorThreads).where(eq(coordinatorThreads.id, row.threadId)).limit(1);
  if (!thread) throw new CoordinatorTurnError("thread_unavailable");
  const life = lifecycleOf(row), meta = (await readThreadMeta(tx, thread.commonsId, [thread])).get(thread.id)!;
  return {
    turnId: row.id, commandId: row.commandId, threadId: row.threadId, sequence: row.sequence, attempt: life.attempt, tripId: row.commonsId, actorId: row.ownerPersonId,
    status: life.status, inputMode: life.inputMode, errorCode: life.errorCode,
    // Only a completed turn has an answer; pending/failed rows hold a placeholder for older readers that this code never treats as one.
    userText: row.userText, assistantText: life.status === "completed" ? row.assistantText || null : null, spokenReply: life.spokenReply, sources: life.sources,
    workspace: publicWorkspace(row.workspace), draftId: row.draftId, contextPollId: row.contextPollId, contextTurnId: row.contextTurnId,
    thread: { id: thread.id, title: thread.title, titleSource: meta.titleSource, status: thread.status, metadataVersion: thread.version, turnVersion: await turnVersion(tx, thread.id) },
  };
}

function turnFingerprint(actorId: string, command: TurnCommand) {
  // Excludes expectedTurnVersion and voice metadata so a single refreshed retry can reuse the command id.
  // `artifact.selection` says how the client attached a draft (chosen in the UI, or attached as thread context); a retry that rebuilds the command
  // without it must still match the saved request.
  const artifact = command.artifact?.kind === "draft" ? { kind: command.artifact.kind, id: command.artifact.id, version: command.artifact.version } : command.artifact;
  return commandFingerprint(actorId, "coordinator.turn.v2", {
    target: { kind: command.target.kind, threadId: command.target.threadId }, inputMode: command.inputMode, text: command.text,
    artifact, explicitAction: command.explicitAction,
    ...(command.attachments?.length ? { attachments: command.attachments } : {}),
  });
}

/** Moves a turn to a new lifecycle state under the caller's row lock, guarded by the expected status and attempt. Returns the updated row, or null when another attempt already moved it. */
async function transition(tx: CommandTransaction, row: TurnRow, from: { status: TurnStatus; attempt: number }, next: CoordinatorTurnLifecycle, extra: { assistantText?: string; workspace?: CoordinatorWorkspace | null; draftId?: string | null; contextPollId?: string | null; contextTurnId?: string | null } = {}) {
  const written = writeLifecycle(extra.workspace !== undefined ? extra.workspace : row.workspace, next, extra.assistantText ?? (next.status === "completed" ? row.assistantText : placeholderAnswer(next.status)));
  const { workspace, assistantText } = written;
  const [updated] = await tx.update(coordinatorTurns).set({ workspace, assistantText,
    ...(extra.draftId !== undefined ? { draftId: extra.draftId } : {}), ...(extra.contextPollId !== undefined ? { contextPollId: extra.contextPollId } : {}), ...(extra.contextTurnId !== undefined ? { contextTurnId: extra.contextTurnId } : {}) })
    .where(and(eq(coordinatorTurns.id, row.id), turnLifecycleIs(from.status, from.attempt))).returning();
  return updated ?? null;
}

const failedLifecycle = (life: CoordinatorTurnLifecycle, errorCode: CoordinatorErrorCode): CoordinatorTurnLifecycle => ({ ...life, status: "failed", errorCode, leaseExpiresAt: null, spokenReply: null, sources: [], completedAt: null });

/** The failed workspace keeps only the human instruction's server-selected scope plus an optional stop/interruption marker, never failed output. */
function failedWorkspace(row: TurnRow, marker: Pick<CoordinatorWorkspace, "stop" | "interruption"> = {}): CoordinatorWorkspace {
  return { ...(row.workspace?.itineraryInstruction ? { itineraryInstruction: row.workspace.itineraryInstruction } : {}), ...marker };
}

async function failExpiredLease(tx: CommandTransaction, row: TurnRow, now: Date) {
  const life = lifecycleOf(row);
  if (life.status !== "pending" || !life.leaseExpiresAt || new Date(life.leaseExpiresAt) > now) return row;
  // Stored as internal_error so the version before this one still reads it; the marker says why for readers that know it.
  const failed = await transition(tx, row, life, failedLifecycle(life, "internal_error"), { workspace: failedWorkspace(row, { interruption: { attempt: life.attempt, at: now.toISOString(), reason: "lease_expired" } }) });
  if (failed) await closeTurnExecutionInTransaction(tx, row.id, life.attempt, "interrupted", "lease_expired", now);
  return failed ?? row;
}

export async function reserveInference(tx: CommandTransaction, eventId: string, actorId: string, commandId: string, attempt: number, now: Date, limit: number = COORDINATOR_HOURLY_LIMIT) {
  const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(processedCommands).where(and(eq(processedCommands.commonsId, eventId),
    gte(processedCommands.processedAt, new Date(now.getTime() - 3_600_000)), sql`${processedCommands.result}->>'kind' = 'poll_inference'`));
  if (usage.count >= limit) throw new CoordinatorTurnError("rate_limited");
  // Keyed by organizer, command and attempt: a replay never double-counts, a genuine retry counts once more, and another organizer of the same trip who
  // reuses a command id (the id is visible to every organizer) still consumes their own slot.
  await tx.insert(processedCommands).values({ commonsId: eventId, commandId: `inference:${actorId}:${commandId}:${attempt}`, processedAt: now, result: { kind: "poll_inference", actorPersonId: actorId } }).onConflictDoNothing();
}

/**
 * Reserves the hourly inference slot for a turn that learns only while it runs that it needs one model call (the native lodging resolver). It uses the
 * same key as `beginCoordinatorTurn` for this attempt, so a turn that already reserved is never counted twice, and it applies only to the caller's own
 * pending turn at that attempt.
 */
export async function reserveTurnInference(identifier: string, input: { commandId: string; attempt: number }, options: PollRepositoryOptions & { now?: Date; hourlyInferenceLimit?: number }) {
  const database = createDatabase(options.databaseUrl);
  try {
    await database.db.transaction(async tx => {
      const eventId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
      const [row] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, eventId), eq(coordinatorTurns.ownerPersonId, options.actorPersonId), eq(coordinatorTurns.commandId, input.commandId))).limit(1);
      const life = row ? lifecycleOf(row) : null;
      if (!life || life.status !== "pending" || life.attempt !== input.attempt) throw new CoordinatorTurnError("stale_version");
      // Already reserved for this attempt (by begin, or an earlier call): the slot is held, so the limit check must not count it against itself.
      const [held] = await tx.select({ id: processedCommands.commandId }).from(processedCommands).where(and(eq(processedCommands.commonsId, eventId), eq(processedCommands.commandId, `inference:${options.actorPersonId}:${input.commandId}:${input.attempt}`))).limit(1);
      if (held) return;
      await reserveInference(tx, eventId, options.actorPersonId, input.commandId, input.attempt, options.now ?? new Date(), options.hourlyInferenceLimit ?? COORDINATOR_HOURLY_LIMIT);
    });
  } finally { await database.close(); }
}

/**
 * One rule for every artifact, replacing the two inconsistent checks behind the
 * observed first-turn 403. Unthreaded shared artifacts are adopted by the target thread.
 */
async function validateAndAdoptArtifact(tx: CommandTransaction, eventId: string, threadId: string, artifact: TurnCommand["artifact"], now: Date) {
  const result: { draftId: string | null; contextPollId: string | null; contextTurnId: string | null } = { draftId: null, contextPollId: null, contextTurnId: null };
  if (!artifact) return result;
  if (artifact.kind === "draft") {
    const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, artifact.id), eq(pollDrafts.commonsId, eventId), eq(pollDrafts.organizerShared, true))).for("update");
    // Owner-private legacy drafts and other trips' drafts look exactly like missing ones.
    if (!draft || draft.archivedAt || !draft.data.communication && !await isPlanningGoalDraft(tx, draft, threadId)) throw new CoordinatorTurnError("artifact_missing");
    if (draft.threadId && draft.threadId !== threadId) throw new CoordinatorTurnError("artifact_misassociated");
    if (draft.publishedPollId || draft.version !== artifact.version) throw new CoordinatorTurnError("stale_version");
    if (!draft.threadId) await tx.update(pollDrafts).set({ threadId, updatedAt: now }).where(eq(pollDrafts.id, draft.id));
    result.draftId = draft.id;
  } else if (artifact.kind === "poll") {
    const [poll] = await tx.select({ id: polls.id, threadId: polls.threadId }).from(polls).where(and(eq(polls.id, artifact.id), eq(polls.commonsId, eventId))).for("update");
    if (!poll) throw new CoordinatorTurnError("artifact_missing");
    if (poll.threadId && poll.threadId !== threadId) throw new CoordinatorTurnError("artifact_misassociated");
    if (!poll.threadId) await tx.update(polls).set({ threadId, updatedAt: now }).where(eq(polls.id, poll.id));
    result.contextPollId = poll.id;
  } else {
    const [note] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.id, artifact.turnId), eq(coordinatorTurns.commonsId, eventId), eq(coordinatorTurns.organizerShared, true)));
    if (!note?.workspace?.saved) throw new CoordinatorTurnError("artifact_missing");
    if (note.threadId !== threadId) throw new CoordinatorTurnError("artifact_misassociated");
    result.contextTurnId = note.id;
  }
  return result;
}

/**
 * One transaction: membership -> replay -> thread -> artifact -> rate limit -> pending human turn.
 * Quota is consumed only after every other check passes. Safe to call again with the same command.
 */
export async function beginCoordinatorTurn(identifier: string, rawCommand: unknown, options: PollRepositoryOptions & { provisionalTitle: string; now?: Date; hourlyInferenceLimit?: number; /** Server-classified plain-language itinerary request; changes only the lease, never routing or authority. */ itineraryGeneration?: boolean; /** False for requests Commons answers without a model call (attendance, navigation, honest refusals): they neither count against nor wait on the hourly inference limit. */ reserveInference?: boolean; /** Durable admission (A2): accept the attempt for an executor in another process, in this same transaction. */ durable?: TurnExecutionInput }): Promise<{ kind: "started" | "replayed"; turn: CoordinatorTurnRecord }> {
  const command = TurnCommandSchema.parse(rawCommand);
  // A durably accepted attempt first waits for an executor; the executor then keeps the lease renewed. Lookup never fails a turn an executor still holds.
  const leaseMs = options.durable ? TURN_EXECUTION_MAX_QUEUE_MS + TURN_EXECUTION_LEASE_MS : command.explicitAction?.kind === "itinerary" || options.itineraryGeneration ? ITINERARY_TURN_LEASE_MS : TURN_LEASE_MS;
  const now = options.now ?? new Date(), limit = options.hourlyInferenceLimit ?? COORDINATOR_HOURLY_LIMIT, reserve = options.reserveInference !== false;
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const eventId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
      const fingerprint = turnFingerprint(options.actorPersonId, command);
      const instructionWorkspace = async (threadId: string): Promise<CoordinatorWorkspace> => command.explicitAction?.kind === "itinerary"
        ? { itineraryInstruction: { draftId: (await latestItinerary(tx, eventId, threadId))?.draft.id ?? null, baseVersion: command.explicitAction.baseVersion } } : {};
      // The trip row is locked above, so concurrent begins with one command id are serialized here; the row lock and the
      // unique index coordinator_turns_owner_command_unique are the second and third lines of defense.
      const [found] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, eventId), eq(coordinatorTurns.ownerPersonId, options.actorPersonId), eq(coordinatorTurns.commandId, command.commandId))).for("update");
      if (found) {
        if (found.fingerprint !== fingerprint) throw new CoordinatorTurnError("command_mismatch");
        const row = await failExpiredLease(tx, found, now), life = lifecycleOf(row);
        const canRetry = life.status === "failed" && life.errorCode !== null && coordinatorErrorCatalog[life.errorCode]?.retryable === true && life.attempt < MAX_TURN_ATTEMPTS;
        if (!canRetry) return { kind: "replayed" as const, turn: await toRecord(tx, row) };
        // A retry re-checks the thread and artifact, then reserves one more inference.
        const [thread] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, row.threadId!), eq(coordinatorThreads.commonsId, eventId))).for("update");
        if (!thread) throw new CoordinatorTurnError("thread_unavailable");
        if (thread.status !== "active") throw new CoordinatorTurnError("thread_archived");
        const artifact = await validateAndAdoptArtifact(tx, eventId, thread.id, command.artifact, now);
        if (reserve) await reserveInference(tx, eventId, options.actorPersonId, command.commandId, life.attempt + 1, now, limit);
        const reclaimed = await transition(tx, row, life, { ...life, status: "pending", errorCode: null, attempt: life.attempt + 1, leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(), spokenReply: null, sources: [], completedAt: null },
          { workspace: await instructionWorkspace(thread.id), draftId: artifact.draftId, contextPollId: artifact.contextPollId, contextTurnId: artifact.contextTurnId });
        if (reclaimed && options.durable) await insertTurnExecutionInTransaction(tx, { turnId: row.id, attempt: life.attempt + 1, tripId: eventId, actorPersonId: options.actorPersonId, commandId: command.commandId, execution: options.durable, now });
        return { kind: "started" as const, turn: await toRecord(tx, reclaimed ?? row) };
      }

      let threadId: string, version: number, createdTitle: string | null = null;
      const provisionalTitle = boundedThreadTitle(options.provisionalTitle) || "New conversation";
      if (command.target.kind === "new") {
        threadId = command.target.threadId; version = 0; createdTitle = provisionalTitle;
        const [collision] = await tx.select({ id: coordinatorThreads.id }).from(coordinatorThreads)
          .where(sql`${coordinatorThreads.id} = ${threadId} or (${coordinatorThreads.commonsId} = ${eventId} and ${coordinatorThreads.lastCommandId} = ${command.commandId})`).limit(1);
        if (collision) throw new CoordinatorTurnError("command_mismatch");
        await tx.insert(coordinatorThreads).values({ id: threadId, commonsId: eventId, createdByPersonId: options.actorPersonId,
          title: provisionalTitle, lastCommandId: command.commandId,
          lastCommandFingerprint: commandFingerprint(options.actorPersonId, "coordinator.thread_created_by_turn", { threadId, commandId: command.commandId }), createdAt: now, updatedAt: now });
      } else {
        threadId = command.target.threadId;
        const [thread] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, threadId), eq(coordinatorThreads.commonsId, eventId))).for("update");
        if (!thread) throw new CoordinatorTurnError("thread_unavailable");
        if (thread.status !== "active") throw new CoordinatorTurnError("thread_archived");
        version = await turnVersion(tx, threadId);
        if (version !== command.target.expectedTurnVersion) throw new CoordinatorTurnError("stale_version");
      }
      const artifact = await validateAndAdoptArtifact(tx, eventId, threadId, command.artifact, now);
      if (reserve) await reserveInference(tx, eventId, options.actorPersonId, command.commandId, 1, now, limit);
      const pending = writeLifecycle(await instructionWorkspace(threadId), { v: 1, status: "pending", inputMode: command.inputMode, errorCode: null, attempt: 1, leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        spokenReply: null, sources: [], completedAt: null, provisionalTitle: createdTitle }, placeholderAnswer("pending"));
      const [inserted] = await tx.insert(coordinatorTurns).values({ commonsId: eventId, ownerPersonId: options.actorPersonId, threadId, organizerShared: true,
        sequence: version + 1, commandId: command.commandId, fingerprint, userText: command.text, assistantText: pending.assistantText, workspace: pending.workspace,
        draftId: artifact.draftId, contextPollId: artifact.contextPollId, contextTurnId: artifact.contextTurnId, createdAt: now }).returning();
      await tx.update(coordinatorThreads).set({ updatedAt: now }).where(eq(coordinatorThreads.id, threadId));
      if (options.durable) await insertTurnExecutionInTransaction(tx, { turnId: inserted.id, attempt: 1, tripId: eventId, actorPersonId: options.actorPersonId, commandId: command.commandId, execution: options.durable, now });
      return { kind: "started" as const, turn: await toRecord(tx, inserted) };
    });
  } finally { await database.close(); }
}

/**
 * Organizer-scoped lookup for reload/timeout recovery. A read takes no lock: the organizer check and the row read are plain reads, so a lookup can
 * never queue behind (or hold up) a begin/complete that holds the trip row. Only when it finds a pending turn whose lease has expired does it take the
 * trip row and then the turn row, in the same order as begin, to fail that turn lazily.
 */
export async function findCoordinatorTurnByCommand(identifier: string, commandId: string, options: PollRepositoryOptions & { now?: Date }): Promise<CoordinatorTurnRecord | null> {
  z.string().uuid().parse(commandId);
  const now = options.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  const owned = (eventId: string) => and(eq(coordinatorTurns.commonsId, eventId), eq(coordinatorTurns.ownerPersonId, options.actorPersonId), eq(coordinatorTurns.commandId, commandId));
  try {
    return await database.db.transaction(async tx => {
      const eventId = await requireTripOrganizer(tx, identifier, options.actorPersonId, false);
      const [row] = await tx.select().from(coordinatorTurns).where(owned(eventId));
      if (!row || !row.threadId) return null;
      const life = lifecycleOf(row);
      const expired = life.status === "pending" && life.leaseExpiresAt !== null && new Date(life.leaseExpiresAt) <= now;
      if (!expired) return toRecord(tx, row);
      // Lock in begin's order (trip, then turn), then re-read: another request may have completed or reclaimed it meanwhile.
      await requireTripOrganizer(tx, identifier, options.actorPersonId, true);
      const [locked] = await tx.select().from(coordinatorTurns).where(owned(eventId)).for("update");
      if (!locked || !locked.threadId) return null;
      return toRecord(tx, await failExpiredLease(tx, locked, now));
    });
  } finally { await database.close(); }
}

/**
 * The organizer's in-flight turns for a trip (optionally one thread), newest first, for reload recovery. Without a
 * dedicated partial index this is a bounded query: it is scoped by `commons_id` (the leading column of the existing
 * owner/command unique index), by the current organizer, and capped at 20 rows; the pending filter reads the row's own
 * jsonb, so the cost is one index range over this organizer's turns in this trip, not the table. Expired leases are failed on read.
 */
export async function listPendingCoordinatorTurns(identifier: string, options: PollRepositoryOptions & { threadId?: string; now?: Date; limit?: number }): Promise<CoordinatorTurnRecord[]> {
  const now = options.now ?? new Date(), limit = Math.min(Math.max(options.limit ?? 20, 1), 20);
  if (options.threadId) z.string().uuid().parse(options.threadId);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const eventId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
      const rows = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, eventId), eq(coordinatorTurns.ownerPersonId, options.actorPersonId),
        eq(coordinatorTurns.organizerShared, true), sql`${turnStatusSql} = 'pending'`, options.threadId ? eq(coordinatorTurns.threadId, options.threadId) : undefined))
        .orderBy(desc(coordinatorTurns.createdAt)).limit(limit).for("update");
      const live: CoordinatorTurnRecord[] = [];
      for (const row of rows) {
        const current = await failExpiredLease(tx, row, now);
        if (lifecycleOf(current).status === "pending" && current.threadId) live.push(await toRecord(tx, current));
      }
      return live;
    });
  } finally { await database.close(); }
}

async function lockPendingTurn(tx: CommandTransaction, eventId: string, actorId: string, input: { turnId: string; commandId: string; attempt: number }) {
  const [row] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.id, input.turnId), eq(coordinatorTurns.commonsId, eventId),
    eq(coordinatorTurns.ownerPersonId, actorId), eq(coordinatorTurns.commandId, input.commandId))).for("update");
  if (!row) throw new CoordinatorTurnError("artifact_missing");
  return row;
}

/** Attempt-guarded: a stale attempt, or a turn that already finished, is returned unchanged. */
async function markFailed(tx: CommandTransaction, row: TurnRow, attempt: number, errorCode: CoordinatorErrorCode, marker: Pick<CoordinatorWorkspace, "stop" | "interruption"> = {}) {
  const life = lifecycleOf(row);
  if (life.status !== "pending" || life.attempt !== attempt) return row;
  return await transition(tx, row, life, failedLifecycle(life, errorCode), { workspace: failedWorkspace(row, marker) }) ?? row;
}

/** Server-only provenance for a task operation initiated by an in-flight turn. Never parsed from a client command. */
export type CoordinatorTurnFence = { commandId: string; attempt: number; deadlineAt?: number; execution?: { token: string } };

/** Call after locking the trip and before task/goal rows. Hold the turn lock until the mutation commits, so Stop and the operation serialize. */
export async function assertCoordinatorTurnFenceInTransaction(tx: CommandTransaction, tripId: string, actorPersonId: string, fence?: CoordinatorTurnFence) {
  if (!fence) return;
  const [row] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, tripId),
    eq(coordinatorTurns.ownerPersonId, actorPersonId), eq(coordinatorTurns.commandId, fence.commandId))).for("update");
  if (!row) throw new CoordinatorTurnError("provider_failed");
  const life = lifecycleOf(row), now = Date.now();
  if (life.status !== "pending" || life.attempt !== fence.attempt || !life.leaseExpiresAt || Date.parse(life.leaseExpiresAt) <= now ||
      (fence.deadlineAt !== undefined && fence.deadlineAt <= now) ||
      !await turnExecutionClaimIsCurrentInTransaction(tx, row.id, fence.attempt, fence.execution?.token)) throw new CoordinatorTurnError("provider_failed");
}

export type CoordinatorTurnStopOutcome = "stopped" | "already_completed" | "already_finished";

/**
 * Durable Stop (CONVERSATION-DURABILITY-BUILD-PLAN.md A1). Author-scoped: only the organizer who sent the command can stop it, and it works after a
 * membership loss like `failCoordinatorTurn`. Under the turn row lock it either ends the current pending attempt (recorded as an unfinished reply plus a
 * `stop` marker, so the version before this one still reads it) or reports that the attempt already finished. Completion takes the same row lock and is
 * attempt-guarded, so exactly one of Stop and commit wins, whichever instance runs it. A committed result is never undone. A stop of an attempt that is
 * already stopped replays `stopped`.
 */
export async function stopCoordinatorTurn(identifier: string, input: { commandId: string; now?: Date }, options: PollRepositoryOptions): Promise<{ outcome: CoordinatorTurnStopOutcome; turn: CoordinatorTurnRecord }> {
  z.string().uuid().parse(input.commandId);
  const now = input.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [event] = await tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
      if (!event) throw new CoordinatorTurnError("membership_lost");
      const [found] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, event.id), eq(coordinatorTurns.ownerPersonId, options.actorPersonId), eq(coordinatorTurns.commandId, input.commandId))).for("update");
      if (!found || !found.threadId) throw new CoordinatorTurnError("artifact_missing");
      const row = await failExpiredLease(tx, found, now), life = lifecycleOf(row);
      if (life.status === "completed") return { outcome: "already_completed" as const, turn: await toRecord(tx, row) };
      if (life.status === "failed") return { outcome: row.workspace?.stop?.attempt === life.attempt ? "stopped" as const : "already_finished" as const, turn: await toRecord(tx, row) };
      const stopped = await markFailed(tx, row, life.attempt, "provider_failed", { stop: { attempt: life.attempt, requestedAt: now.toISOString() } });
      // Any executor holding this attempt loses its claim in the same transaction; its renewal and its commit are both refused from here on.
      await closeTurnExecutionInTransaction(tx, row.id, life.attempt, "cancelled", "stopped", now);
      return { outcome: "stopped" as const, turn: await toRecord(tx, stopped) };
    });
  } finally { await database.close(); }
}

/**
 * Ends a pending attempt that its own executor can no longer finish (deadline, emergency stop, lost provider work). Author-scoped and attempt-guarded;
 * an attempt that already finished is returned unchanged.
 */
export async function interruptCoordinatorTurn(identifier: string, input: { turnId: string; commandId: string; attempt: number; reason: NonNullable<CoordinatorWorkspace["interruption"]>["reason"]; errorCode?: CoordinatorErrorCode; now?: Date; execution?: { token: string } }, options: PollRepositoryOptions): Promise<CoordinatorTurnRecord> {
  const now = input.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [event] = await tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
      if (!event) throw new CoordinatorTurnError("membership_lost");
      const row = await lockPendingTurn(tx, event.id, options.actorPersonId, input);
      // A stale executor (its claim was taken over or ended) cannot end the attempt another executor now holds.
      if (!await turnExecutionClaimIsCurrentInTransaction(tx, row.id, input.attempt, input.execution?.token)) return toRecord(tx, row);
      const failed = await markFailed(tx, row, input.attempt, input.errorCode ?? (input.reason === "deadline" ? "provider_failed" : "internal_error"), { interruption: { attempt: input.attempt, at: now.toISOString(), reason: input.reason } });
      await finishTurnExecutionInTransaction(tx, row.id, input.attempt, "interrupted", input.reason, now);
      return toRecord(tx, failed);
    });
  } finally { await database.close(); }
}

/**
 * Cheap fence for an executor: is this attempt still the live one (pending, same attempt, lease not expired)? Read-only and lock-free. It only saves
 * work: the commit itself is what decides, under the row lock.
 */
export async function coordinatorTurnAttemptIsLive(identifier: string, input: { commandId: string; attempt: number; now?: Date }, options: PollRepositoryOptions): Promise<boolean> {
  const now = input.now ?? new Date();
  const database = createDatabase(options.databaseUrl);
  try {
    const [event] = await database.db.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
    if (!event) return false;
    const [row] = await database.db.select({ workspace: coordinatorTurns.workspace, createdAt: coordinatorTurns.createdAt }).from(coordinatorTurns)
      .where(and(eq(coordinatorTurns.commonsId, event.id), eq(coordinatorTurns.ownerPersonId, options.actorPersonId), eq(coordinatorTurns.commandId, input.commandId))).limit(1);
    if (!row) return false;
    const life = lifecycleOf(row);
    return life.status === "pending" && life.attempt === input.attempt && life.leaseExpiresAt !== null && new Date(life.leaseExpiresAt) > now;
  } finally { await database.close(); }
}

/** Associate a routed plain-language request before inference. No generated output
 * is persisted here; the same active-organizer, draft-version and attempt fences
 * used by completion apply. This is a server port, not a client command.
 */
export async function associateItineraryInstruction(identifier: string, input: { turnId: string; commandId: string; attempt: number; threadId: string; baseVersion: number }, options: PollRepositoryOptions) {
  const database = createDatabase(options.databaseUrl);
  try { await database.db.transaction(async tx => {
    const eventId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    const row = await lockPendingTurn(tx, eventId, options.actorPersonId, input), life = lifecycleOf(row);
    if (row.threadId !== input.threadId || life.status !== "pending" || life.attempt !== input.attempt || !life.leaseExpiresAt || new Date(life.leaseExpiresAt) <= new Date()) throw new CoordinatorTurnError("stale_version");
    const previous = await latestItinerary(tx, eventId, input.threadId);
    if ((previous?.draft.version ?? 0) !== input.baseVersion) throw new CoordinatorTurnError("stale_version");
    const itineraryInstruction = { draftId: previous?.draft.id ?? null, baseVersion: input.baseVersion };
    if (row.workspace?.itineraryInstruction && JSON.stringify(row.workspace.itineraryInstruction) !== JSON.stringify(itineraryInstruction)) throw new CoordinatorTurnError("stale_version");
    await transition(tx, row, life, life, { workspace: { ...row.workspace, itineraryInstruction } });
  }); } finally { await database.close(); }
}

/** Marks the pending attempt failed. Works even after membership loss, but only for the turn's own author. */
export async function failCoordinatorTurn(identifier: string, input: { turnId: string; commandId: string; attempt: number; errorCode: CoordinatorErrorCode; now?: Date; execution?: { token: string } }, options: PollRepositoryOptions): Promise<CoordinatorTurnRecord> {
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const [event] = await tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).limit(1);
      if (!event) throw new CoordinatorTurnError("membership_lost");
      const row = await lockPendingTurn(tx, event.id, options.actorPersonId, input);
      if (!await turnExecutionClaimIsCurrentInTransaction(tx, row.id, input.attempt, input.execution?.token)) return toRecord(tx, row);
      const failed = await markFailed(tx, row, input.attempt, input.errorCode);
      await finishTurnExecutionInTransaction(tx, row.id, input.attempt, "interrupted", "failed", input.now ?? new Date());
      return toRecord(tx, failed);
    });
  } finally { await database.close(); }
}

/** Facts a proposal was built from must still be current at commit; anything else is a stale_version, never an overwrite. */
async function tripProposalBaseIsCurrent(tx: CommandTransaction, eventId: string, proposal: NonNullable<CoordinatorWorkspace["tripProposal"]>) {
  const [current] = await tx.select().from(commons).where(eq(commons.id, eventId));
  const { base, operations } = proposal;
  if (operations.includes("budget") && current.targetBudgetCents !== base.budgetCents) return false;
  if (operations.includes("dates") && (current.startsOn !== base.startsOn || current.endsOn !== base.endsOn)) return false;
  if (operations.includes("destination") && current.locationName !== base.locationName) return false;
  if (operations.includes("stay") && base.stay?.id) {
    const [stay] = await tx.select({ updatedAt: stays.updatedAt }).from(stays).where(and(eq(stays.id, base.stay.id), eq(stays.commonsId, eventId)));
    if (!stay || stay.updatedAt.toISOString() !== base.stay.updatedAt) return false;
  }
  if (operations.includes("plan") && base.plan?.id) {
    const [item] = await tx.select({ updatedAt: itineraryItems.updatedAt }).from(itineraryItems).where(and(eq(itineraryItems.id, base.plan.id), eq(itineraryItems.commonsId, eventId)));
    if (!item || item.updatedAt.toISOString() !== base.plan.updatedAt) return false;
  }
  return true;
}

/**
 * Saves the answer for a pending attempt. If membership was lost meanwhile, or a fact the proposal
 * was based on moved, the turn fails instead and no answer or proposal is saved.
 */
export async function completeCoordinatorTurn(identifier: string, input: { turnId: string; commandId: string; attempt: number; outcome: PersistableTurnOutcome; now?: Date; /** The executor's claim (A2). A stale claim saves nothing. */ execution?: { token: string } }, options: PollRepositoryOptions): Promise<CoordinatorTurnRecord> {
  const now = input.now ?? new Date(), { outcome } = input;
  z.string().trim().min(1).max(4000).parse(outcome.assistantText);
  z.string().max(COORDINATOR_MAX_SPOKEN_REPLY * 4).parse(outcome.spokenReply);
  // The lifecycle and thread state are owned by this repository; a caller can never supply them.
  const { lifecycle: _ignoredLifecycle, threadState: _ignoredThreadState, activityReceipt: _ignoredActivityReceipt, itineraryDocumentReceipt: _ignoredItineraryReceipt, stop: _ignoredStop, interruption: _ignoredInterruption, ...metadata } = CoordinatorWorkspaceSchema.parse(outcome.workspace ?? {});
  const sources = z.array(TurnSourceRefSchema).max(20).parse(outcome.sources);
  const database = createDatabase(options.databaseUrl);
  try {
    return await database.db.transaction(async tx => {
      const standing = await resolveTripActor(tx, identifier, options.actorPersonId, true);
      if (!standing.eventId) throw new CoordinatorTurnError("membership_lost");
      const eventId = standing.eventId;
      const row = await lockPendingTurn(tx, eventId, options.actorPersonId, input), life = lifecycleOf(row);
      // Another attempt (or a lease expiry) already moved this turn: return what is stored, save nothing.
      if (life.status !== "pending" || life.attempt !== input.attempt) return toRecord(tx, row);
      // An executor whose claim was taken over, stopped or expired cannot publish, even for the same attempt (A07).
      if (!await turnExecutionClaimIsCurrentInTransaction(tx, row.id, input.attempt, input.execution?.token)) return toRecord(tx, row);
      if (standing.failure) { const failed = await markFailed(tx, row, input.attempt, standing.failure); await finishTurnExecutionInTransaction(tx, row.id, input.attempt, "interrupted", standing.failure, now); return toRecord(tx, failed); }
      const [thread] = await tx.select().from(coordinatorThreads).where(eq(coordinatorThreads.id, row.threadId!)).for("update");
      if (!thread) return toRecord(tx, await markFailed(tx, row, input.attempt, "thread_unavailable"));

      if (metadata.pollReview) {
        const [saved] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.commonsId,eventId),eq(pollDrafts.id,metadata.pollReview.draftId))).for("update");
        if (!saved || saved.threadId !== thread.id || !canEditCoordinatorDraft(saved,options.actorPersonId,"organizer") || saved.archivedAt || saved.publishedPollId || saved.data.privateItineraryDocument || saved.data.questions.some(question=>question.kind==="choice" && question.itinerary)) return toRecord(tx,await markFailed(tx,row,input.attempt,"artifact_misassociated"));
        if (saved.version !== metadata.pollReview.version) return toRecord(tx,await markFailed(tx,row,input.attempt,"stale_version"));
      }
      if (metadata.tripProposal && !await tripProposalBaseIsCurrent(tx, eventId, metadata.tripProposal)) {
        return toRecord(tx, await markFailed(tx, row, input.attempt, "stale_version"));
      }
      if (metadata.taskProposal && !await tripTaskProposalIsCurrent(tx, eventId, thread.id, metadata.taskProposal, options.actorPersonId)) {
        return toRecord(tx, await markFailed(tx, row, input.attempt, "stale_version"));
      }
      if (metadata.itineraryDraft) {
        const previous = await latestItinerary(tx, eventId, thread.id), next = metadata.itineraryDraft;
        if (previous?.draft.workflow && !workflowReferencePreserved(previous.draft.workflow, next.workflow)) {
          return toRecord(tx, await markFailed(tx, row, input.attempt, "stale_version"));
        }
        if (next.workflow && (await resolveWorkflowTemplateInTransaction(tx, next.workflow.key, next.workflow)).purpose !== "itinerary") {
          return toRecord(tx, await markFailed(tx, row, input.attempt, "invalid_request"));
        }
        if (next.threadId !== thread.id || next.version !== (previous?.draft.version ?? 0) + 1 ||
          (previous && (next.id !== previous.draft.id || next.ownerId !== previous.draft.ownerId)) ||
          (!previous && next.ownerId !== options.actorPersonId) ||
          (await itineraryFacts(tx, eventId)).factsFingerprint !== next.factsFingerprint) {
          return toRecord(tx, await markFailed(tx, row, input.attempt, "stale_version"));
        }
      }
      if (metadata.proposal?.itineraryBasis && !await itineraryPlanningBasisIsCurrent(tx, eventId, metadata.proposal.itineraryBasis)) {
        return toRecord(tx, await markFailed(tx, row, input.attempt, "stale_version"));
      }

      let privateEdit = outcome.privateItineraryEdit;
      if (privateEdit) {
        const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.commonsId, eventId), eq(pollDrafts.id, privateEdit.id))).for("update");
        const data = PollWorkingDataSchema.parse(privateEdit.data);
        const originalQuestion = draft?.data.questions.find(question => question.kind === "choice" && question.itinerary);
        const editedQuestion = data.questions.find(question => question.kind === "choice" && question.itinerary);
        if (!draft || row.draftId !== draft.id || !canEditCoordinatorDraft(draft, options.actorPersonId, "organizer") || draft.publishedPollId || draft.archivedAt || draft.data.privateItineraryDocument || await isGeneratedItineraryProjection(tx, eventId, draft.id) || data.privateItineraryDocument || !originalQuestion || editedQuestion?.id !== originalQuestion.id || outcome.newDraft || metadata.proposal || metadata.itineraryDraft || outcome.linkIdea || outcome.attendanceStatement || outcome.createThread) return toRecord(tx, await markFailed(tx, row, input.attempt, "artifact_misassociated"));
        if (draft.version !== privateEdit.baseVersion || !await itineraryPlanningBasisIsCurrent(tx, eventId, ItineraryPlanningBasisSchema.parse(privateEdit.basis))) return toRecord(tx, await markFailed(tx, row, input.attempt, "stale_version"));
        privateEdit = { ...privateEdit, data };
      }
      // Every check that can fail the turn runs before anything is written: a failed turn is marked inside this transaction, which still commits.
      const idea = outcome.linkIdea ? (await tx.select({ id: itineraryItems.id, title: itineraryItems.title }).from(itineraryItems)
        .where(and(eq(itineraryItems.id, outcome.linkIdea.itineraryItemId), eq(itineraryItems.commonsId, eventId))).limit(1))[0] : undefined;
      if (outcome.linkIdea && !idea) return toRecord(tx, await markFailed(tx, row, input.attempt, "artifact_missing"));
      // Ids derived from a command are scoped to the trip and organizer, so these cannot collide in practice. If one somehow did, the turn fails with a
      // stable code (nothing is written) instead of surfacing a primary-key error as a retryable provider failure.
      if (outcome.createThread && (await tx.select({ id: coordinatorThreads.id }).from(coordinatorThreads).where(eq(coordinatorThreads.id, outcome.createThread.id)).limit(1)).length) return toRecord(tx, await markFailed(tx, row, input.attempt, "command_mismatch"));
      if (outcome.newDraft && (await tx.select({ id: pollDrafts.id }).from(pollDrafts).where(eq(pollDrafts.id, outcome.newDraft.id)).limit(1)).length) return toRecord(tx, await markFailed(tx, row, input.attempt, "command_mismatch"));
      // A direct activity command cannot be combined with model proposals or artifact mutations.
      const activities = metadata.capability === "add_activities" ? parseOrganizerActivities(row.userText) : null;
      if (metadata.capability === "add_activities" && (!activities || outcome.newDraft || outcome.createThread || outcome.linkIdea || outcome.attendanceStatement || metadata.proposal || metadata.tripProposal || outcome.threadUpdate)) {
        return toRecord(tx, await markFailed(tx, row, input.attempt, "command_mismatch"));
      }
      let draftId = row.draftId, draftVersion: number | null = null;
      if (outcome.newDraft) {
        // A selected artifact is context, not a permanent conversation mode.
        // A new private poll may replace this turn's association, never its old record.
        if (draftId && (metadata.capability !== "prepare_poll" || metadata.proposal || metadata.itineraryDraft || privateEdit || outcome.createThread || outcome.linkIdea)) return toRecord(tx, await markFailed(tx, row, input.attempt, "artifact_misassociated"));
        // Validate before writing: a failed turn is marked failed inside this transaction, which still commits, so nothing may be created first.
        if (metadata.proposal && (metadata.proposal.baseVersion !== 1 || metadata.proposal.state !== "pending")) return toRecord(tx, await markFailed(tx, row, input.attempt, "stale_version"));
        const draft = await saveCommonsPollDraftInTransaction(tx, eventId, { id: outcome.newDraft.id, commandId: input.commandId, expectedVersion: 0, data: PollWorkingDataSchema.parse(outcome.newDraft.data) }, options, { threadId: thread.id });
        draftId = draft.id; draftVersion = draft.version;
      }
      if (metadata.proposal) {
        const [draft] = draftId ? await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, draftId), eq(pollDrafts.commonsId, eventId))) : [];
        if (!draft || draft.publishedPollId || draft.archivedAt || metadata.proposal.state !== "pending" || metadata.proposal.baseVersion !== (draftVersion ?? draft.version)) {
          return toRecord(tx, await markFailed(tx, row, input.attempt, "stale_version"));
        }
      }
      let workspaceOut: CoordinatorWorkspace = metadata;
      if (privateEdit) {
        const saved = await saveCommonsPollDraftInTransaction(tx, eventId, { id: privateEdit.id, commandId: input.commandId, expectedVersion: privateEdit.baseVersion, data: privateEdit.data }, options, undefined, "coordinator");
        workspaceOut = { ...workspaceOut, itineraryDocumentReceipt: { documentId: saved.id, version: saved.version, commandId: input.commandId } };
      }
      if (outcome.createThread) {
        const created = outcome.createThread, title = boundedThreadTitle(created.title) || "New conversation";
        await tx.insert(coordinatorThreads).values({ id: created.id, commonsId: eventId, createdByPersonId: options.actorPersonId, title,
          lastCommandId: created.commandId, lastCommandFingerprint: commandFingerprint(options.actorPersonId, "coordinator.thread_created_by_navigation", { threadId: created.id, commandId: input.commandId }), createdAt: now, updatedAt: now });
        workspaceOut = { ...workspaceOut, navigation: { kind: "created", threadId: created.id, title } };
      }
      let linkedIdeaAnswer: string | null = null, threadVersion = thread.version;
      if (idea) {
        const [existingLink] = await tx.select({ id: coordinatorThreadIdeas.id }).from(coordinatorThreadIdeas)
          .where(and(eq(coordinatorThreadIdeas.threadId, thread.id), eq(coordinatorThreadIdeas.itineraryItemId, idea.id))).limit(1);
        if (existingLink) linkedIdeaAnswer = `“${idea.title.slice(0, 120)}” is already linked to this thread. Nothing changed.`;
        else {
          const [link] = await tx.insert(coordinatorThreadIdeas).values({ threadId: thread.id, itineraryItemId: idea.id, linkedByPersonId: options.actorPersonId, commandId: input.commandId }).returning();
          workspaceOut = { ...workspaceOut, linkedIdea: { linkId: link.id, itineraryItemId: idea.id, title: idea.title.slice(0, 200) } };
          // Linking changes thread metadata (its linked ideas), so the metadata version moves like the explicit link action.
          threadVersion += 1;
        }
      }

      let assistantText = linkedIdeaAnswer ?? outcome.assistantText, spokenReply = linkedIdeaAnswer ?? outcome.spokenReply;
      if (workspaceOut.taskProposal?.quickAdd) {
        // Only the initiating human slash command can authorize immediate creation.
        const proposal = workspaceOut.taskProposal;
        if (!/^\/task\s+\S/i.test(row.userText.trim()) || proposal.task.expectedVersion !== 0 || proposal.version !== 1 || proposal.requestedBy !== options.actorPersonId || proposal.task.ownerPersonId !== options.actorPersonId) throw new CoordinatorTurnError("invalid_request");
        const saved = await saveTripTaskInTransaction(tx, eventId, proposal.task, options);
        workspaceOut = { ...workspaceOut, taskProposal: { ...proposal, state: "applied", receipt: { id: saved.id, version: saved.version, at: now.toISOString(), appliedBy: options.actorPersonId } } };
        assistantText = `Added your task: ${saved.title}.`;
        spokenReply = assistantText;
      }
      if (workspaceOut.itineraryDocumentReceipt) {
        assistantText = `Saved itinerary version ${workspaceOut.itineraryDocumentReceipt.version}. Open Work to review the current document. Nothing has been shared.`;
        spokenReply = assistantText;
      }
      if (outcome.attendanceStatement && reportsOwnAttendance(row.userText)) {
        assistantText = await recordAttendanceStatementInTransaction(tx, eventId, options.actorPersonId, row.userText, input.commandId, workspaceOut);
        spokenReply = assistantText;
      }
      if (metadata.capability === "invite_people") {
        const [previous] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.threadId,thread.id),sql`${coordinatorTurns.sequence} < ${row.sequence}`)).orderBy(desc(coordinatorTurns.sequence)).limit(1);
        const awaitingList = previous?.ownerPersonId === row.ownerPersonId ? CoordinatorWorkspaceSchema.safeParse(previous.workspace) : null;
        let request = parseOrganizerInvites(row.userText, awaitingList?.success && awaitingList.data.invitationRequest === true && (!awaitingList.data.lifecycle || awaitingList.data.lifecycle.status === "completed"));
        // An explicit “invite them” may refer only to this organizer’s immediately preceding,
        // address-only message. Never extract recipients from other people or arbitrary history.
        if (previous?.ownerPersonId === row.ownerPersonId && /^(?:(?:can|could|would) you\s+)?(?:please\s+)?invite\s+(?:them|these people)(?:\s+to (?:this|the|our) trip)?[.!?]?$/i.test(row.userText.trim())) {
          const priorList = parseOrganizerInvites(previous.userText, true);
          if (priorList && !priorList.error) request = priorList;
        }
        if (!request || request.error) {
          assistantText = request?.error ?? "Please ask me to invite the specific email addresses as Travelers.";
          workspaceOut = {...workspaceOut, invitationRequest: Boolean(request?.error && !request.error.startsWith("Paste only"))};
        } else if (request.review) {
          workspaceOut = {...workspaceOut, invitationRequest:false, invitationReview:request.recipients};
          assistantText = "Review these travelers below. Approving sends standard Traveler invitations; it does not make them organizers or confirm attendance.";
        } else {
          const receipt = await inviteCoordinatorRecipientsInTransaction(tx,eventId,request.recipients,options);
          workspaceOut = {...workspaceOut,invitationRequest:false,invitationReceipt:receipt};
          assistantText = [
            receipt.some(item=>item.status === "queued") ? `Queued invitation emails as Travelers to: ${receipt.filter(item=>item.status === "queued").map(item=>item.email).join(", ")}. Check People for delivery status.` : null,
            receipt.some(item=>item.status === "already_invited") ? `Already invited (no duplicate email): ${receipt.filter(item=>item.status === "already_invited").map(item=>item.email).join(", ")}.` : null,
            receipt.some(item=>item.status === "already_member") ? `Already on this trip: ${receipt.filter(item=>item.status === "already_member").map(item=>item.email).join(", ")}.` : null,
          ].filter(Boolean).join("\n");
        }
        spokenReply = assistantText;
      }
      if (metadata.capability === "add_activities") {
        if (activities!.error) assistantText = activities!.error;
        else {
          const receipt = await addCoordinatorActivitiesInTransaction(tx, {
            tripId: eventId, actorPersonId: options.actorPersonId, turnId: row.id, commandId: row.commandId, userText: row.userText,
          });
          workspaceOut = { ...workspaceOut, activityReceipt: receipt };
          assistantText = activityReceiptReply(receipt);
        }
        spokenReply = assistantText;
      }
      const meta = (await readThreadMeta(tx, eventId, [thread])).get(thread.id)!, update = outcome.threadUpdate;
      // A generated title is only ever applied when completing the thread's first turn, and only while the thread still carries that turn's provisional title.
      const generatedTitle = update?.topicTitle && row.sequence === 1 && meta.titleSource === "provisional" ? boundedThreadTitle(update.topicTitle) : "";
      // Thread summary, open questions and the generated title live in the newest workspace.threadState; nothing is written when the turn changes none of them.
      const threadState = update?.summary !== undefined || update?.openQuestions !== undefined || generatedTitle
        ? buildThreadState(meta.state, { summary: update?.summary, openQuestions: update?.openQuestions, generatedTitle: generatedTitle || undefined }, row.sequence) : null;
      if (metadata.itineraryDraft) {
        const previous = await latestItinerary(tx, eventId, thread.id);
        await recordCoordinatorItineraryRevision(tx, eventId, row.commandId, previous?.draft ?? null, metadata.itineraryDraft, options);
        assistantText = previous && itineraryContentEqual(previous.draft.content, metadata.itineraryDraft.content) ? "No wording change was produced. The saved itinerary is unchanged; try a more specific edit or edit it in Work." : `Saved itinerary version ${metadata.itineraryDraft.version}. Open Work to review the current document.`;
        spokenReply = assistantText;
      }
      const completedAt = now.toISOString();
      const completed = await transition(tx, row, life, { ...life, status: "completed", errorCode: null, leaseExpiresAt: null, completedAt,
        spokenReply: spokenReply.slice(0, COORDINATOR_MAX_SPOKEN_REPLY), sources },
        { assistantText: assistantText.slice(0, 4000), workspace: threadState ? { ...workspaceOut, threadState } : workspaceOut, draftId });
      // The row lock and the attempt guard make this unreachable; if it ever fires the whole transaction rolls back.
      if (!completed) throw new CoordinatorTurnError("internal_error");
      await finishTurnExecutionInTransaction(tx, row.id, input.attempt, "completed", "completed", now);

      if (metadata.research) await tx.insert(coordinatorResearchRuns).values({ threadId: thread.id, createdByPersonId: options.actorPersonId, commandId: input.commandId,
        query: metadata.research.query, status: metadata.research.status, sources: metadata.research.sources, limitations: metadata.research.limitations }).onConflictDoNothing();

      const threadChanges: Partial<typeof coordinatorThreads.$inferInsert> = { updatedAt: now };
      // A generated title replaces only the safe provisional one, once, and never an organizer's title.
      if (generatedTitle) { threadChanges.title = generatedTitle; threadVersion += 1; }
      if (threadVersion !== thread.version) threadChanges.version = threadVersion;
      await tx.update(coordinatorThreads).set(threadChanges).where(eq(coordinatorThreads.id, thread.id));
      return toRecord(tx, completed);
    });
  } finally { await database.close(); }
}
import { itineraryFacts, latestItinerary, recordCoordinatorItineraryRevision } from "./research-itinerary-repository";

/** Lifecycle writes the execution repository needs while it holds the turn row lock (it never builds lifecycles itself). */
export const turnExecutionHooks: TurnExecutionHooks = {
  interrupt: (tx, row, attempt, reason, errorCode, now) => markFailed(tx, row, attempt, errorCode, { interruption: { attempt, at: now.toISOString(), reason } }),
  extendLease: async (tx, row, attempt, until) => {
    const life = lifecycleOf(row);
    if (life.status !== "pending" || life.attempt !== attempt || (life.leaseExpiresAt && new Date(life.leaseExpiresAt) >= until)) return row;
    return transition(tx, row, life, { ...life, leaseExpiresAt: until.toISOString() });
  },
};
