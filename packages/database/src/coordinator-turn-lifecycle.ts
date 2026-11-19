import { COORDINATOR_FAILED_TURN_TEXT, COORDINATOR_PENDING_TURN_TEXT, CoordinatorThreadStateSchema, CoordinatorTurnLifecycleSchema, assertCoordinatorTurnRowInvariants, type CoordinatorThreadState, type CoordinatorTurnLifecycle, type CoordinatorWorkspace } from "@commons/contracts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { CommandTransaction } from "./event-command";
import { CoordinatorTurnError } from "./coordinator-errors";
import { coordinatorTurns } from "./schema";

/*
 * Coordinator turn lifecycle without a schema change (docs/COORDINATOR-WORKSPACE-DESIGN.md §5).
 *
 * The lifecycle of a turn lives in the existing `coordinator_turns.workspace` jsonb under `lifecycle`, and thread
 * summaries under `threadState`. There are no CHECK constraints for either, so this module is the only place that
 * builds them, and every write goes through `writeLifecycle` / `buildThreadState`, which validate with the contracts.
 * Rows without `lifecycle` are turns saved before the feature: completed text turns.
 */

export type TurnRow = typeof coordinatorTurns.$inferSelect;

/** Placeholder answers keep `assistant_text` (NOT NULL, rendered verbatim by older code) meaningful for pending/failed rows. */
export function placeholderAnswer(status: CoordinatorTurnLifecycle["status"]) {
  return status === "failed" ? COORDINATOR_FAILED_TURN_TEXT : COORDINATOR_PENDING_TURN_TEXT;
}

/** The lifecycle of a stored turn; absent = legacy completed text turn. A stored but invalid lifecycle is an internal error, never guessed. */
export function lifecycleOf(row: Pick<TurnRow, "workspace" | "createdAt">): CoordinatorTurnLifecycle {
  const stored = row.workspace?.lifecycle;
  if (stored === undefined) {
    return { v: 1, status: "completed", inputMode: "text", errorCode: null, attempt: 1, leaseExpiresAt: null, spokenReply: null, sources: [], completedAt: row.createdAt.toISOString(), provisionalTitle: null };
  }
  const parsed = CoordinatorTurnLifecycleSchema.safeParse(stored);
  if (!parsed.success) throw new CoordinatorTurnError("internal_error");
  return parsed.data;
}

/** Validates the invariants the removed CHECK constraints used to hold, then returns the workspace to store. */
export function writeLifecycle(base: CoordinatorWorkspace | null | undefined, lifecycle: CoordinatorTurnLifecycle, assistantText: string): { workspace: CoordinatorWorkspace; assistantText: string } {
  const validated = CoordinatorTurnLifecycleSchema.parse(lifecycle);
  assertCoordinatorTurnRowInvariants({ assistantText, lifecycle: validated });
  return { workspace: { ...(base ?? {}), lifecycle: validated }, assistantText };
}

/** SQL: the stored status, defaulting to completed for legacy rows. */
export const turnStatusSql = sql<string>`coalesce(${coordinatorTurns.workspace}->'lifecycle'->>'status', 'completed')`;
/** SQL condition: the turn is completed (or predates the lifecycle). */
export const turnIsCompletedSql = sql`${turnStatusSql} = 'completed'`;

/** SQL guard for an attempt-scoped transition; combined with the row lock this makes complete/fail attempt-guarded in the database itself. */
export function turnLifecycleIs(status: CoordinatorTurnLifecycle["status"], attempt: number) {
  return and(sql`${coordinatorTurns.workspace}->'lifecycle'->>'status' = ${status}`, sql`(${coordinatorTurns.workspace}->'lifecycle'->>'attempt')::int = ${attempt}`);
}

/** Removes the internal storage keys before a workspace is handed to callers that only care about artifacts. */
export function publicWorkspace(workspace: CoordinatorWorkspace | null | undefined): CoordinatorWorkspace | null {
  if (!workspace) return null;
  const { lifecycle: _lifecycle, threadState: _threadState, ...rest } = workspace;
  return Object.keys(rest).length ? rest : null;
}

/** Builds the next thread state from the previous one plus the model's optional update. Enforces every bound in code. */
export function buildThreadState(previous: CoordinatorThreadState | null, update: { summary?: string; openQuestions?: string[]; generatedTitle?: string }, turnSequence: number): CoordinatorThreadState {
  const summary = update.summary !== undefined ? update.summary.replace(/\s+/g, " ").trim().slice(0, 400) || null : previous?.summary ?? null;
  const openQuestions = (update.openQuestions ?? previous?.openQuestions ?? []).map(question => question.replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, 3);
  return CoordinatorThreadStateSchema.parse({
    v: 1, summary, openQuestions,
    summaryTurnVersion: update.summary !== undefined || update.openQuestions !== undefined ? turnSequence : previous?.summaryTurnVersion ?? null,
    generatedTitle: update.generatedTitle ?? previous?.generatedTitle ?? null,
  });
}

export type ThreadMeta = { state: CoordinatorThreadState | null; titleSource: "organizer" | "provisional" | "generated" };

/**
 * Newest thread state per thread plus the derived title source. Three bounded queries scoped by trip and thread ids:
 * the newest state-bearing turn per thread, each thread's first turn (an index range on the thread/sequence unique index), and the
 * navigation receipts that created threads (a filter over this trip's turns; a trip has tens to low hundreds of turns, and there is no partial index without a migration).
 * `titleSource`: the title still equal to the generated title => generated; still equal to the title this thread was created
 * with => provisional; anything else (an organizer rename, an organizer-named thread, a thread made by navigation) => organizer.
 */
export async function readThreadMeta(tx: CommandTransaction, commonsId: string, threads: Array<{ id: string; title: string }>): Promise<Map<string, ThreadMeta>> {
  const result = new Map<string, ThreadMeta>();
  if (!threads.length) return result;
  const ids = threads.map(thread => thread.id);
  const states = await tx.selectDistinctOn([coordinatorTurns.threadId], { threadId: coordinatorTurns.threadId, state: sql<unknown>`${coordinatorTurns.workspace}->'threadState'` }).from(coordinatorTurns)
    .where(and(eq(coordinatorTurns.commonsId, commonsId), inArray(coordinatorTurns.threadId, ids), sql`${coordinatorTurns.workspace}->'threadState' is not null`))
    .orderBy(coordinatorTurns.threadId, desc(coordinatorTurns.sequence));
  const firsts = await tx.select({ threadId: coordinatorTurns.threadId, provisionalTitle: sql<string | null>`${coordinatorTurns.workspace}->'lifecycle'->>'provisionalTitle'` }).from(coordinatorTurns)
    .where(and(eq(coordinatorTurns.commonsId, commonsId), inArray(coordinatorTurns.threadId, ids), eq(coordinatorTurns.sequence, 1)));
  // "Start a separate thread" creates the thread with a receipt turn in the ORIGIN thread; that receipt names the new thread and its provisional title.
  const navigated = await tx.select({ threadId: sql<string>`${coordinatorTurns.workspace}->'navigation'->>'threadId'`, title: sql<string>`${coordinatorTurns.workspace}->'navigation'->>'title'` }).from(coordinatorTurns)
    .where(and(eq(coordinatorTurns.commonsId, commonsId), sql`${coordinatorTurns.workspace}->'navigation'->>'kind' = 'created'`, sql`${coordinatorTurns.workspace}->'navigation'->>'threadId' in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})`));
  for (const thread of threads) {
    const parsed = CoordinatorThreadStateSchema.safeParse(states.find(row => row.threadId === thread.id)?.state);
    const state = parsed.success ? parsed.data : null;
    const createdWith = [firsts.find(row => row.threadId === thread.id)?.provisionalTitle, navigated.find(row => row.threadId === thread.id)?.title];
    result.set(thread.id, { state, titleSource: state?.generatedTitle && state.generatedTitle === thread.title ? "generated" : createdWith.includes(thread.title) ? "provisional" : "organizer" });
  }
  return result;
}

/**
 * The lifecycle fields of the API turn (`CoordinatorTurnSchema`): derived from `workspace.lifecycle`, so legacy turns read
 * as completed text turns. `assistantText` is left as stored (a placeholder for pending/failed rows) so no client ever gets an empty answer.
 */
export function turnLifecycleView(row: Pick<TurnRow, "workspace" | "createdAt">) {
  const life = lifecycleOf(row);
  return { status: life.status, inputMode: life.inputMode, errorCode: life.errorCode, spokenReply: life.spokenReply, sources: life.sources, workspace: publicWorkspace(row.workspace) };
}
