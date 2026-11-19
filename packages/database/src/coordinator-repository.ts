import { assertGoalProposalCurrent, projectGoalEventInTransaction } from "./coordinator-goal-repository";
import { assertParticipantEvidenceCurrent } from "./participant-question-repository";
import { actOnItinerary } from "./research-itinerary-repository";
import { actOnCoordinatorTripTask } from "./coordinator-trip-task-repository";
import { attendanceStatementTargets, eventAttendanceDates, formatTripDateRange, reportsOwnAttendance, AddStayCommandSchema, CoordinatorSettingsSchema, CoordinatorSettingsRequestSchema, CoordinatorThreadSchema, CoordinatorTurnRequestSchema, CoordinatorWorkspaceSchema, CoordinatorWorkspaceActionSchema, CoordinatorThreadIdeaActionSchema, CreateCoordinatorThreadSchema, UpdateCoordinatorThreadSchema, PollWorkingDataSchema, UpdateCommonsDetailsRequestSchema, UpdateStayCommandSchema, UpdateTargetBudgetCommandSchema, planNoteToSave, zonedLocalToInstant, type CoordinatorWorkspace, type CoordinatorTurnRequest, type PollAnswer, type PollWorkingData, type TripChangeProposal } from "@commons/contracts";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { itineraryPlanningBasisIsCurrent } from "./itinerary-planning-basis";
import { createDatabase } from "./client";
import { commandFingerprint, CommandConflictError, type CommandTransaction } from "./event-command";
import { CoordinatorAccessError, CoordinatorConflictError } from "./coordinator-errors";
import { isCommonsId } from "./commons-identifier";
import { isPlanningGoalDraft } from "./coordinator-draft-access";
import { auditEvents, commons, coordinatorPreferences, coordinatorResearchRuns, coordinatorThreadIdeas, coordinatorThreads, coordinatorTurns, itineraryItems, memberships, people, pollDrafts, polls, pollResponses, processedCommands, stays, stayParticipants } from "./schema";
import { saveCommonsPollDraftInTransaction } from "./poll-draft-repository";
import { PollInferenceLimitError } from "./poll-inference-repository";
import type { PollRepositoryOptions } from "./poll-repository";
import { pollResultsAreVisible } from "./poll-repository";
import { lifecycleOf, readThreadMeta, turnLifecycleView } from "./coordinator-turn-lifecycle";
import { annotateLodgingFreshness, assertLodgingReviewCurrent, continueLodgingAfterApply } from "./lodging-continuation";

async function organizer(tx: CommandTransaction, identifier: string, personId: string) {
  const [event] = await tx.select({ id: commons.id }).from(commons).where(isCommonsId(identifier) ? eq(commons.id, identifier) : eq(commons.slug, identifier)).for("update");
  const [member] = event ? await tx.select().from(memberships).where(and(eq(memberships.commonsId, event.id), eq(memberships.personId, personId))) : [];
  if (!event || member?.status !== "active") throw new CoordinatorAccessError("membership_lost");
  if (member.role !== "organizer") throw new CoordinatorAccessError("organizer_required");
  return event.id;
}
// Defense in depth: the query itself requires active organizer membership, in
// addition to organizer() checking that role under the event lock at every entry.
function organizerGuard(event: string, actor: string) {
  return sql`exists (select 1 from ${memberships} where ${memberships.commonsId} = ${event} and ${memberships.personId} = ${actor} and ${memberships.status} = 'active' and ${memberships.role} = 'organizer')`;
}
function scope(event: string, options: PollRepositoryOptions, threadId?: string) {
  return and(organizerGuard(event, options.actorPersonId), eq(coordinatorTurns.commonsId, event),
    threadId ? and(eq(coordinatorTurns.threadId, threadId), eq(coordinatorTurns.organizerShared, true)) : and(isNull(coordinatorTurns.threadId), eq(coordinatorTurns.organizerShared, Boolean(options.sharedCoordinator)), options.sharedCoordinator ? undefined : eq(coordinatorTurns.ownerPersonId, options.actorPersonId)));
}
async function thread(tx: CommandTransaction, event: string, threadId: string, lock = false) {
  const query = tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, threadId), eq(coordinatorThreads.commonsId, event))).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new CoordinatorAccessError("thread_unavailable");
  return row;
}
async function version(tx: CommandTransaction, event: string, options: PollRepositoryOptions, threadId?: string) {
  const [row] = await tx.select({ value: sql<number>`coalesce(max(${coordinatorTurns.sequence}), 0)::int` }).from(coordinatorTurns).where(scope(event, options, threadId));
  return row.value;
}
async function currentDraft(tx: CommandTransaction, event: string, options: PollRepositoryOptions, id: string | null, expected: number | null, threadId?: string) {
  if (!id) return null;
  const [draft] = await tx.select().from(pollDrafts).where(and(organizerGuard(event, options.actorPersonId), eq(pollDrafts.id, id), eq(pollDrafts.commonsId, event),
    threadId ? and(eq(pollDrafts.organizerShared, true), or(isNull(pollDrafts.threadId), eq(pollDrafts.threadId, threadId))) : and(isNull(pollDrafts.threadId), eq(pollDrafts.organizerShared, Boolean(options.sharedCoordinator)), options.sharedCoordinator ? undefined : eq(pollDrafts.ownerPersonId, options.actorPersonId))));
  if (!draft || !draft.data.communication && !await isPlanningGoalDraft(tx, draft, threadId)) throw new CoordinatorAccessError("artifact_missing");
  if (draft.publishedPollId || draft.version !== expected) throw new CoordinatorConflictError("stale_version");
  return draft;
}
async function replay(tx: CommandTransaction, event: string, options: PollRepositoryOptions, input: CoordinatorTurnRequest) {
  const [existing] = await tx.select().from(coordinatorTurns).where(and(scope(event, options, input.threadId), eq(coordinatorTurns.commandId, input.commandId)));
  if (existing && existing.fingerprint !== commandFingerprint(options.actorPersonId, "coordinator.turn", input)) throw new CommandConflictError();
  return Boolean(existing);
}
async function validateContext(tx: CommandTransaction, event: string, options: PollRepositoryOptions, input: CoordinatorTurnRequest) {
  if ([input.draftId, input.contextPollId, input.contextTurnId].filter(Boolean).length > 1) throw new CommandConflictError();
  if (input.contextPollId) {
    const [poll] = await tx.select({ id: polls.id, threadId: polls.threadId }).from(polls).where(and(eq(polls.id, input.contextPollId), eq(polls.commonsId, event)));
    if (!poll) throw new CoordinatorAccessError("artifact_missing");
    if (input.threadId && poll.threadId && poll.threadId !== input.threadId) throw new CoordinatorAccessError("artifact_misassociated");
  }
  if (input.contextTurnId) {
    const [note] = await tx.select().from(coordinatorTurns).where(and(scope(event, options, input.threadId), eq(coordinatorTurns.id, input.contextTurnId)));
    if (!note?.workspace?.saved) throw new CoordinatorAccessError("artifact_missing");
  }
}
async function threadCommandReplay(tx: CommandTransaction, event: string, commandId: string, fingerprint: string) {
  const [processed] = await tx.select({ result: processedCommands.result }).from(processedCommands)
    .where(and(eq(processedCommands.commonsId, event), eq(processedCommands.commandId, commandId))).limit(1);
  if (!processed) return null;
  const receipt = processed.result as { kind?: string; fingerprint?: string; result?: { id?: string; threadId?: string; version?: number } };
  if (receipt.kind !== "coordinator_thread_command" || receipt.fingerprint !== fingerprint || !receipt.result || !receipt.result.version || !(receipt.result.id || receipt.result.threadId)) throw new CommandConflictError();
  return receipt.result;
}
async function saveThreadCommand(tx: CommandTransaction, event: string, commandId: string, fingerprint: string, result: { id?: string; threadId?: string; version: number }) {
  await tx.insert(processedCommands).values({ commonsId: event, commandId, result: { kind: "coordinator_thread_command", fingerprint, result } });
}
export async function hasCoordinatorTurnReplay(identifier: string, raw: unknown, options: PollRepositoryOptions) {
  const input = CoordinatorTurnRequestSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    return replay(tx, event, options, input);
  }); } finally { await database.close(); }
}

export async function getCoordinatorThread(identifier: string, options: PollRepositoryOptions, before?: number, threadId?: string) {
  if (before !== undefined) z.number().int().positive().parse(before);
  if (threadId !== undefined) z.string().uuid().parse(threadId);
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    if (threadId) await thread(tx, event, threadId);
    const currentVersion = await version(tx, event, options, threadId);
    const rows = await tx.select().from(coordinatorTurns).where(and(scope(event, options, threadId), before === undefined ? undefined : lt(coordinatorTurns.sequence, before))).orderBy(desc(coordinatorTurns.sequence)).limit(51);
    const authors = rows.length ? await tx.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, rows.map(row => row.ownerPersonId))) : [];
    const drafts = await tx.select().from(pollDrafts).where(and(organizerGuard(event, options.actorPersonId), eq(pollDrafts.commonsId, event),
      threadId ? eq(pollDrafts.threadId, threadId) : and(isNull(pollDrafts.threadId), eq(pollDrafts.organizerShared, Boolean(options.sharedCoordinator)), options.sharedCoordinator ? undefined : eq(pollDrafts.ownerPersonId, options.actorPersonId)))).orderBy(asc(pollDrafts.createdAt));
    const priorPolls = await tx.select({ id: polls.id, publicId: polls.publicId, title: polls.title, status: polls.status, ballotMode: polls.ballotMode, audience: polls.audience,
      questions: polls.questions, threadId: polls.threadId, createdAt: polls.createdAt, archivedAt: polls.archivedAt }).from(polls).where(and(eq(polls.commonsId, event), threadId ? eq(polls.threadId, threadId) : undefined)).orderBy(asc(polls.createdAt));
    const responseRows = priorPolls.length ? await tx.select({ pollId: pollResponses.pollId, answers: pollResponses.answers })
      .from(pollResponses).where(inArray(pollResponses.pollId, priorPolls.map(poll => poll.id))) : [];
    const answersByPoll = new Map<string, PollAnswer[][]>();
    for (const response of responseRows) answersByPoll.set(response.pollId, [...(answersByPoll.get(response.pollId) ?? []), response.answers]);
    const replaced=priorPolls.length ? await tx.select({pollId:pollDrafts.publishedPollId}).from(pollDrafts).where(and(eq(pollDrafts.commonsId,event),sql`${pollDrafts.data}->'lifecycle'->>'replacementDraftId' IS NOT NULL`)) : [];
    const threadRows = await tx.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, event)).orderBy(desc(coordinatorThreads.updatedAt));
    const meta = await readThreadMeta(tx, event, threadRows);
    const threadAuthors = threadRows.length ? await tx.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, threadRows.map(row => row.createdByPersonId))) : [];
    const [threadTurns, threadDrafts, threadPolls] = await Promise.all([
      tx.select({ threadId: coordinatorTurns.threadId }).from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, event), isNotNull(coordinatorTurns.threadId))),
      tx.select({ threadId: pollDrafts.threadId }).from(pollDrafts).where(and(eq(pollDrafts.commonsId, event), isNotNull(pollDrafts.threadId))),
      tx.select({ threadId: polls.threadId }).from(polls).where(and(eq(polls.commonsId, event), isNotNull(polls.threadId))),
    ]);
    const linked = await tx.select({ link: coordinatorThreadIdeas, idea: itineraryItems, personName: people.displayName })
      .from(coordinatorThreadIdeas).innerJoin(itineraryItems, eq(itineraryItems.id, coordinatorThreadIdeas.itineraryItemId)).innerJoin(people, eq(people.id, coordinatorThreadIdeas.linkedByPersonId))
      .where(eq(itineraryItems.commonsId, event)).orderBy(asc(coordinatorThreadIdeas.createdAt));
    // A brief whose saved stay changed after approval is shown as out of date; reading never changes the stored record.
    await annotateLodgingFreshness(tx, event, rows.slice(0, 50).map(row => row.workspace));
    const research = threadId ? await tx.select({ run: coordinatorResearchRuns, personName: people.displayName }).from(coordinatorResearchRuns)
      .innerJoin(people, eq(people.id, coordinatorResearchRuns.createdByPersonId)).where(eq(coordinatorResearchRuns.threadId, threadId)).orderBy(asc(coordinatorResearchRuns.createdAt)) : [];
    return CoordinatorThreadSchema.parse({ version: currentVersion, activeThreadId: threadId ?? null, hasEarlier: rows.length > 50,
      threads: threadRows.map(row => ({ ...row, titleSource: meta.get(row.id)?.titleSource, summary: meta.get(row.id)?.state?.summary ?? null, createdByName: threadAuthors.find(author => author.id === row.createdByPersonId)?.name ?? "Organizer",
        turnCount: threadTurns.filter(item => item.threadId === row.id).length, draftCount: threadDrafts.filter(item => item.threadId === row.id).length,
        pollCount: threadPolls.filter(item => item.threadId === row.id).length, archivedAt: row.archivedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
      linkedIdeas: linked.map(({ link, idea, personName }) => ({ id: link.id, threadId: link.threadId, itineraryItemId: idea.id, title: idea.title,
        status: idea.status, provenanceLabel: idea.provenanceLabel, sourceUrl: idea.sourceUrl, linkedByPersonId: link.linkedByPersonId,
        linkedByName: personName, createdAt: link.createdAt.toISOString() })),
      researchRuns: research.map(({ run, personName }) => ({ ...run, createdByName: personName, createdAt: run.createdAt.toISOString() })),
      turns: rows.slice(0, 50).reverse().map(row => ({ ...row, ...turnLifecycleView(row), authorPersonId: row.ownerPersonId, authorName: authors.find(author => author.id === row.ownerPersonId)?.name ?? "Organizer", createdAt: row.createdAt.toISOString() })),
      drafts: drafts.map(row => ({ ...row, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
      polls: priorPolls.map(row => {
        const resultsVisible = pollResultsAreVisible(row.ballotMode, row.status);
        const responses = answersByPoll.get(row.id) ?? [];
        return { itinerary:row.questions.some(question=>question.kind==="choice" && question.itinerary),superseded:replaced.some(draft=>draft.pollId===row.id),id: row.id, threadId: row.threadId, publicId: row.publicId, title: row.title, status: row.status, archivedAt: row.archivedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), audienceRestricted: Boolean(row.audience), responseCount: responses.length, resultsVisible,
          results: resultsVisible ? row.questions.map(question => ({ questionId: question.id, prompt: question.prompt,
            ...(question.kind !== "choice" && question.kind !== "text" ? { formatNotice: "Grouped responses, rankings and points are available on the poll results page. This compact preview does not summarize that format." } : {}),
            options: question.kind === "choice" ? question.options.map(option => ({ optionId: option.id, label: option.label,
              count: responses.filter(answers => answers.some(answer => answer.questionId === question.id && answer.optionIds.includes(option.id))).length })) : [],
            textResponseCount: responses.filter(answers => answers.some(answer => answer.questionId === question.id && Boolean(answer.text))).length,
          })) : [],
        };
      }),
    });
  }); } finally { await database.close(); }
}

export async function reserveCoordinatorInference(identifier: string, raw: unknown, options: PollRepositoryOptions) {
  const input = CoordinatorTurnRequestSchema.parse(raw);
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    if (await replay(tx, event, options, input)) return { replayed: true };
    if (input.threadId && (await thread(tx, event, input.threadId)).status !== "active") throw new CoordinatorConflictError("thread_archived");
    if (await version(tx, event, options, input.threadId) !== input.version) throw new CommandConflictError();
    await currentDraft(tx, event, options, input.draftId, input.draftVersion, input.threadId);
    await validateContext(tx, event, options, input);
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(processedCommands).where(and(eq(processedCommands.commonsId, event), gte(processedCommands.processedAt, new Date(Date.now() - 3600_000)), sql`${processedCommands.result}->>'kind' = 'poll_inference'`));
    if (usage.count >= 10) throw new PollInferenceLimitError();
    await tx.insert(processedCommands).values({ commonsId: event, commandId: crypto.randomUUID(), result: { kind: "poll_inference", actorPersonId: options.actorPersonId } });
    return { replayed: false };
  }); } finally { await database.close(); }
}

/**
 * The approved direct-attendance exception. Runs inside the caller's transaction
 * under the trip lock: clear first-person statements about uniquely identified
 * active travelers are recorded with an attributed receipt (Undo lives on the
 * receipt). Returns the reply text to save; mutates `metadata.attendanceReceipt`.
 */
export async function recordAttendanceStatementInTransaction(tx: CommandTransaction, event: string, actorId: string, prompt: string, commandId: string, metadata: CoordinatorWorkspace) {
  const [details] = await tx.select().from(commons).where(eq(commons.id, event));
  const roster = await tx.select({ personId: memberships.personId, displayName: people.displayName,
    state: memberships.attendanceState, dates: memberships.attendanceDates }).from(memberships)
    .innerJoin(people, eq(people.id, memberships.personId)).where(and(eq(memberships.commonsId, event), eq(memberships.status, "active")));
  const targets = attendanceStatementTargets(prompt, actorId, roster);
  if (!details.startsOn || !details.endsOn) return "Which trip dates are you attending? Set the dates before I record attendance.";
  if (!targets?.length) return "Who do you mean? Name the travelers so I can mark their attendance.";
  const dates = eventAttendanceDates(details.startsOn, details.endsOn), at = new Date();
  const selected = roster.filter(p => targets.includes(p.personId)).sort((a, b) => Number(b.personId === actorId) - Number(a.personId === actorId));
  const changed = selected.filter(p => p.state !== "attending" || p.dates !== dates);
  metadata.attendanceReceipt = { dates, at: at.toISOString(), people: changed.map(p => ({ personId: p.personId, name: p.displayName, previousState: p.state, previousDates: p.dates })) };
  if (changed.length) {
    await tx.update(memberships).set({ attendanceState: "attending", attendanceDates: dates, updatedAt: at })
      .where(and(eq(memberships.commonsId, event), inArray(memberships.personId, changed.map(p => p.personId))));
    await tx.insert(auditEvents).values({ commonsId: event, commandId, actorId,
      actorType: "human", action: "coordinator.attendance_recorded", resourceType: "commons", resourceId: event,
      summary: `${selected.map(p => p.displayName).join(" and ")} marked as attending by ${roster.find(p => p.personId === actorId)?.displayName} for ${dates}.`, occurredAt: at });
  }
  return `${selected.map(p => p.personId === actorId ? "You" : p.displayName).join(" and ")} ${selected.length === 1 && selected[0].personId !== actorId ? "is" : "are"} marked as attending for ${formatTripDateRange(details.startsOn, details.endsOn)}.`;
}

/** Only server-validated inference reaches this API. Both records commit or neither does. */
export async function commitCoordinatorTurn(identifier: string, raw: unknown, reply: string, updatedDraft: PollWorkingData | null, options: PollRepositoryOptions, workspace?: CoordinatorWorkspace) {
  const input = CoordinatorTurnRequestSchema.parse(raw);
  z.string().min(1).max(4000).parse(reply);
  const data = updatedDraft ? PollWorkingDataSchema.parse(updatedDraft) : null;
  const metadata = workspace ? CoordinatorWorkspaceSchema.parse(workspace) : undefined;
  if (Boolean(input.draftId) !== Boolean(data) && !(input.draftId && !data && metadata?.tripConversation)) throw new CommandConflictError();
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    const fingerprint = commandFingerprint(options.actorPersonId, "coordinator.turn", input);
    const [existing] = await tx.select().from(coordinatorTurns).where(and(scope(event, options, input.threadId), eq(coordinatorTurns.commandId, input.commandId)));
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new CommandConflictError();
      return { sequence: existing.sequence };
    }
    if (input.threadId && (await thread(tx, event, input.threadId, true)).status !== "active") throw new CoordinatorConflictError("thread_archived");
    if (await version(tx, event, options, input.threadId) !== input.version) throw new CommandConflictError();
    const draft = await currentDraft(tx, event, options, input.draftId, input.draftVersion, input.threadId);
    if (metadata?.proposal?.itineraryBasis && !await itineraryPlanningBasisIsCurrent(tx, event, metadata.proposal.itineraryBasis)) throw new CoordinatorConflictError("stale_version");
    await validateContext(tx, event, options, input);
    if (metadata?.proposal && (!draft || metadata.proposal.state !== "pending" || metadata.proposal.baseVersion !== draft.version || JSON.stringify(metadata.proposal.data) !== JSON.stringify(data))) throw new CommandConflictError();
    if (draft && data && !metadata) {
      // Conversation edits cannot change recipients, source context, or provenance.
      for (const key of ["audience", "sourcePollId", "settledFacts", "ballotMode"] as const) {
        if (JSON.stringify(data[key]) !== JSON.stringify(draft.data[key])) throw new CommandConflictError();
      }
      // The organizer's private framing request (standalone editor) survives conversation edits that don't carry it.
      const kept = data.framingRequest === undefined && draft.data.framingRequest !== undefined ? { ...data, framingRequest: draft.data.framingRequest } : data;
      await saveCommonsPollDraftInTransaction(tx, event, { id: draft.id, commandId: input.commandId, expectedVersion: input.draftVersion, data: kept }, options);
    }
    if (input.threadId && draft && !draft.threadId) await tx.update(pollDrafts).set({ threadId: input.threadId, updatedAt: new Date() }).where(eq(pollDrafts.id, draft.id));
    if (input.threadId && input.contextPollId) await tx.update(polls).set({ threadId: input.threadId, updatedAt: new Date() })
      .where(and(eq(polls.id, input.contextPollId), isNull(polls.threadId)));
    // Sending an explicit attendance statement is the approval. Save it atomically
    // with the reply, under the same event/version lock, never in a separate request.
    if (metadata?.tripConversation && !input.researchQuery && reportsOwnAttendance(input.prompt)) {
      reply = await recordAttendanceStatementInTransaction(tx, event, options.actorPersonId, input.prompt, input.commandId, metadata);
    }
    const [saved] = await tx.insert(coordinatorTurns).values({ commonsId: event, ownerPersonId: options.actorPersonId, sequence: input.version + 1,
      threadId: input.threadId, organizerShared: input.threadId ? true : Boolean(options.sharedCoordinator), contextPollId: input.contextPollId, contextTurnId: input.contextTurnId,
      commandId: input.commandId, fingerprint, userText: input.prompt, assistantText: reply, draftId: input.draftId, workspace: metadata }).returning();
    if (input.threadId && metadata?.research) await tx.insert(coordinatorResearchRuns).values({ threadId: input.threadId,
      createdByPersonId: options.actorPersonId, commandId: input.commandId, query: metadata.research.query, status: metadata.research.status,
      sources: metadata.research.sources, limitations: metadata.research.limitations }).onConflictDoNothing();
    if (input.threadId) await tx.update(coordinatorThreads).set({ updatedAt: new Date() }).where(eq(coordinatorThreads.id, input.threadId));
    return { sequence: saved.sequence };
  }); } finally { await database.close(); }
}

/** Creates one stable, organizer-shared goal identity. Safe to retry with the same command. */
export async function createCoordinatorThread(identifier: string, raw: unknown, options: PollRepositoryOptions) {
  const input = CreateCoordinatorThreadSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    const fingerprint = commandFingerprint(options.actorPersonId, "coordinator.thread_created", input);
    const replayResult = await threadCommandReplay(tx, event, input.commandId, fingerprint);
    if (replayResult) return { id: replayResult.id!, version: replayResult.version! };
    if (input.id) {
      const [collision] = await tx.select({ commonsId: coordinatorThreads.commonsId }).from(coordinatorThreads).where(eq(coordinatorThreads.id, input.id)).limit(1);
      if (collision) throw new CommandConflictError();
    }
    const [created] = await tx.insert(coordinatorThreads).values({ id: input.id, commonsId: event, createdByPersonId: options.actorPersonId,
      title: input.title, lastCommandId: input.commandId, lastCommandFingerprint: fingerprint }).returning();
    const result = { id: created.id, version: created.version };
    await saveThreadCommand(tx, event, input.commandId, fingerprint, result);
    return result;
  }); } finally { await database.close(); }
}

/** Renaming, archiving, and reopening use the thread metadata version, independent of turn sequence. */
export async function updateCoordinatorThread(identifier: string, raw: unknown, options: PollRepositoryOptions) {
  const input = UpdateCoordinatorThreadSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    const fingerprint = commandFingerprint(options.actorPersonId, "coordinator.thread_updated", input);
    const replayResult = await threadCommandReplay(tx, event, input.commandId, fingerprint);
    if (replayResult) return { id: replayResult.id!, version: replayResult.version! };
    const row = await thread(tx, event, input.threadId, true);
    if (row.version !== input.expectedVersion) throw new CommandConflictError();
    const status = input.status ?? row.status, now = new Date();
    const [saved] = await tx.update(coordinatorThreads).set({ title: input.title ?? row.title, status,
      archivedAt: status === "archived" ? row.archivedAt ?? now : null, version: row.version + 1,
      lastCommandId: input.commandId, lastCommandFingerprint: fingerprint, updatedAt: now })
      .where(and(eq(coordinatorThreads.id, row.id), eq(coordinatorThreads.version, row.version))).returning();
    if (!saved) throw new CommandConflictError();
    const result = { id: saved.id, version: saved.version };
    await saveThreadCommand(tx, event, input.commandId, fingerprint, result);
    return result;
  }); } finally { await database.close(); }
}

/** Links an existing itinerary identity; it does not copy or mutate the Plan idea. */
export async function actOnCoordinatorThreadIdea(identifier: string, raw: unknown, options: PollRepositoryOptions) {
  const input = CoordinatorThreadIdeaActionSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    const fingerprint = commandFingerprint(options.actorPersonId, "coordinator.thread_idea", input);
    const replayResult = await threadCommandReplay(tx, event, input.commandId, fingerprint);
    if (replayResult) return { threadId: replayResult.threadId!, version: replayResult.version! };
    const row = await thread(tx, event, input.threadId, true);
    if (row.status !== "active") throw new CoordinatorConflictError("thread_archived");
    if (row.version !== input.expectedThreadVersion) throw new CoordinatorConflictError("stale_version");
    const [idea] = await tx.select({ id: itineraryItems.id }).from(itineraryItems).where(and(eq(itineraryItems.id, input.itineraryItemId), eq(itineraryItems.commonsId, event))).limit(1);
    if (!idea) throw new CoordinatorAccessError("artifact_missing");
    const [existing] = await tx.select({ id: coordinatorThreadIdeas.id }).from(coordinatorThreadIdeas)
      .where(and(eq(coordinatorThreadIdeas.threadId, row.id), eq(coordinatorThreadIdeas.itineraryItemId, idea.id))).limit(1);
    if (input.action === "link") {
      if (existing) throw new CommandConflictError();
      await tx.insert(coordinatorThreadIdeas).values({ threadId: row.id, itineraryItemId: idea.id, linkedByPersonId: options.actorPersonId, commandId: input.commandId });
    } else {
      if (!existing) throw new CommandConflictError();
      await tx.delete(coordinatorThreadIdeas).where(eq(coordinatorThreadIdeas.id, existing.id));
    }
    const [saved] = await tx.update(coordinatorThreads).set({ version: row.version + 1, lastCommandId: input.commandId,
      lastCommandFingerprint: fingerprint, updatedAt: new Date() }).where(and(eq(coordinatorThreads.id, row.id), eq(coordinatorThreads.version, row.version))).returning();
    if (!saved) throw new CommandConflictError();
    const result = { threadId: saved.id, version: saved.version };
    await saveThreadCommand(tx, event, input.commandId, fingerprint, result);
    return result;
  }); } finally { await database.close(); }
}

async function applyTripChange(tx: CommandTransaction, event: string, actorId: string, proposal: TripChangeProposal, commandId: string) {
  const [current] = await tx.select().from(commons).where(eq(commons.id, event)).for("update");
  if (!current) throw new CoordinatorAccessError("membership_lost");
  const { base, changes, operations } = proposal;
  if (operations.includes("budget")) {
    if (current.targetBudgetCents !== base.budgetCents) throw new CommandConflictError();
    UpdateTargetBudgetCommandSchema.parse({ commandId, amountCents: changes.budgetCents });
  }
  if (operations.includes("dates") || operations.includes("destination")) {
    if (operations.includes("dates") && (current.startsOn !== base.startsOn || current.endsOn !== base.endsOn)) throw new CommandConflictError();
    if (operations.includes("destination") && current.locationName !== base.locationName) throw new CommandConflictError();
    UpdateCommonsDetailsRequestSchema.parse({ commandId, title: current.name,
      startsOn: operations.includes("dates") ? changes.startsOn : current.startsOn,
      endsOn: operations.includes("dates") ? changes.endsOn : current.endsOn,
      locationName: operations.includes("destination") ? changes.locationName : current.locationName,
      locationNames: current.locationNames, balancesDisabled: current.balancesDisabled });
  }
  let stayId: string | null = null, planId: string | null = null;
  if (operations.includes("plan")) planId = await applyPlanChange(tx, event, actorId, proposal);
  if (operations.includes("stay")) {
    const wanted = changes.stay;
    if (!wanted) throw new CommandConflictError();
    if (wanted.bookingUrl && !/^https?:\/\//i.test(wanted.bookingUrl)) throw new CommandConflictError();
    if (wanted.currency !== "USD" || !wanted.startsOn || !wanted.endsOn) throw new CommandConflictError();
    const stayInput = { commandId, name: wanted.name, address: wanted.address,
      startsOn: wanted.startsOn, endsOn: wanted.endsOn, status: wanted.status,
      includedPersonIds: changes.includedPersonIds, bookingUrl: wanted.bookingUrl,
      totalCents: wanted.totalCents, currency: "USD", costSource: wanted.totalCents === null ? null : "estimate" as const };
    if (!changes.includedPersonIds.length) throw new CommandConflictError();
    const memberRows = await tx.select({ id: memberships.personId }).from(memberships)
      .where(and(eq(memberships.commonsId, event), inArray(memberships.status, ["active", "invited"])));
    const memberIds = new Set(memberRows.map(row => row.id));
    if (changes.includedPersonIds.some(id => !memberIds.has(id))) throw new CoordinatorConflictError("stale_version");
    if (base.stay) {
      if (wanted.id !== base.stay.id) throw new CommandConflictError();
      const [existing] = await tx.select().from(stays).where(and(eq(stays.id, base.stay.id!), eq(stays.commonsId, event))).for("update");
      if (!existing || existing.updatedAt.toISOString() !== base.stay.updatedAt) throw new CommandConflictError();
      if (existing.legacyExpenseId && wanted.totalCents !== existing.totalCents) throw new CommandConflictError();
      UpdateStayCommandSchema.parse({ ...stayInput, checkInTime: existing.checkInTime, checkOutTime: existing.checkOutTime,
        pollId: existing.pollId, confirmationCode: existing.confirmationCode, includesTaxesAndFees: existing.includesTaxesAndFees,
        details: existing.details, costSource: wanted.totalCents === existing.totalCents ? existing.costSource : stayInput.costSource });
      await tx.update(stays).set({ name: wanted.name, address: wanted.address, startsOn: wanted.startsOn,
        endsOn: wanted.endsOn, status: wanted.status, bookingUrl: wanted.bookingUrl, totalCents: wanted.totalCents,
        costSource: wanted.totalCents === existing.totalCents ? existing.costSource : stayInput.costSource,
        updatedAt: new Date() }).where(eq(stays.id, existing.id));
      const participantRows = await tx.select({ id: stayParticipants.personId }).from(stayParticipants).where(eq(stayParticipants.stayId, existing.id));
      const oldIds = new Set(participantRows.map(row => row.id));
      const newIds = new Set(changes.includedPersonIds);
      if (participantRows.some(row => !newIds.has(row.id))) await tx.delete(stayParticipants).where(and(eq(stayParticipants.stayId, existing.id), inArray(stayParticipants.personId, participantRows.filter(row => !newIds.has(row.id)).map(row => row.id))));
      const added = changes.includedPersonIds.filter(id => !oldIds.has(id));
      if (added.length) await tx.insert(stayParticipants).values(added.map(personId => ({ stayId: existing.id, personId })));
      stayId = existing.id;
    } else {
      if (wanted.id) throw new CommandConflictError();
      const parsed = AddStayCommandSchema.parse(stayInput);
      const [duplicate] = await tx.select({ id: stays.id }).from(stays).where(and(eq(stays.commonsId, event), eq(stays.name, parsed.name), eq(stays.address, parsed.address),
        eq(stays.startsOn, parsed.startsOn), eq(stays.endsOn, parsed.endsOn))).limit(1);
      if (duplicate) throw new CommandConflictError();
      const [created] = await tx.insert(stays).values({ commonsId: event, createdByPersonId: actorId,
        name: parsed.name, address: parsed.address, startsOn: parsed.startsOn, endsOn: parsed.endsOn,
        status: parsed.status, bookingUrl: parsed.bookingUrl, totalCents: parsed.totalCents, currency: parsed.currency,
        costSource: parsed.costSource, sourceLabel: "Reported by organizer; booking not verified" }).returning({ id: stays.id });
      await tx.insert(stayParticipants).values(parsed.includedPersonIds.map(personId => ({ stayId: created.id, personId })));
      stayId = created.id;
    }
  }
  const eventChanges: Partial<typeof commons.$inferInsert> = { updatedAt: new Date() };
  if (operations.includes("budget")) eventChanges.targetBudgetCents = changes.budgetCents;
  if (operations.includes("dates")) { eventChanges.startsOn = changes.startsOn; eventChanges.endsOn = changes.endsOn; }
  if (operations.includes("destination")) { eventChanges.locationName = changes.locationName; eventChanges.locationNames = changes.locationName ? [changes.locationName, ...current.locationNames.slice(1)] : []; }
  if (operations.some(operation => operation !== "stay" && operation !== "plan")) await tx.update(commons).set(eventChanges).where(eq(commons.id, event));
  return { stayId, planId };
}

const PLAN_PROVENANCE_SUFFIX = / · (?:Updated by|Confirmed as reported by|Cancelled by) .+$/;

/**
 * One existing plan item: status, start time (the item's own zone) and note, from the reviewed proposal only. The item must be exactly as it was when the
 * proposal was prepared (`updatedAt`), so an edit by another organizer in between is a conflict and nothing is overwritten. A confirmation is recorded in the
 * item's provenance as reported by the organizer; Commons verified nothing. The contact option reaches the note only when it was checked.
 */
async function applyPlanChange(tx: CommandTransaction, event: string, actorId: string, proposal: TripChangeProposal) {
  const { base, changes } = proposal;
  const was = base.plan, wanted = changes.plan;
  if (!was || !wanted || wanted.id !== was.id) throw new CommandConflictError();
  const [item] = await tx.select().from(itineraryItems).where(and(eq(itineraryItems.id, was.id), eq(itineraryItems.commonsId, event))).for("update");
  if (!item || item.updatedAt.toISOString() !== was.updatedAt || item.status !== was.status) throw new CommandConflictError();
  if (wanted.timezone !== item.timezone || wanted.status === "idea" && was.status !== "idea") throw new CommandConflictError();
  const set: Partial<typeof itineraryItems.$inferInsert> = {};
  if (wanted.status !== was.status) set.status = wanted.status;
  if (wanted.startsOn !== was.startsOn || wanted.startsTime !== was.startsTime) {
    // A time can be changed, never cleared, and moving the start carries the end with it.
    if (!wanted.startsOn || !wanted.startsTime) throw new CommandConflictError();
    const startsAt = zonedLocalToInstant(wanted.startsOn, wanted.startsTime, item.timezone);
    if (!startsAt) throw new CommandConflictError();
    set.startsAt = new Date(startsAt);
    if (item.startsAt && item.endsAt) set.endsAt = new Date(new Date(startsAt).getTime() + (item.endsAt.getTime() - item.startsAt.getTime()));
  }
  const note = planNoteToSave(wanted);
  if (note !== (item.note?.trim() ? item.note.trim() : null) || wanted.contact?.include) {
    if (note && note.length > 4000) throw new CommandConflictError();
    set.note = note;
  }
  if (!Object.keys(set).length) throw new CommandConflictError();
  const [actor] = await tx.select({ name: people.displayName }).from(people).where(eq(people.id, actorId));
  const original = item.provenanceLabel.replace(PLAN_PROVENANCE_SUFFIX, "");
  const label = wanted.status !== was.status && wanted.status === "confirmed" ? "Confirmed as reported by" : wanted.status !== was.status && wanted.status === "cancelled" ? "Cancelled by" : "Updated by";
  await tx.update(itineraryItems).set({ ...set, provenanceLabel: `${original} · ${label} ${actor.name}`, updatedAt: new Date() }).where(eq(itineraryItems.id, item.id));
  return item.id;
}

/** No model call or client-supplied draft content: apply the saved, reviewed proposal only. */
export async function actOnCoordinatorWorkspace(identifier: string, raw: unknown, options: PollRepositoryOptions) {
  const input = CoordinatorWorkspaceActionSchema.parse(raw), database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    if ("resourceType" in input) {
      const archivedAt = input.action === "archive" ? new Date() : null;
      if (input.resourceType === "draft") {
        const [draft] = await tx.select().from(pollDrafts).where(and(eq(pollDrafts.id, input.resourceId), eq(pollDrafts.commonsId, event), eq(pollDrafts.organizerShared, Boolean(options.sharedCoordinator)))).for("update");
        if (!draft) throw new CoordinatorAccessError("artifact_missing");
        await tx.update(pollDrafts).set({ archivedAt, updatedAt: new Date() }).where(eq(pollDrafts.id, draft.id));
      } else {
        const [poll] = await tx.select().from(polls).where(and(eq(polls.id, input.resourceId), eq(polls.commonsId, event))).for("update");
        if (!poll) throw new CoordinatorAccessError("artifact_missing");
        await tx.update(polls).set({ archivedAt, updatedAt: new Date() }).where(eq(polls.id, poll.id));
      }
      return;
    }
    if (input.threadId) await thread(tx, event, input.threadId);
    const [turn] = await tx.select().from(coordinatorTurns).where(and(scope(event, options, input.threadId), eq(coordinatorTurns.id, input.turnId))).for("update");
    // A pending or failed turn has no reviewed artifact to act on, whatever its stored workspace says.
    if (!turn?.workspace || lifecycleOf(turn).status !== "completed") throw new CoordinatorAccessError("artifact_missing");
    const workspace = CoordinatorWorkspaceSchema.parse(turn.workspace);
    if (input.action === "itinerary") return actOnItinerary(tx, event, input, options);
    if (input.action === "trip_task") return actOnCoordinatorTripTask(tx, event, input, options);
    if (input.action === "undo_attendance") {
      const receipt = workspace.attendanceReceipt;
      if (!receipt || turn.ownerPersonId !== options.actorPersonId) throw new CoordinatorAccessError("artifact_missing");
      if (receipt.undone) return;
      const [details] = await tx.select().from(commons).where(eq(commons.id, event));
      if (eventAttendanceDates(details.startsOn, details.endsOn) !== receipt.dates) throw new CommandConflictError();
      for (const person of receipt.people) {
        const [current] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, event), eq(memberships.personId, person.personId)));
        if (!current || current.status !== "active" || current.attendanceState !== "attending" || current.attendanceDates !== receipt.dates || current.updatedAt.toISOString() !== receipt.at) throw new CommandConflictError();
      }
      for (const person of receipt.people) await tx.update(memberships).set({ attendanceState: person.previousState,
        attendanceDates: person.previousDates, updatedAt: new Date() }).where(and(eq(memberships.commonsId, event), eq(memberships.personId, person.personId)));
      receipt.undone = true;
      await tx.update(coordinatorTurns).set({ workspace }).where(eq(coordinatorTurns.id, turn.id));
      await tx.insert(auditEvents).values({ commonsId: event, commandId: input.commandId, actorId: options.actorPersonId,
        actorType: "human", action: "coordinator.attendance_undone", resourceType: "commons", resourceId: event, summary: "Organizer undid the attendance recorded from their conversation." });
      return;
    }
    if (input.action === "revise_trip" || input.action === "apply_trip" || input.action === "dismiss_trip") {
      const proposal = workspace.tripProposal;
      if (!proposal) throw new CommandConflictError();
      const fingerprint = commandFingerprint(options.actorPersonId, "coordinator.trip_change", input);
      const [processed] = await tx.select({ result: processedCommands.result }).from(processedCommands)
        .where(and(eq(processedCommands.commonsId, event), eq(processedCommands.commandId, input.commandId))).limit(1);
      if (processed) {
        if ((processed.result as { fingerprint?: string }).fingerprint !== fingerprint) throw new CommandConflictError();
        return;
      }
      if (proposal.state !== "pending" || proposal.version !== input.expectedVersion) throw new CommandConflictError();
      if(input.action === "apply_trip"){await assertGoalProposalCurrent(tx,event,turn.id);await assertParticipantEvidenceCurrent(tx,event,turn.id);}
      if (input.planContact && input.action !== "apply_trip") throw new CommandConflictError();
      if (input.action === "revise_trip") {
        if (!input.changes) throw new CommandConflictError();
        // A review edit may change the reviewed values, never which plan item it is, and never the contact text (the organizer can only choose to include it).
        const was = proposal.base.plan, edited = input.changes.plan, proposed = proposal.changes.plan;
        if (Boolean(was) !== Boolean(edited)) throw new CommandConflictError();
        if (was && edited && (edited.id !== was.id || edited.title !== was.title || edited.timezone !== was.timezone || edited.updatedAt !== was.updatedAt || edited.contact?.text !== proposed?.contact?.text || Boolean(edited.contact) !== Boolean(proposed?.contact))) throw new CommandConflictError();
        proposal.changes = input.changes;
        proposal.version += 1;
      } else {
        if (input.changes) throw new CommandConflictError();
        if (input.planContact) {
          // The compact confirmation sends the contact choice with Apply. The client may only include or exclude the contact stored with this proposal.
          const stored = proposal.changes.plan?.contact;
          if (!stored || stored.text !== input.planContact.text) throw new CommandConflictError();
          stored.include = input.planContact.include;
        }
        const [actor] = await tx.select({ name: people.displayName }).from(people).where(eq(people.id, options.actorPersonId));
        const at = new Date();
        // A lodging review prepared from facts or shared constraints that have since changed is refused before anything is applied.
        if (input.action === "apply_trip") await assertLodgingReviewCurrent(tx, event, proposal);
        const applied = input.action === "apply_trip" ? await applyTripChange(tx, event, options.actorPersonId, proposal, input.commandId) : { stayId: null, planId: null };
        proposal.state = input.action === "apply_trip" ? "applied" : "dismissed";
        if (input.action === "apply_trip") {
          const [savedTrip] = await tx.select().from(commons).where(eq(commons.id, event));
          const [savedPlan] = applied.planId ? await tx.select().from(itineraryItems).where(eq(itineraryItems.id, applied.planId)) : [];
          const [savedStay] = applied.stayId ? await tx.select().from(stays).where(eq(stays.id, applied.stayId)) : [];
          const resultingVersions = [savedTrip, savedPlan, savedStay].filter((row): row is NonNullable<typeof row> => Boolean(row)).map(row => ({ id: row.id, version: row.updatedAt.toISOString() }));
          proposal.receipt = { at: at.toISOString(), appliedBy: actor.name, stayId: applied.stayId, planId: applied.planId, resultingVersions };
        }
        workspace.actedBy = { personId: options.actorPersonId, name: actor.name, at: at.toISOString() };
        // The reviewed lodging choice continues here, after the receipt and inside the same transaction: the brief and the receipt commit or roll back together.
        const outcome = await continueLodgingAfterApply(tx, event, { turnId: turn.id, proposal, approver: workspace.actedBy, enabled: Boolean(options.lodgingContinuationEnabled) });
        if (outcome && proposal.preparation) proposal.preparation.outcome = outcome;
        if (outcome) options.lodgingCrashPoint?.("prepared_before_commit");
        if (input.action === "apply_trip") await tx.insert(auditEvents).values({ commonsId: event, commandId: input.commandId,
          actorId: options.actorPersonId, actorType: "human", action: "coordinator.trip_change_applied",
          resourceType: "commons", resourceId: event, summary: `Organizer applied reviewed ${proposal.operations.join(", ")} update.${proposal.operations.includes("plan") ? ` Plan “${proposal.base.plan?.title.slice(0, 120)}”${proposal.changes.plan && proposal.changes.plan.status !== proposal.base.plan?.status ? ` set to ${proposal.changes.plan.status}${proposal.changes.plan.status === "confirmed" ? " as reported by the organizer; not verified" : ""}` : ""}.` : ""}` });
      }
      await tx.update(coordinatorTurns).set({ workspace }).where(eq(coordinatorTurns.id, turn.id));
      await tx.insert(processedCommands).values({ commonsId: event, commandId: input.commandId,
        result: { kind: "coordinator.trip_change", fingerprint, turnId: turn.id, version: proposal.version, state: proposal.state } });
      await projectGoalEventInTransaction(tx,event,turn.id);
      return;
    }
    if (input.action === "save") workspace.saved = true;
    else if (input.action === "archive" || input.action === "unarchive") {
      if (!workspace.saved) throw new CommandConflictError();
      if (input.action === "archive") workspace.archivedAt = new Date().toISOString();
      else delete workspace.archivedAt;
    }
    else {
      const proposal = workspace.proposal;
      if (!proposal || !turn.draftId) throw new CommandConflictError();
      if (proposal.state === (input.action === "apply" ? "applied" : "dismissed")) return;
      if (proposal.state !== "pending") throw new CommandConflictError();
      if (input.action === "apply") {
        // A draft prepared inside a thread belongs to that thread; without the thread id this lookup only saw unthreaded drafts,
        // so applying a reviewed proposal in a thread failed with artifact_missing (present on the branch base, found by Stage 4).
        const draft = await currentDraft(tx, event, options, turn.draftId, proposal.baseVersion, turn.threadId ?? undefined);
        if (!draft) throw new CommandConflictError();
        if (proposal.itineraryBasis && !await itineraryPlanningBasisIsCurrent(tx, event, proposal.itineraryBasis)) throw new CoordinatorConflictError("stale_version");
        for (const key of ["audience", "sourcePollId", "settledFacts", "ballotMode"] as const) {
          if (JSON.stringify(proposal.data[key]) !== JSON.stringify(draft.data[key])) throw new CommandConflictError();
        }
        await saveCommonsPollDraftInTransaction(tx, event, { id: draft.id, commandId: input.commandId, expectedVersion: proposal.baseVersion, data: proposal.data }, options);
      }
      proposal.state = input.action === "apply" ? "applied" : "dismissed";
      const [actor] = await tx.select({ name: people.displayName }).from(people).where(eq(people.id, options.actorPersonId));
      workspace.actedBy = { personId: options.actorPersonId, name: actor.name, at: new Date().toISOString() };
    }
    await tx.update(coordinatorTurns).set({ workspace }).where(eq(coordinatorTurns.id, turn.id));
  }); } finally { await database.close(); }
}

export async function coordinatorPreferencesForTrip(identifier: string, options: PollRepositoryOptions, raw?: unknown) {
    const input = raw === undefined ? null : CoordinatorSettingsRequestSchema.parse(raw), database = createDatabase(options.databaseUrl);
    try {
        return await database.db.transaction(async (tx) => {
            const event = await organizer(tx, identifier, options.actorPersonId);
            const [row] = await tx.select().from(commons).where(eq(commons.id, event));
            let settings = CoordinatorSettingsSchema.parse(row.coordinatorSettings);
            if (input?.action === 'personality') {
                const fingerprint = commandFingerprint(options.actorPersonId, 'coordinator.personality', input);
                const [prior] = await tx.select().from(processedCommands).where(and(eq(processedCommands.commonsId, event), eq(processedCommands.commandId, input.commandId)));
                if (prior) {
                    if ((prior.result as {
                        fingerprint?: string;
                    }).fingerprint !== fingerprint)
                        throw new CommandConflictError();
                }
                else {
                    if (settings.version !== input.expectedVersion)
                        throw new CommandConflictError();
                    settings = { version: settings.version + 1, personality: input.personality };
                    await tx.update(commons).set({ coordinatorSettings: settings }).where(eq(commons.id, event));
                    await tx.insert(processedCommands).values({ commonsId: event, commandId: input.commandId, result: { kind: 'coordinator.personality', fingerprint, actorPersonId: options.actorPersonId, settings } });
                }
            }
            if (input?.action === 'dismiss')
                await tx.insert(coordinatorPreferences).values({ commonsId: event, personId: options.actorPersonId, dismissed: true }).onConflictDoUpdate({ target: [coordinatorPreferences.commonsId, coordinatorPreferences.personId], set: { dismissed: true } });
            const [preference] = await tx.select().from(coordinatorPreferences).where(and(eq(coordinatorPreferences.commonsId, event), eq(coordinatorPreferences.personId, options.actorPersonId)));
            const [engaged] = await tx.select({ id: coordinatorTurns.id }).from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, event), eq(coordinatorTurns.ownerPersonId, options.actorPersonId), eq(coordinatorTurns.organizerShared, true))).limit(1);
            return { settings, dismissed: Boolean(preference?.dismissed || engaged), tripContext: { name: row.name, startsOn: row.startsOn, endsOn: row.endsOn, locationName: row.locationName, brief: row.eventBrief } };
        });
    }
    finally {
        await database.close();
    }
}

/** Server-only save context. Never pass this result to a model or analytics. */
export async function tripChangeContextForTrip(identifier: string, options: PollRepositoryOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const event = await organizer(tx, identifier, options.actorPersonId);
    const [row] = await tx.select({ name: commons.name, startsOn: commons.startsOn, endsOn: commons.endsOn,
      locationName: commons.locationName, targetBudgetCents: commons.targetBudgetCents }).from(commons).where(eq(commons.id, event));
    const stayRows = await tx.select({ id: stays.id, name: stays.name, address: stays.address, startsOn: stays.startsOn,
      endsOn: stays.endsOn, status: stays.status, totalCents: stays.totalCents, currency: stays.currency,
      bookingUrl: stays.bookingUrl, updatedAt: stays.updatedAt }).from(stays).where(eq(stays.commonsId, event)).orderBy(desc(stays.updatedAt)).limit(20);
    const included = stayRows.length ? await tx.select({ stayId: stayParticipants.stayId, personId: stayParticipants.personId })
      .from(stayParticipants).where(inArray(stayParticipants.stayId, stayRows.map(stay => stay.id))) : [];
    const travelers = await tx.select({ id: people.id, name: people.displayName }).from(memberships)
      .innerJoin(people, eq(people.id, memberships.personId))
      .where(and(eq(memberships.commonsId, event), inArray(memberships.status, ["active", "invited"])));
    const planRows = await tx.select({ id: itineraryItems.id, title: itineraryItems.title, status: itineraryItems.status, timezone: itineraryItems.timezone,
      startsAt: itineraryItems.startsAt, endsAt: itineraryItems.endsAt, note: itineraryItems.note, updatedAt: itineraryItems.updatedAt }).from(itineraryItems)
      .where(and(eq(itineraryItems.commonsId, event), ne(itineraryItems.status, "cancelled"))).orderBy(sql`${itineraryItems.startsAt} asc nulls last`, asc(itineraryItems.createdAt)).limit(40);
    return { ...row, plans: planRows.map(plan => ({ ...plan, startsAt: plan.startsAt?.toISOString() ?? null, endsAt: plan.endsAt?.toISOString() ?? null, updatedAt: plan.updatedAt.toISOString() })), stays: stayRows.map(stay => ({ ...stay, updatedAt: stay.updatedAt.toISOString(),
      includedPersonIds: included.filter(item => item.stayId === stay.id).map(item => item.personId) })), travelers };
  }); } finally { await database.close(); }
}
