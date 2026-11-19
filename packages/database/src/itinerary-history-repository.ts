import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { ItineraryEvidenceSchema, type ItineraryDraft } from "@commons/contracts";
import { createDatabase } from "./client";
import { coordinatorThreads, coordinatorTurns } from "./schema";
import { requireTripOrganizer } from "./coordinator-turn-repository";
import { turnIsCompletedSql, turnStatusSql } from "./coordinator-turn-lifecycle";
import { CommandAccessError } from "./event-command";
import type { PollRepositoryOptions } from "./poll-repository";

export type ItineraryHistoryEntry = {
  turnId: string; sequence: number; actorId: string; at: string;
  instruction: string | null; evidence: ItineraryDraft["evidence"];
};
export type ItineraryHistoryPage = { entries: ItineraryHistoryEntry[]; nextBefore: number | null };

/** Cursor paging over the existing durable history, NOT the browser's 50-turn window.
 * Every page rechecks active organizer/trip/thread authorization. No owner-private
 * history, assistant text, selected import text or private profiles are returned.
 */
export async function readItineraryHistoryPage(identifier: string, threadId: string, draftId: string | null, options: PollRepositoryOptions, before?: number): Promise<ItineraryHistoryPage> {
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new CommandAccessError();
  const db = createDatabase(options.databaseUrl);
  try { return await db.db.transaction(async tx => {
    const event = await requireTripOrganizer(tx, identifier, options.actorPersonId, false);
    const [thread] = await tx.select({ id: coordinatorThreads.id }).from(coordinatorThreads).where(and(eq(coordinatorThreads.id, threadId), eq(coordinatorThreads.commonsId, event)));
    if (!thread) throw new CommandAccessError();
    const rows = await tx.select({ id: coordinatorTurns.id, sequence: coordinatorTurns.sequence, actor: coordinatorTurns.ownerPersonId, at: coordinatorTurns.createdAt,
      text: coordinatorTurns.userText, workspace: coordinatorTurns.workspace }).from(coordinatorTurns)
      .where(and(eq(coordinatorTurns.commonsId, event), eq(coordinatorTurns.threadId, threadId), eq(coordinatorTurns.organizerShared, true),
        or(turnIsCompletedSql, and(sql`${turnStatusSql} = 'failed'`, sql`${coordinatorTurns.workspace}->'itineraryInstruction' is not null`)),
        before === undefined ? undefined : lt(coordinatorTurns.sequence, before)))
      .orderBy(desc(coordinatorTurns.sequence)).limit(51);
    const entries = rows.slice(0, 50).map(row => ({ turnId: row.id, sequence: row.sequence, actorId: row.actor, at: row.at.toISOString(),
      instruction: row.workspace?.itineraryDraft?.id === draftId || row.workspace?.itineraryInstruction &&
        (row.workspace.itineraryInstruction.draftId === draftId || row.workspace.itineraryInstruction.draftId === null) ? row.text : null,
      evidence: (row.workspace?.lifecycle?.status === "failed" ? [] : row.workspace?.research?.sources ?? []).map(source => ItineraryEvidenceSchema.parse({ runId: row.id, sourceId: source.id,
        title: source.title, url: source.url, excerpt: source.excerpt, retrievedAt: source.retrievedAt })),
    }));
    return { entries, nextBefore: rows.length > 50 ? rows[49].sequence : null };
  }); } finally { await db.close(); }
}
