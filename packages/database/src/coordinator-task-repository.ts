import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError, commandFingerprint, type CommandTransaction } from "./event-command";
import { coordinatorGoals, coordinatorGoalSteps, coordinatorTaskEvents, coordinatorTaskState, coordinatorThreadOutcomes, coordinatorThreads, people, researchAttempts, researchTasks } from "./schema";
import { TASK_MAX_BRIEF, TASK_MAX_RUNNING, authorizeTaskActor, queueResearchTask, taskRunId, taskState, type ResearchOptions } from "./research-task-repository";
import { assertCoordinatorTurnFenceInTransaction, requireTripOrganizer } from "./coordinator-turn-repository";
import { threadRelation } from "./coordinator-thread-link-repository";

/*
 * Steering operations on durable tasks (docs/COORDINATOR-CONTINUITY-REVIEW.md). They reuse research_tasks, its attempts, leases and the worker; what they add
 * is a brief revision (coordinator_task_state), an append-only history with the organizer's idempotency keys (coordinator_task_events), and the rule that
 * only the organizer who started a task can amend or cancel it. Every operation is one short transaction under the task row lock; none waits on a provider.
 */

/** Another correction or a cancellation moved the task first. `currentRevision` is what the caller should refresh to. */
export class TaskRevisionConflictError extends CommandConflictError {
  constructor(readonly currentRevision: number) { super(); this.name = "TaskRevisionConflictError"; }
}
/** The task can no longer take this operation (a cancelled task is final). Not an authorization failure. */
export class TaskNotAmendableError extends Error {
  readonly code = "task_not_amendable";
  constructor(readonly status: string) { super("This task is no longer running, so it can’t be changed."); this.name = "TaskNotAmendableError"; }
}

export type TaskStatusView = "queued" | "running" | "needs_input" | "succeeded" | "failed" | "cancelled";
export type TaskView = {
  taskId: string; threadId: string; title: string; brief: string; query: string;
  revision: number; status: TaskStatusView; errorCode: string | null;
  /** True when the task is queued behind the organizer's other running tasks rather than waiting for a worker. */
  waitingForSlot: boolean;
  needsInput: string | null;
  /** The saved result belongs to an earlier revision of the brief. */
  resultOutdated: boolean;
  hasResult: boolean;
  resultRevision: number | null;
  /** The research run that is the current result (null while outdated, absent, or for tasks that predate steering). */
  currentRunId: string | null;
  /** Every research run this task saved, one per completed revision; all but `currentRunId` are history. */
  runIds: string[];
  requestedByPersonId: string; requestedByName: string; ownedByMe: boolean;
  acceptedAt: string; updatedAt: string;
  /** Most recent meaningful change, in plain words, for the compact task row. */
  lastChange: { kind: "started" | "amended" | "cancelled" | "completed" | "failed"; revision: number; at: string; summary: string | null } | null;
  steered: boolean;
};

const viewStatus = (status: string): TaskStatusView => status === "pending" ? "queued" : status === "processing" ? "running" : status as TaskStatusView;

async function viewsFor(tx: CommandTransaction, rows: Array<typeof researchTasks.$inferSelect>, actor: string, now: Date): Promise<TaskView[]> {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const [states, events, people_, runningRows] = await Promise.all([
    tx.select().from(coordinatorTaskState).where(inArray(coordinatorTaskState.taskId, ids)),
    tx.select().from(coordinatorTaskEvents).where(inArray(coordinatorTaskEvents.taskId, ids)).orderBy(desc(coordinatorTaskEvents.createdAt)),
    tx.select({ id: people.id, name: people.displayName }).from(people).where(inArray(people.id, [...new Set(rows.map(row => row.requestedByPersonId))])),
    tx.select({ commonsId: researchTasks.commonsId, person: researchTasks.requestedByPersonId, count: sql<number>`count(*)::int` }).from(researchTasks)
      .where(and(inArray(researchTasks.commonsId, [...new Set(rows.map(row => row.commonsId))]), eq(researchTasks.status, "processing"), gt(researchTasks.leaseExpiresAt, now)))
      .groupBy(researchTasks.commonsId, researchTasks.requestedByPersonId),
  ]);
  return rows.map(row => {
    const state = states.find(item => item.taskId === row.id) ?? null;
    const taskEvents = events.filter(item => item.taskId === row.id);
    const revision = state?.revision ?? 1, resultRevision = state ? state.resultRevision : row.status === "succeeded" ? 1 : null;
    const completed = taskEvents.find(item => item.kind === "completed" && item.revision === resultRevision);
    const last = taskEvents[0] ?? null;
    const running = runningRows.find(item => item.commonsId === row.commonsId && item.person === row.requestedByPersonId)?.count ?? 0;
    return {
      taskId: row.id, threadId: row.threadId, title: state?.title ?? row.request.input.query.slice(0, 120), brief: state?.brief ?? row.request.input.query, query: row.request.input.query,
      revision, status: viewStatus(row.status), errorCode: row.errorCode,
      waitingForSlot: row.status === "pending" && running >= TASK_MAX_RUNNING, needsInput: state?.needsInput ?? null,
      resultOutdated: resultRevision !== null && resultRevision < revision, hasResult: resultRevision !== null || row.result !== null, resultRevision,
      currentRunId: completed && resultRevision === revision ? completed.runId : null,
      runIds: taskEvents.filter(item => item.kind === "completed" && item.runId).map(item => item.runId as string),
      requestedByPersonId: row.requestedByPersonId, requestedByName: people_.find(item => item.id === row.requestedByPersonId)?.name ?? "Organizer", ownedByMe: row.requestedByPersonId === actor,
      acceptedAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      lastChange: last ? { kind: last.kind, revision: last.revision, at: last.createdAt.toISOString(), summary: last.summary } : null,
      steered: Boolean(state),
    } satisfies TaskView;
  });
}

/** Tasks the actor may read, newest first. Any active organizer may read; only `ownedByMe` tasks can be steered. */
export async function listCoordinatorTasks(commonsId: string, threadId: string, options: ResearchOptions & { now?: Date }): Promise<TaskView[]> {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    await authorizeTaskActor(tx, commonsId, threadId, options.actorPersonId, false);
    const rows = await tx.select().from(researchTasks).where(and(eq(researchTasks.commonsId, commonsId), eq(researchTasks.threadId, threadId))).orderBy(desc(researchTasks.createdAt)).limit(50);
    return viewsFor(tx, rows, options.actorPersonId, options.now ?? new Date());
  }); } finally { await database.close(); }
}

/** A single task the actor can read, or an access error that looks the same as a missing task. */
export async function readCoordinatorTask(taskId: string, options: ResearchOptions & { commonsId?: string; threadId?: string; now?: Date }): Promise<TaskView> {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const [row] = await tx.select().from(researchTasks).where(eq(researchTasks.id, taskId));
    if (!row || (options.commonsId && row.commonsId !== options.commonsId) || (options.threadId && row.threadId !== options.threadId)) throw new CommandAccessError();
    await authorizeTaskActor(tx, row.commonsId, row.threadId, options.actorPersonId, false);
    return (await viewsFor(tx, [row], options.actorPersonId, options.now ?? new Date()))[0];
  }); } finally { await database.close(); }
}

export type StartTaskInput = { protocolVersion: 1; commandId: string; commonsId: string; threadId: string; parentTaskId: null; caller: { kind: "human"; personId: string }; capability: "research.public_sources";
  input: { query: string }; routing: { kind: "commons_specialist" }; returnTo: { kind: "commons_thread"; threadId: string } };

/** Start a steerable task. Same acceptance rules as background research, plus the per-organizer outstanding-task bound and a stored brief. */
export async function startCoordinatorTask(request: StartTaskInput, steer: { title: string; brief: string; contextVersion: number | null }, options: ResearchOptions) {
  const receipt = await queueResearchTask(request, options, { title: steer.title.trim(), brief: steer.brief.trim(), contextVersion: steer.contextVersion });
  return { ...receipt, task: await readCoordinatorTask(receipt.taskId, options) };
}

/** Keep the first line (what the task was started for) and the newest corrections; drop the oldest corrections when the brief outgrows its bound. */
export function appendToBrief(brief: string, revision: number, note: string) {
  const lines = brief.split("\n"), first = lines[0] ?? "", rest = lines.slice(1);
  rest.push(`Revision ${revision}: ${note.replace(/\s+/g, " ").trim()}`);
  while (rest.length > 1 && [first, ...rest].join("\n").length > TASK_MAX_BRIEF) rest.shift();
  return [first, ...rest].join("\n").slice(0, TASK_MAX_BRIEF);
}

export type AmendInput = {
  taskId: string; commandId: string;
  /** The revision the organizer was looking at. A task already past it is a conflict, never a silent overwrite. */
  expectedRevision: number;
  /** The organizer's correction, in their words. Becomes part of the brief and is shown with the revision. */
  note: string;
  /** A replacement public search query, already sanitized by the caller. Absent keeps the current query. */
  publicQuery?: string;
  /** The specific fact the task needs from the organizer before it can run again. Present = needs input. */
  missingFact?: string;
};
export type AmendOutcome = { task: TaskView; replayed: boolean; supersededRunning: boolean };

/**
 * Accept a correction. One transaction: the brief revision increments, the previous attempt loses the right to publish a current result (its attempt is
 * marked superseded and the task is re-queued, or parked waiting for input), and an earlier completed result is kept but marked outdated. A command id
 * already used returns what happened the first time. Only the organizer who started the task may do this.
 */
export async function amendCoordinatorTask(input: AmendInput, options: ResearchOptions & { now?: Date }): Promise<AmendOutcome> {
  const database = createDatabase(options.databaseUrl), now = options.now ?? new Date();
  const note = input.note.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!note) throw new CommandConflictError();
  try { return await database.db.transaction(async tx => {
    const [scope] = await tx.select().from(researchTasks).where(eq(researchTasks.id, input.taskId));
    if (!scope) throw new CommandAccessError();
    await requireTripOrganizer(tx, scope.commonsId, options.actorPersonId);
    await assertCoordinatorTurnFenceInTransaction(tx, scope.commonsId, options.actorPersonId, options.turnFence);
    const [goalSchema] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_goals') is not null as present`);
    if (goalSchema?.present) {
      const [managed] = await tx.select({ id: coordinatorGoals.id }).from(coordinatorGoalSteps).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId)).where(eq(coordinatorGoalSteps.refId, input.taskId)).limit(1);
      if (managed) throw new TaskNotAmendableError("managed_goal_use_goal_controls");
    }
    const [row] = await tx.select().from(researchTasks).where(eq(researchTasks.id, input.taskId)).for("update");
    if (!row) throw new CommandAccessError();
    await authorizeTaskActor(tx, row.commonsId, row.threadId, options.actorPersonId, true);
    if (row.requestedByPersonId !== options.actorPersonId) throw new CommandAccessError();
    const fingerprint = commandFingerprint(options.actorPersonId, "task.amend", { taskId: input.taskId, expectedRevision: input.expectedRevision, note, publicQuery: input.publicQuery ?? null, missingFact: input.missingFact ?? null });
    const [previous] = await tx.select().from(coordinatorTaskEvents).where(and(eq(coordinatorTaskEvents.commonsId, row.commonsId), eq(coordinatorTaskEvents.commandId, input.commandId)));
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.taskId !== row.id) throw new CommandConflictError();
      return { task: (await viewsFor(tx, [row], options.actorPersonId, now))[0], replayed: true, supersededRunning: false };
    }
    if (row.status === "cancelled") throw new TaskNotAmendableError(row.status);
    const state = await taskState(tx, row.id);
    if (!state) throw new TaskNotAmendableError("not_steerable");
    if (state.revision !== input.expectedRevision) throw new TaskRevisionConflictError(state.revision);
    const revision = state.revision + 1, wasRunning = row.status === "processing";
    // The previous attempt (if one is running) loses its right to publish: its attempt is superseded and the claim counter moves past it on the next claim.
    if (wasRunning) await tx.update(researchAttempts).set({ status: "superseded", errorCode: `superseded_by_revision_${revision}`, finishedAt: now })
      .where(and(eq(researchAttempts.taskId, row.id), eq(researchAttempts.attempt, row.attempts), eq(researchAttempts.status, "processing")));
    const request = input.publicQuery ? { ...row.request, input: { query: input.publicQuery.trim().slice(0, 500) } } : row.request;
    await tx.update(researchTasks).set({ status: input.missingFact ? "needs_input" : "pending", leaseExpiresAt: null, availableAt: now, errorCode: null, request, updatedAt: now }).where(eq(researchTasks.id, row.id));
    await tx.update(coordinatorTaskState).set({ revision, brief: appendToBrief(state.brief, revision, note), needsInput: input.missingFact?.trim().slice(0, 300) || null, attemptsBase: row.attempts, updatedAt: now }).where(eq(coordinatorTaskState.taskId, row.id));
    await tx.insert(coordinatorTaskEvents).values({ commonsId: row.commonsId, taskId: row.id, threadId: row.threadId, actorPersonId: options.actorPersonId, kind: "amended", revision,
      commandId: input.commandId, fingerprint, expectedRevision: input.expectedRevision, summary: note });
    const [fresh] = await tx.select().from(researchTasks).where(eq(researchTasks.id, row.id));
    return { task: (await viewsFor(tx, [fresh], options.actorPersonId, now))[0], replayed: false, supersededRunning: wasRunning };
  }); } finally { await database.close(); }
}

export type CancelOutcome = { task: TaskView; replayed: boolean;
  /** True only when this command moved the task to cancelled. False means it had already finished, failed or been cancelled: say what actually happened. */
  cancelled: boolean };

/** Cancel the organizer's own task. Reports the real state: a task that finished first stays finished and its result is kept. */
export async function cancelCoordinatorTask(input: { taskId: string; commandId: string }, options: ResearchOptions & { now?: Date }): Promise<CancelOutcome> {
  const database = createDatabase(options.databaseUrl), now = options.now ?? new Date();
  try { return await database.db.transaction(async tx => {
    const [scope] = await tx.select().from(researchTasks).where(eq(researchTasks.id, input.taskId));
    if (!scope) throw new CommandAccessError();
    await requireTripOrganizer(tx, scope.commonsId, options.actorPersonId);
    await assertCoordinatorTurnFenceInTransaction(tx, scope.commonsId, options.actorPersonId, options.turnFence);
    const [goalSchema] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_goals') is not null as present`);
    if (goalSchema?.present) {
      const [managed] = await tx.select({ id: coordinatorGoals.id }).from(coordinatorGoalSteps).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId)).where(eq(coordinatorGoalSteps.refId, input.taskId)).limit(1);
      if (managed) throw new TaskNotAmendableError("managed_goal_use_goal_controls");
    }
    const [row] = await tx.select().from(researchTasks).where(eq(researchTasks.id, input.taskId)).for("update");
    if (!row) throw new CommandAccessError();
    // Cancelling needs the organizer to still be active, but not the thread: an archived thread's work can still be stopped.
    await authorizeTaskActor(tx, row.commonsId, row.threadId, options.actorPersonId, false);
    if (row.requestedByPersonId !== options.actorPersonId) throw new CommandAccessError();
    const fingerprint = commandFingerprint(options.actorPersonId, "task.cancel", { taskId: input.taskId });
    const [previous] = await tx.select().from(coordinatorTaskEvents).where(and(eq(coordinatorTaskEvents.commonsId, row.commonsId), eq(coordinatorTaskEvents.commandId, input.commandId)));
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.taskId !== row.id) throw new CommandConflictError();
      return { task: (await viewsFor(tx, [row], options.actorPersonId, now))[0], replayed: true, cancelled: previous.summary !== "no_change" };
    }
    const state = await taskState(tx, row.id), revision = state?.revision ?? 1;
    const active = ["pending", "processing", "needs_input"].includes(row.status);
    if (active) {
      await tx.update(researchTasks).set({ status: "cancelled", leaseExpiresAt: null, updatedAt: now }).where(eq(researchTasks.id, row.id));
      await tx.update(researchAttempts).set({ status: "cancelled", finishedAt: now }).where(and(eq(researchAttempts.taskId, row.id), eq(researchAttempts.status, "processing")));
      if (state) await tx.update(coordinatorTaskState).set({ needsInput: null, updatedAt: now }).where(eq(coordinatorTaskState.taskId, row.id));
    }
    // Recorded either way, so a retried command reports the same thing and the history shows the request.
    await tx.insert(coordinatorTaskEvents).values({ commonsId: row.commonsId, taskId: row.id, threadId: row.threadId, actorPersonId: options.actorPersonId, kind: "cancelled", revision,
      commandId: input.commandId, fingerprint, summary: active ? null : "no_change" });
    const [fresh] = await tx.select().from(researchTasks).where(eq(researchTasks.id, row.id));
    return { task: (await viewsFor(tx, [fresh], options.actorPersonId, now))[0], replayed: false, cancelled: active };
  }); } finally { await database.close(); }
}

/** Organizer-visible history of a task (correction provenance), oldest first. Never includes provider output. */
export async function readCoordinatorTaskHistory(taskId: string, options: ResearchOptions & { commonsId?: string; threadId?: string }) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const [row] = await tx.select().from(researchTasks).where(eq(researchTasks.id, taskId));
    if (!row || (options.commonsId && row.commonsId !== options.commonsId) || (options.threadId && row.threadId !== options.threadId)) throw new CommandAccessError();
    await authorizeTaskActor(tx, row.commonsId, row.threadId, options.actorPersonId, false);
    const events = await tx.select({ event: coordinatorTaskEvents, name: people.displayName }).from(coordinatorTaskEvents).leftJoin(people, eq(people.id, coordinatorTaskEvents.actorPersonId))
      .where(eq(coordinatorTaskEvents.taskId, taskId)).orderBy(asc(coordinatorTaskEvents.createdAt));
    return events.map(({ event, name }) => ({ kind: event.kind, revision: event.revision, at: event.createdAt.toISOString(), by: name, summary: event.summary }));
  }); } finally { await database.close(); }
}

/**
 * Show a subthread task's current result once in the main conversation. Allowed only for the organizer who started the task, for a task started in a
 * subthread of this trip, when the result being linked is the task's current revision (a superseded or outdated result is refused), and with a summary built
 * by code from the saved result alone: never from the brief, the thread title, or any message. Deduplicated by task and revision.
 */
export async function linkTaskOutcomeToMain(input: { taskId: string; revision: number }, options: ResearchOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const [scope] = await tx.select().from(researchTasks).where(eq(researchTasks.id, input.taskId));
    if (!scope) throw new CommandAccessError();
    await requireTripOrganizer(tx, scope.commonsId, options.actorPersonId);
    const [goalSchema] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_goals') is not null as present`);
    if (goalSchema?.present) {
      const [managed] = await tx.select({ id: coordinatorGoals.id }).from(coordinatorGoalSteps).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId)).where(eq(coordinatorGoalSteps.refId, input.taskId)).limit(1);
      if (managed) throw new TaskNotAmendableError("managed_goal_use_goal_controls");
    }
    const [row] = await tx.select().from(researchTasks).where(eq(researchTasks.id, input.taskId)).for("update");
    if (!row) throw new CommandAccessError();
    await authorizeTaskActor(tx, row.commonsId, row.threadId, options.actorPersonId, true);
    if (row.requestedByPersonId !== options.actorPersonId) throw new CommandAccessError();
    const state = await taskState(tx, row.id);
    if (!state || row.status !== "succeeded" || state.revision !== input.revision || state.resultRevision !== input.revision || !row.result) throw new TaskNotAmendableError(state && state.revision !== input.revision ? "outdated" : row.status);
    const source = await threadRelation(tx, row.threadId);
    if (!source || source.kind !== "sub" || !source.parentThreadId) throw new TaskNotAmendableError("not_in_subthread");
    const [main] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, source.parentThreadId), eq(coordinatorThreads.commonsId, row.commonsId))).for("share");
    const mainRelation = main ? await threadRelation(tx, main.id) : null;
    if (!main || main.status !== "active" || mainRelation?.kind !== "main") throw new TaskNotAmendableError("no_main");
    const result = row.result, count = result.sources.length;
    const summary = `${state.title.slice(0, 80)} · ${result.status === "unavailable" ? "no usable sources" : `${count} ${count === 1 ? "source" : "sources"}${result.status === "partial" ? ", partial coverage" : ""}`}`;
    const [inserted] = await tx.insert(coordinatorThreadOutcomes).values({ commonsId: row.commonsId, sourceThreadId: row.threadId, targetThreadId: main.id, taskId: row.id, taskRevision: input.revision,
      summary, createdByPersonId: options.actorPersonId }).onConflictDoNothing().returning();
    return { created: Boolean(inserted), targetThreadId: main.id, summary };
  }); } finally { await database.close(); }
}

export async function listThreadOutcomes(commonsId: string, threadId: string, options: ResearchOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    await authorizeTaskActor(tx, commonsId, threadId, options.actorPersonId, false);
    const rows = await tx.select({ outcome: coordinatorThreadOutcomes, title: coordinatorThreads.title }).from(coordinatorThreadOutcomes)
      .innerJoin(coordinatorThreads, eq(coordinatorThreads.id, coordinatorThreadOutcomes.sourceThreadId))
      .where(and(eq(coordinatorThreadOutcomes.commonsId, commonsId), eq(coordinatorThreadOutcomes.targetThreadId, threadId))).orderBy(asc(coordinatorThreadOutcomes.createdAt));
    return rows.map(({ outcome, title }) => ({ id: outcome.id, sourceThreadId: outcome.sourceThreadId, sourceTitle: title, taskId: outcome.taskId, taskRevision: outcome.taskRevision, summary: outcome.summary, at: outcome.createdAt.toISOString() }));
  }); } finally { await database.close(); }
}

export { taskRunId };
