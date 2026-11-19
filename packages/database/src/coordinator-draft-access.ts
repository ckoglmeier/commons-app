import { and, eq, or } from "drizzle-orm";
import { coordinatorGoals, coordinatorGoalSteps, pollDrafts } from "./schema";
import type { CommandTransaction } from "./event-command";

/** An active membership is checked by the caller under the event lock.
 * Shared coordinator drafts are NEVER visible to members, including their former author.
 * Legacy private drafts remain owner-only, even for other organizers.
 */
export function coordinatorDraftAccess(actorPersonId: string, role: string) {
  const ownPrivate = and(eq(pollDrafts.organizerShared, false), eq(pollDrafts.ownerPersonId, actorPersonId));
  if (role !== "organizer") return ownPrivate;
  return or(ownPrivate, eq(pollDrafts.organizerShared, true));
}

export function canEditCoordinatorDraft(draft: { ownerPersonId: string; organizerShared: boolean }, actorPersonId: string, role: string) {
  return draft.organizerShared ? role === "organizer" : draft.ownerPersonId === actorPersonId;
}

/** Existing Goal/run/thread linkage permits guided polls without inventing a delivery note. */
export async function isPlanningGoalDraft(tx: CommandTransaction, draft: typeof pollDrafts.$inferSelect, threadId?: string) {
  if (!draft.runId || !threadId || draft.threadId !== threadId || !draft.organizerShared) return false;
  const [linked] = await tx.select({ id: coordinatorGoals.id }).from(coordinatorGoalSteps)
    .innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId))
    .where(and(eq(coordinatorGoals.commonsId, draft.commonsId), eq(coordinatorGoals.threadId, threadId),
      eq(coordinatorGoalSteps.kind, "planning"), eq(coordinatorGoalSteps.refId, draft.runId))).limit(1);
  return Boolean(linked);
}
