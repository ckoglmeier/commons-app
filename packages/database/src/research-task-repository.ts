import { assertCoordinatorTurnFenceInTransaction, type CoordinatorTurnFence } from "./coordinator-turn-repository";
import { createHash } from "node:crypto";
import { projectResearchGoalInTransaction } from "./coordinator-goal-repository";
import { and, asc, eq, gt, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { CoordinatorResearchSchema, ResearchDelegationRequestSchema, type CoordinatorResearch, type ResearchDelegationRequest } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError, commandFingerprint, type CommandTransaction } from "./event-command";
import { commons, coordinatorGoalSteps, coordinatorResearchRuns, coordinatorTaskEvents, coordinatorTaskState, coordinatorThreads, coordinatorTurns, memberships, researchAttempts, researchTasks } from "./schema";
import { DELIVERY_LEASE_MS, DELIVERY_MAX_ATTEMPTS, DELIVERY_RETRY_MS, ownsDeliveryLease } from "./delivery-lease";

export const RESEARCH_AGENT_ID = "00000000-0000-4000-8000-000000000001";
/** The per-trip hourly bound or the organizer's outstanding-task bound was reached. A conflict subclass, so older handlers keep treating it as one. */
export class TaskLimitError extends CommandConflictError { constructor() { super(); this.name = "TaskLimitError"; } }
export type ResearchOptions = { databaseUrl?: string; actorPersonId: string; turnFence?: CoordinatorTurnFence; inferenceLimitExempt?: boolean };
type Task = typeof researchTasks.$inferSelect;

// This slice supports shared organizer threads only. Hold authorization locks
// through each transaction so revocation cannot race result publication.
export async function authorizeTaskActor(tx: CommandTransaction, event: string, thread: string, actor: string, active = true) {
  return authorize(tx, event, thread, actor, active);
}
/** Provider concurrency per organizer and trip, and the bound on work an organizer can have outstanding at once. */
export const TASK_MAX_RUNNING = 2;
export const TASK_MAX_OUTSTANDING = 6;
export const TASK_MAX_BRIEF = 1500;
export const TASK_MAX_TITLE = 120;
/** A stable id for the research run a task revision saves, so a replayed commit can never write a second run. */
export function taskRunId(taskId: string, revision: number) {
  const bytes = createHash("sha256").update(`${taskId}:run:${revision}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
let stateTableSeen = false;
/**
 * The steering state of a task, or null for a task that has none. A database where migration 0074 has not been applied has no such table (Preview and
 * Production share one database and Preview builds never migrate), and the older research worker must keep working there: it reads "no steering state".
 */
export async function taskState(tx: CommandTransaction, taskId: string) {
  if (!stateTableSeen) {
    const [found] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_task_state') is not null as present`);
    if (!found?.present) return null;
    stateTableSeen = true;
  }
  const [state] = await tx.select().from(coordinatorTaskState).where(eq(coordinatorTaskState.taskId, taskId));
  return state ?? null;
}
async function authorize(tx: CommandTransaction, event: string, thread: string, actor: string, active = true) {
  const [member] = await tx.select().from(memberships).where(and(eq(memberships.commonsId, event),
    eq(memberships.personId, actor), eq(memberships.status, "active"), eq(memberships.role, "organizer"))).for("share");
  const [scope] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, thread), eq(coordinatorThreads.commonsId, event))).for("share");
  if (!member || !scope || (active && scope.status !== "active")) throw new CommandAccessError();
}
function receipt(row: Task) {
  return { protocolVersion: 1 as const, taskId: row.id, commandId: row.commandId, acceptedAt: row.createdAt.toISOString() };
}
export type SteerableStart = { title: string; brief: string; contextVersion: number | null };
export async function queueResearchTask(raw: unknown, options: ResearchOptions, steer?: SteerableStart) {
  const input = ResearchDelegationRequestSchema.parse(raw);
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(tx => queueResearchTaskInTransaction(tx, input, options, steer)); } finally { await database.close(); }
}
/** The acceptance rules of `queueResearchTask`, for a caller that already holds a transaction (a goal starting its research step). */
export async function queueResearchTaskInTransaction(tx: CommandTransaction, input: ResearchDelegationRequest, options: ResearchOptions, steer?: SteerableStart) {
  if (input.caller.kind !== "human" || input.caller.personId !== options.actorPersonId
    || input.routing.kind !== "commons_specialist" || input.parentTaskId !== null) throw new CommandAccessError();
  {
    // Serialize acceptance and the per-event spend limit, including distinct keys.
    await tx.select({ id: commons.id }).from(commons).where(eq(commons.id, input.commonsId)).for("update");
    await assertCoordinatorTurnFenceInTransaction(tx, input.commonsId, options.actorPersonId, options.turnFence);
    await authorize(tx, input.commonsId, input.threadId, options.actorPersonId);
    const fingerprint = steer ? commandFingerprint(options.actorPersonId, "research.delegate.steered", { input, title: steer.title, brief: steer.brief }) : commandFingerprint(options.actorPersonId, "research.delegate", input);
    const [previous] = await tx.select().from(researchTasks).where(and(eq(researchTasks.commonsId, input.commonsId), eq(researchTasks.commandId, input.commandId)));
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new CommandConflictError();
      return receipt(previous);
    }
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(researchTasks)
      .where(and(eq(researchTasks.commonsId, input.commonsId), gte(researchTasks.createdAt, new Date(Date.now() - 3600_000))));
    if (!options.inferenceLimitExempt && usage.count >= 10) throw new TaskLimitError();
    if (steer && !options.inferenceLimitExempt) {
      const [outstanding] = await tx.select({ count: sql<number>`count(*)::int` }).from(researchTasks)
        .where(and(eq(researchTasks.commonsId, input.commonsId), eq(researchTasks.requestedByPersonId, options.actorPersonId), inArray(researchTasks.status, ["pending", "processing", "needs_input"])));
      if (outstanding.count >= TASK_MAX_OUTSTANDING) throw new TaskLimitError();
    }
    const [row] = await tx.insert(researchTasks).values({ commonsId: input.commonsId, threadId: input.threadId,
      requestedByPersonId: options.actorPersonId, commandId: input.commandId, fingerprint, request: input }).returning();
    if (steer) {
      const contextVersion = steer.contextVersion ?? (await tx.select({ value: sql<number>`coalesce(max(${coordinatorTurns.sequence}), 0)::int` }).from(coordinatorTurns).where(eq(coordinatorTurns.threadId, input.threadId)))[0].value;
      await tx.insert(coordinatorTaskState).values({ taskId: row.id, commonsId: input.commonsId, title: steer.title.slice(0, TASK_MAX_TITLE), brief: steer.brief.slice(0, TASK_MAX_BRIEF), revision: 1, contextVersion });
      await tx.insert(coordinatorTaskEvents).values({ commonsId: input.commonsId, taskId: row.id, threadId: input.threadId, actorPersonId: options.actorPersonId, kind: "started", revision: 1, summary: steer.brief.slice(0, 500) });
    }
    return receipt(row);
  }
}
export async function readResearchTask(taskId: string, options: ResearchOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const [row] = await tx.select().from(researchTasks).where(eq(researchTasks.id, taskId));
    if (!row) throw new CommandAccessError();
    await authorize(tx, row.commonsId, row.threadId, options.actorPersonId, false);
    const attempts = await tx.select().from(researchAttempts).where(eq(researchAttempts.taskId, taskId)).orderBy(asc(researchAttempts.attempt));
    return { ...receipt(row), status: row.status, result: row.result, errorCode: row.errorCode, attempts };
  }); } finally { await database.close(); }
}
export async function cancelResearchTask(taskId: string, options: ResearchOptions & { commonsId?: string; threadId?: string }) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const [candidate] = await tx.select({ commonsId: researchTasks.commonsId }).from(researchTasks).where(eq(researchTasks.id, taskId));
    if (!candidate) throw new CommandAccessError();
    // Same trip-first order as workflow commits/review replay. Task-first plus
    // authorize's parent lock can deadlock against an atomic workflow command.
    await tx.select({ id: commons.id }).from(commons).where(eq(commons.id, candidate.commonsId)).for("update");
    const [row] = await tx.select().from(researchTasks).where(and(eq(researchTasks.id, taskId), eq(researchTasks.commonsId, candidate.commonsId))).for("update");
    if (!row || (options.commonsId && row.commonsId !== options.commonsId) || (options.threadId && row.threadId !== options.threadId)) throw new CommandAccessError();
    await authorize(tx, row.commonsId, row.threadId, options.actorPersonId, false);
    if (["pending", "processing"].includes(row.status)) {
      const now = new Date();
      await tx.update(researchTasks).set({ status: "cancelled", leaseExpiresAt: null, updatedAt: now }).where(eq(researchTasks.id, taskId));
      await tx.update(researchAttempts).set({ status: "cancelled", finishedAt: now }).where(and(eq(researchAttempts.taskId, taskId), eq(researchAttempts.status, "processing")));
    }
    return receipt(row);
  }); } finally { await database.close(); }
}

/**
 * What a worker holds while it works. `attempt` is the claim counter (never reset), so it is the fence: once a correction, cancellation, takeover or
 * revocation moves the row, no earlier lease matches it again. `revision` is the brief revision the work was claimed for.
 */
export type TaskLease = { taskId: string; attemptId: string; attempt: number; revision: number; query: string; commonsId: string; threadId: string; actorPersonId: string };

export async function claimResearchTask(databaseUrl?: string, now = new Date(), workflowHandler?: { key: string; version: number }): Promise<TaskLease | null> {
  const database = createDatabase(databaseUrl);
  try {
    const [schema] = await database.db.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_goal_steps') is not null as present`);
    if (workflowHandler && !schema?.present) return null;
    const workflowFilter = schema?.present ? workflowHandler
      ? sql`exists (select 1 from ${coordinatorGoalSteps} s where s.ref_id = ${researchTasks.id} and s.result->'workflowExecution'->'handler'->>'key' = ${workflowHandler.key} and s.result->'workflowExecution'->'handler'->>'version' = ${String(workflowHandler.version)})`
      : sql`not exists (select 1 from ${coordinatorGoalSteps} s where s.ref_id = ${researchTasks.id} and (s.result->'workflowExecution' is not null or s.result->'workflowExecutionPending' is not null))` : undefined;
    const candidates = await database.db.select({ id: researchTasks.id, commonsId: researchTasks.commonsId }).from(researchTasks).where(and(workflowFilter, or(
      and(eq(researchTasks.status, "pending"), lte(researchTasks.availableAt, now)),
      and(eq(researchTasks.status, "processing"), lte(researchTasks.leaseExpiresAt, now)),
    ))).orderBy(asc(researchTasks.availableAt)).limit(25);
    for (const candidate of candidates) {
      const claimed = await database.db.transaction(async tx => {
        // Generic workflow publication shares goal locks with organizer commands.
        // Acquire the trip first to avoid task -> goal / trip -> task inversion.
        if (workflowHandler) await tx.select({ id: commons.id }).from(commons).where(eq(commons.id, candidate.commonsId)).for("update");
        const [row] = await tx.select().from(researchTasks).where(and(workflowFilter, eq(researchTasks.id, candidate.id), or(
          and(eq(researchTasks.status, "pending"), lte(researchTasks.availableAt, now)),
          and(eq(researchTasks.status, "processing"), lte(researchTasks.leaseExpiresAt, now)),
        ))).for("update", { skipLocked: true });
        if (!row) return "skip" as const;
        // The claiming statement's snapshot can predate a bind that committed
        // just before this row lock. Binding holds the task lock, but does not
        // update the task row, so PostgreSQL need not re-evaluate that anti-join.
        // A fresh statement under the acquired task lock closes legacy adoption.
        if (!workflowHandler && schema?.present) {
          const [stillLegacy] = await tx.select({ id: researchTasks.id }).from(researchTasks).where(and(eq(researchTasks.id, row.id), workflowFilter));
          if (!stillLegacy) return "skip" as const;
        }
        // Bound provider concurrency per organizer and trip. The advisory lock serializes workers claiming for the same organizer, so two
        // workers holding different rows cannot both see "one running" and start a third.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${row.commonsId}:${row.requestedByPersonId}`}, 0))`);
        const [running] = await tx.select({ count: sql<number>`count(*)::int` }).from(researchTasks).where(and(eq(researchTasks.commonsId, row.commonsId),
          eq(researchTasks.requestedByPersonId, row.requestedByPersonId), eq(researchTasks.status, "processing"), gt(researchTasks.leaseExpiresAt, now), ne(researchTasks.id, row.id)));
        if (running.count >= TASK_MAX_RUNNING) return "skip" as const;
        const state = await taskState(tx, row.id);
        const revision = state?.revision ?? 1, base = state?.attemptsBase ?? 0;
        if (row.status === "processing") await tx.update(researchAttempts).set({ status: "expired", errorCode: "lease_expired", finishedAt: now })
          .where(and(eq(researchAttempts.taskId, row.id), eq(researchAttempts.attempt, row.attempts), eq(researchAttempts.status, "processing")));
        // Successful resumable stages do not consume the failure-retry allowance.
        const [failed] = workflowHandler ? await tx.select({ count: sql<number>`count(*)::int` }).from(researchAttempts)
          .where(and(eq(researchAttempts.taskId, row.id), gt(researchAttempts.attempt, base), inArray(researchAttempts.status, ["failed", "expired"]))) : [];
        let errorCode: string | null = (workflowHandler ? failed!.count : row.attempts - base) >= DELIVERY_MAX_ATTEMPTS ? "attempts_exhausted" : null;
        try { await authorize(tx, row.commonsId, row.threadId, row.requestedByPersonId); }
        catch (error) { if (!(error instanceof CommandAccessError)) throw error; errorCode = "access_revoked"; }
        if (errorCode) {
          await tx.update(researchTasks).set({ status: "failed", errorCode, leaseExpiresAt: null, updatedAt: now }).where(eq(researchTasks.id, row.id));
          if (state) await tx.insert(coordinatorTaskEvents).values({ commonsId: row.commonsId, taskId: row.id, threadId: row.threadId, kind: "failed", revision, summary: errorCode });
          if (workflowHandler) await projectResearchGoalInTransaction(tx, row.id, now);
          return "failed" as const;
        }
        const [attempt] = await tx.insert(researchAttempts).values({ taskId: row.id, attempt: row.attempts + 1, agentId: RESEARCH_AGENT_ID, status: "processing" }).returning();
        await tx.update(researchTasks).set({ status: "processing", attempts: attempt.attempt, errorCode: null,
          leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS), updatedAt: now }).where(eq(researchTasks.id, row.id));
        return { taskId: row.id, attemptId: attempt.id, attempt: attempt.attempt, revision, query: row.request.input.query,
          commonsId: row.commonsId, threadId: row.threadId, actorPersonId: row.requestedByPersonId } satisfies TaskLease;
      });
      if (claimed === "skip" || claimed === "failed") continue;
      return claimed;
    }
    return null;
  } finally { await database.close(); }
}

/** Why a finish was refused. Content-free: used for metrics and tests, never shown as prose. */
export type FinishOutcome = { committed: true; revision: number } | { committed: false; reason: "lease_lost" | "superseded" | "cancelled" | "attempt_missing" | "workflow_bound" };

/**
 * The only place a task result becomes current. Everything is decided inside one transaction under the task row lock, so a correction, cancellation,
 * takeover or revoked permission that committed first always wins and a late worker, in this process or any other, commits nothing.
 */
export async function finishResearchTaskDetailed(lease: Pick<TaskLease, "taskId" | "attemptId" | "attempt"> & { revision?: number },
  outcome: { result: CoordinatorResearch } | { errorCode: "provider_failed" | "deadline_exceeded" }, databaseUrl?: string, now = new Date()): Promise<FinishOutcome> {
  const result = "result" in outcome ? CoordinatorResearchSchema.parse(outcome.result) : null;
  const database = createDatabase(databaseUrl);
  try { return await database.db.transaction(async (tx): Promise<FinishOutcome> => {
    // Goal commands and result publication serialize on trip, before taking a task lock.
    // This avoids a task/goal lock inversion while preserving cancellation fences.
    const [scope] = await tx.select({ commonsId: researchTasks.commonsId }).from(researchTasks).where(eq(researchTasks.id, lease.taskId));
    if (scope) await tx.select({ id: commons.id }).from(commons).where(eq(commons.id, scope.commonsId)).for("update");
    const [row] = await tx.select().from(researchTasks).where(eq(researchTasks.id, lease.taskId)).for("update");
    if (!row) return { committed: false, reason: "lease_lost" };
    const [goalSchema] = await tx.execute<{ present: boolean }>(sql`select to_regclass('public.coordinator_goal_steps') is not null as present`);
    if (goalSchema?.present && (await tx.select({ id: coordinatorGoalSteps.id }).from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.refId, row.id), sql`(${coordinatorGoalSteps.result}->'workflowExecution' is not null or ${coordinatorGoalSteps.result}->'workflowExecutionPending' is not null)`)).limit(1)).length)
      return { committed: false, reason: "workflow_bound" };
    if (row.status === "cancelled") return { committed: false, reason: "cancelled" };
    const state = await taskState(tx, row.id);
    const revision = state?.revision ?? 1;
    // A revision mismatch is checked before the lease: a correction re-queues the task, so the lease of the work it replaced may still look alive.
    if (lease.revision !== undefined && lease.revision !== revision) return { committed: false, reason: "superseded" };
    if (!ownsDeliveryLease(row, lease.attempt, now)) return { committed: false, reason: "lease_lost" };
    const [attempt] = await tx.select().from(researchAttempts).where(and(eq(researchAttempts.id, lease.attemptId),
      eq(researchAttempts.taskId, row.id), eq(researchAttempts.attempt, lease.attempt), eq(researchAttempts.status, "processing")));
    if (!attempt) return { committed: false, reason: "attempt_missing" };
    let errorCode: string | null = "errorCode" in outcome ? outcome.errorCode : null;
    try { await authorize(tx, row.commonsId, row.threadId, row.requestedByPersonId); }
    catch (error) { if (!(error instanceof CommandAccessError)) throw error; errorCode = "access_revoked"; }
    if (result && result.query !== row.request.input.query) throw new CommandConflictError();
    const retry = errorCode && errorCode !== "access_revoked" && row.attempts - (state?.attemptsBase ?? 0) < DELIVERY_MAX_ATTEMPTS;
    const status = errorCode ? (retry ? "pending" : "failed") : "succeeded";
    let runId: string | null = null;
    if (!errorCode && result) {
      // A steered task saves one run per revision under a derived id; an older task keeps the id it always used.
      runId = state ? taskRunId(row.id, revision) : null;
      await tx.insert(coordinatorResearchRuns).values({ ...(runId ? { id: runId } : {}), threadId: row.threadId,
        createdByPersonId: row.requestedByPersonId, commandId: state ? runId! : row.id, ...result });
    }
    await tx.update(researchTasks).set({ status, errorCode, result: errorCode ? row.result : result,
      leaseExpiresAt: null, availableAt: new Date(now.getTime() + DELIVERY_RETRY_MS), updatedAt: now }).where(eq(researchTasks.id, row.id));
    await tx.update(researchAttempts).set({ status: errorCode ? "failed" : "succeeded", errorCode, finishedAt: now }).where(eq(researchAttempts.id, attempt.id));
    if (state) {
      if (!errorCode) {
        await tx.update(coordinatorTaskState).set({ resultRevision: revision, needsInput: null, updatedAt: now }).where(eq(coordinatorTaskState.taskId, row.id));
        await tx.insert(coordinatorTaskEvents).values({ commonsId: row.commonsId, taskId: row.id, threadId: row.threadId, kind: "completed", revision, runId });
      } else if (status === "failed") {
        await tx.insert(coordinatorTaskEvents).values({ commonsId: row.commonsId, taskId: row.id, threadId: row.threadId, kind: "failed", revision, summary: errorCode });
      }
    }
    await projectResearchGoalInTransaction(tx, row.id, now);
    return { committed: true, revision };
  }); } finally { await database.close(); }
}

export async function finishResearchTask(lease: Pick<TaskLease, "taskId" | "attemptId" | "attempt"> & { revision?: number },
  outcome: { result: CoordinatorResearch } | { errorCode: "provider_failed" | "deadline_exceeded" }, databaseUrl?: string, now = new Date()) {
  return (await finishResearchTaskDetailed(lease, outcome, databaseUrl, now)).committed;
}

/** Cheap checkpoint for a running worker: is this lease still the current, authorized, uncancelled claim? Advisory only: the commit transaction decides. */
export async function researchLeaseIsCurrent(lease: Pick<TaskLease, "taskId" | "attempt" | "revision">, databaseUrl?: string, now = new Date()) {
  const database = createDatabase(databaseUrl);
  try {
    const [row] = await database.db.select({ status: researchTasks.status, attempts: researchTasks.attempts, leaseExpiresAt: researchTasks.leaseExpiresAt }).from(researchTasks).where(eq(researchTasks.id, lease.taskId));
    if (!row || !ownsDeliveryLease(row, lease.attempt, now)) return false;
    const state = await database.db.transaction(tx => taskState(tx, lease.taskId));
    return (state?.revision ?? 1) === lease.revision;
  } finally { await database.close(); }
}

/** Resolve URL scope before accepting caller-supplied thread or task IDs. */
export async function researchWorkspaceScope(identifier: string, threadId: string, options: ResearchOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const [event] = await tx.select({ id: commons.id }).from(commons).where(or(eq(commons.slug, identifier), sql`${commons.id}::text = ${identifier}`));
    if (!event) throw new CommandAccessError();
    await authorize(tx, event.id, threadId, options.actorPersonId, false);
    return event.id;
  }); } finally { await database.close(); }
}
export async function listResearchTasks(commonsId: string, threadId: string, options: ResearchOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    await authorize(tx, commonsId, threadId, options.actorPersonId, false);
    const rows = await tx.select().from(researchTasks).where(and(eq(researchTasks.commonsId, commonsId), eq(researchTasks.threadId, threadId)))
      .orderBy(sql`${researchTasks.createdAt} desc`).limit(50);
    return rows.map(row => ({ taskId: row.id, query: row.request.input.query, status: row.status, errorCode: row.errorCode, acceptedAt: row.createdAt.toISOString() }));
  }); } finally { await database.close(); }
}
