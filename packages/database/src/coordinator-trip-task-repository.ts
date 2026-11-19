import { and, desc, eq, sql } from "drizzle-orm";
import { CoordinatorTripTaskActionSchema, CoordinatorTripTaskProposalSchema, type CoordinatorTripTaskProposal } from "@commons/contracts";
import { coordinatorTurns, tripTasks } from "./schema";
import { CommandAccessError, CommandConflictError, runEventCommand, type CommandTransaction } from "./event-command";
import { saveTripTaskInTransaction } from "./trip-task-repository";
import { assertGoalProposalCurrent } from "./coordinator-goal-repository";
import type { PollRepositoryOptions } from "./poll-repository";

export async function latestTripTaskProposal(tx: CommandTransaction, event: string, threadId: string, taskId: string) {
  const [row] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, event), eq(coordinatorTurns.threadId, threadId),
    eq(coordinatorTurns.organizerShared, true), sql`${coordinatorTurns.workspace}->'taskProposal'->'task'->>'id' = ${taskId}`,
    sql`coalesce(${coordinatorTurns.workspace}->'lifecycle'->>'status', 'completed') = 'completed'`)).orderBy(desc(coordinatorTurns.sequence)).limit(1);
  return row ? { turnId: row.id, proposal: CoordinatorTripTaskProposalSchema.parse(row.workspace?.taskProposal) } : null;
}
export async function tripTaskProposalIsCurrent(tx: CommandTransaction, event: string, threadId: string, proposal: CoordinatorTripTaskProposal, actorId: string) {
  const latest = await latestTripTaskProposal(tx, event, threadId, proposal.task.id);
  const [saved] = await tx.select().from(tripTasks).where(eq(tripTasks.id, proposal.task.id));
  return proposal.state === "pending" && proposal.receipt === null && proposal.requestedBy === actorId && proposal.task.ownerPersonId === actorId &&
    proposal.version === (latest?.proposal.version ?? 0) + 1 && (!latest || latest.proposal.state !== "dismissed") &&
    (saved ? saved.commonsId === event && saved.version === proposal.task.expectedVersion : proposal.task.expectedVersion === 0);
}
/** Approval and the existing task command commit together under the coordinator event lock. */
export async function actOnCoordinatorTripTask(tx: CommandTransaction, event: string, raw: unknown, options: PollRepositoryOptions) {
  const input = CoordinatorTripTaskActionSchema.parse(raw);
  return runEventCommand(tx, { identifier: event, actorPersonId: options.actorPersonId, commandId: input.commandId, action: "coordinator.trip_task_reviewed", input },
    async ({ role }) => { if (role !== "organizer") throw new CommandAccessError(); }, async ({ now }) => {
      const [turn] = await tx.select().from(coordinatorTurns).where(and(eq(coordinatorTurns.commonsId, event), eq(coordinatorTurns.threadId, input.threadId), eq(coordinatorTurns.id, input.turnId)));
      const proposal = CoordinatorTripTaskProposalSchema.parse(turn?.workspace?.taskProposal);
      const latest = await latestTripTaskProposal(tx, event, input.threadId, proposal.task.id);
      if (!latest || latest.turnId !== input.turnId || proposal.version !== input.expectedVersion || (input.operation === "undo" ? proposal.state !== "applied" || !proposal.quickAdd : proposal.state !== "pending")) throw new CommandConflictError();
      await assertGoalProposalCurrent(tx, event, input.turnId);
      if (input.operation === "undo") {
        const [current] = await tx.select().from(tripTasks).where(eq(tripTasks.id, proposal.task.id));
        // Undo is scoped to the untouched task created by this authenticated requester.
        if (!proposal.receipt || proposal.requestedBy !== options.actorPersonId || proposal.receipt.appliedBy !== options.actorPersonId || !current || current.commonsId !== event || current.version !== proposal.receipt.version || current.ownerPersonId !== options.actorPersonId || current.createdByPersonId !== options.actorPersonId) throw new CommandConflictError();
        await tx.delete(tripTasks).where(and(eq(tripTasks.id, current.id), eq(tripTasks.version, current.version)));
        proposal.state = "dismissed";
      } else if (input.operation === "apply") {
        // A child command can already have a receipt from a direct save. Its replay must not
        // let a first-time parent approval claim a stale task version as the newly saved result.
        const [current] = await tx.select().from(tripTasks).where(eq(tripTasks.id, proposal.task.id));
        if (current ? current.commonsId !== event || current.version !== proposal.task.expectedVersion : proposal.task.expectedVersion !== 0) throw new CommandConflictError();
        const saved = await saveTripTaskInTransaction(tx, event, proposal.task, options);
        proposal.receipt = { id: saved.id, version: saved.version, at: now.toISOString(), appliedBy: options.actorPersonId };
        proposal.state = "applied";
      } else proposal.state = "dismissed";
      await tx.update(coordinatorTurns).set({ workspace: { ...turn.workspace, taskProposal: proposal } }).where(eq(coordinatorTurns.id, turn.id));
      return { result: { state: proposal.state, receipt: proposal.receipt }, resourceType: "trip_task_proposal", resourceId: proposal.task.id,
        summary: input.operation === "undo" ? "Undid the requester’s quick-added task." : input.operation === "apply" ? "Saved the organizer-reviewed task." : "Dismissed the task suggestion; no task changed." };
    });
}
