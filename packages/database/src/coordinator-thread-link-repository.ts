import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { CommandConflictError, commandFingerprint, type CommandTransaction } from "./event-command";
import { coordinatorThreadLinks, coordinatorThreads, researchTasks } from "./schema";
import { requireTripOrganizer } from "./coordinator-turn-repository";
import { CoordinatorTurnError } from "./coordinator-errors";
import type { PollRepositoryOptions } from "./poll-repository";

/*
 * One main coordinator conversation per trip, and optional subthreads (docs/COORDINATOR-CONTINUITY-REVIEW.md). Kept beside coordinator_threads in
 * coordinator_thread_links so nothing that reads threads today depends on this migration. The one-main rule is a partial unique index; creation also
 * runs under the trip lock, so two organizers arriving together create one row and the second simply reads it.
 */

export const MAIN_THREAD_TITLE = "Trip conversation";
export const SUBTHREAD_MAX_BRIEF = 1000;
export const SUBTHREAD_MAX_TASK_REFS = 6;

function derived(commonsId: string, label: string) {
  const bytes = createHash("sha256").update(`${commonsId}:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type ThreadRelation = { kind: "main" | "sub" | "task"; parentThreadId: string | null; brief: string | null; briefTaskIds: string[] };
export async function threadRelation(tx: CommandTransaction, threadId: string): Promise<ThreadRelation | null> {
  const [link] = await tx.select().from(coordinatorThreadLinks).where(eq(coordinatorThreadLinks.threadId, threadId));
  return link ? { kind: link.kind, parentThreadId: link.parentThreadId, brief: link.brief, briefTaskIds: link.briefTaskIds } : null;
}

async function mainIn(tx: CommandTransaction, commonsId: string) {
  const [row] = await tx.select({ thread: coordinatorThreads, link: coordinatorThreadLinks }).from(coordinatorThreadLinks)
    .innerJoin(coordinatorThreads, eq(coordinatorThreads.id, coordinatorThreadLinks.threadId))
    .where(and(eq(coordinatorThreadLinks.commonsId, commonsId), eq(coordinatorThreadLinks.kind, "main")));
  return row?.thread ?? null;
}

/**
 * The trip's main conversation, created on first use by an active organizer. Idempotent and safe under concurrency: the trip row lock serializes
 * creators and the partial unique index makes a second main impossible even if that lock were bypassed. An archived main is returned as it is; the
 * caller decides how to present it. Existing threads are never touched: this trip has no earlier designation to adopt, so a new row is made.
 */
export async function ensureMainThreadInTransaction(tx: CommandTransaction, commonsId: string, actorPersonId: string, now = new Date()) {
  const existing = await mainIn(tx, commonsId);
  if (existing) return existing;
  const id = derived(commonsId, "main-thread"), commandId = derived(commonsId, "main-thread-command");
  await tx.insert(coordinatorThreads).values({ id, commonsId, createdByPersonId: actorPersonId, title: MAIN_THREAD_TITLE, lastCommandId: commandId,
    lastCommandFingerprint: commandFingerprint(actorPersonId, "coordinator.main_thread", { commonsId }), createdAt: now, updatedAt: now }).onConflictDoNothing().returning();
  await tx.insert(coordinatorThreadLinks).values({ threadId: id, commonsId, kind: "main" }).onConflictDoNothing();
  const main = await mainIn(tx, commonsId);
  if (!main) throw new CoordinatorTurnError("internal_error");
  return main;
}

export async function ensureMainThread(identifier: string, options: PollRepositoryOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const commonsId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    const main = await ensureMainThreadInTransaction(tx, commonsId, options.actorPersonId);
    return { id: main.id, title: main.title, status: main.status, version: main.version };
  }); } finally { await database.close(); }
}

export type SubthreadInput = { id?: string; commandId: string; title: string; brief: string; parentThreadId: string; briefTaskIds?: string[] };

/**
 * Start a subthread the organizer asked for, with an attributed starting brief. Nothing moves: no message, draft, task or result changes thread, and
 * a referenced task keeps its identity and origin. Referenced tasks must belong to this trip. Replaying the command returns the same thread.
 */
export async function startSubthread(identifier: string, input: SubthreadInput, options: PollRepositoryOptions) {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 120), brief = input.brief.trim().slice(0, SUBTHREAD_MAX_BRIEF);
  if (!title) throw new CoordinatorTurnError("invalid_request");
  const taskIds = [...new Set(input.briefTaskIds ?? [])].slice(0, SUBTHREAD_MAX_TASK_REFS);
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    const commonsId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    const fingerprint = commandFingerprint(options.actorPersonId, "coordinator.subthread", { title, brief, parentThreadId: input.parentThreadId, taskIds });
    const [replay] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.commonsId, commonsId), eq(coordinatorThreads.lastCommandId, input.commandId)));
    if (replay) {
      if (replay.lastCommandFingerprint !== fingerprint) throw new CommandConflictError();
      return { id: replay.id, title: replay.title, replayed: true };
    }
    const [parent] = await tx.select().from(coordinatorThreads).where(and(eq(coordinatorThreads.id, input.parentThreadId), eq(coordinatorThreads.commonsId, commonsId))).for("share");
    if (!parent) throw new CoordinatorTurnError("thread_unavailable");
    if (parent.status !== "active") throw new CoordinatorTurnError("thread_archived");
    if (taskIds.length) {
      const found = await tx.select({ id: researchTasks.id }).from(researchTasks).where(and(inArray(researchTasks.id, taskIds), eq(researchTasks.commonsId, commonsId)));
      if (found.length !== taskIds.length) throw new CoordinatorTurnError("artifact_missing");
    }
    const id = input.id ?? derived(commonsId, `subthread:${input.commandId}`);
    const [collision] = await tx.select({ id: coordinatorThreads.id }).from(coordinatorThreads).where(eq(coordinatorThreads.id, id));
    if (collision) throw new CommandConflictError();
    await tx.insert(coordinatorThreads).values({ id, commonsId, createdByPersonId: options.actorPersonId, title, lastCommandId: input.commandId, lastCommandFingerprint: fingerprint });
    await tx.insert(coordinatorThreadLinks).values({ threadId: id, commonsId, kind: "sub", parentThreadId: parent.id, brief: brief || null, briefTaskIds: taskIds });
    return { id, title, replayed: false };
  }); } finally { await database.close(); }
}

/** Relations for the threads a trip has. Used only when steering is on. */
export async function listThreadRelations(commonsId: string, options: PollRepositoryOptions) {
  const database = createDatabase(options.databaseUrl);
  try { return await database.db.transaction(async tx => {
    await requireTripOrganizer(tx, commonsId, options.actorPersonId, false);
    const rows = await tx.select().from(coordinatorThreadLinks).where(eq(coordinatorThreadLinks.commonsId, commonsId));
    return rows.map(row => ({ threadId: row.threadId, kind: row.kind, parentThreadId: row.parentThreadId, brief: row.brief, briefTaskIds: row.briefTaskIds }));
  }); } finally { await database.close(); }
}
