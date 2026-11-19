import { coordinatorTurns, lifecycleOf, readThreadMeta, type createDatabase } from "@commons/database";
import type { CoordinatorTurnLifecycle, CoordinatorWorkspace } from "@commons/contracts";
import { eq, sql } from "drizzle-orm";

/*
 * The turn lifecycle and thread summaries live in `workspace.lifecycle` / `workspace.threadState` (no migration).
 * Tests that read rows directly go through these helpers so assertions keep their intent (status, attempt, sources,
 * title source, summary) without depending on the storage shape.
 */

type Db = ReturnType<typeof createDatabase>["db"];

export function withLifecycleView<T extends { workspace: CoordinatorWorkspace | null; createdAt: Date }>(row: T) {
  const life = lifecycleOf(row);
  return { ...row, status: life.status, inputMode: life.inputMode, errorCode: life.errorCode, attempt: life.attempt, leaseExpiresAt: life.leaseExpiresAt ? new Date(life.leaseExpiresAt) : null, spokenReply: life.spokenReply, sources: life.sources, completedAt: life.completedAt };
}

export async function withThreadMeta<T extends { id: string; title: string }>(db: Db, commonsId: string, threads: T[]) {
  const meta = await readThreadMeta(db as never, commonsId, threads);
  return threads.map(thread => ({ ...thread, titleSource: meta.get(thread.id)!.titleSource, summary: meta.get(thread.id)!.state?.summary ?? null,
    summaryTurnVersion: meta.get(thread.id)!.state?.summaryTurnVersion ?? null, openQuestions: meta.get(thread.id)!.state?.openQuestions ?? [] }));
}

/** Simulates an expired lease by rewriting the stored lifecycle. */
export async function expireLease(db: Db, commandId: string) {
  await db.update(coordinatorTurns).set({ workspace: sql`jsonb_set(${coordinatorTurns.workspace}, '{lifecycle,leaseExpiresAt}', to_jsonb(${new Date(Date.now() - 1000).toISOString()}::text))` }).where(eq(coordinatorTurns.commandId, commandId));
}

/** A stored failed lifecycle, for fixtures that insert rows directly. */
export function failedWorkspace(errorCode: NonNullable<CoordinatorTurnLifecycle["errorCode"]>, inputMode: "text" | "voice" = "text"): CoordinatorWorkspace {
  return { lifecycle: { v: 1, status: "failed", inputMode, errorCode, attempt: 1, leaseExpiresAt: null, spokenReply: null, sources: [], completedAt: null, provisionalTitle: null } };
}
