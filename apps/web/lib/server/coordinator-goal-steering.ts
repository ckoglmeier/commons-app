import type { CoordinatorGoal } from "@commons/contracts";
import { CommandAccessError, type TaskView } from "@commons/database";
import { authenticatedGoalOperation, authenticatedGoals } from "./coordinator-goal-service";
import type { TaskApi } from "./coordinator-task-service";
import { goalEvidenceProjection } from "../goal-evidence-projection";

/** Compatibility adapter: reuse one semantic reader, but mutate the durable goal aggregate. */
export function goalSteeringApi(): Partial<TaskApi> {
  const seen = new Map<string, CoordinatorGoal>();
  const view = (g: CoordinatorGoal): TaskView => ({ taskId: g.goalId, threadId: g.threadId, title: g.title, brief: g.goal, query: "", revision: g.revision,
    status: g.lifecycle === "completed" ? "succeeded" : g.lifecycle === "cancelled" ? "cancelled" : g.lifecycle === "failed" ? "failed" : g.lifecycle.startsWith("waiting") || g.executionBlocked ? "needs_input" : g.lifecycle === "ready" ? "queued" : "running",
    errorCode: g.errorCode, waitingForSlot: g.research?.waitingForSlot ?? false, needsInput: g.waitDetail, resultOutdated: goalEvidenceProjection(g).resultOutdated, hasResult: Boolean(g.outcome), resultRevision: g.outcomeRevision,
    currentRunId: g.research?.currentRunId ?? null, runIds: g.research?.runIds ?? [], requestedByPersonId: "", requestedByName: g.requestedByName, ownedByMe: g.ownedByMe, acceptedAt: g.createdAt, updatedAt: g.updatedAt, lastChange: null, steered: true });
  return {
    list: async (slug, threadId) => {
      const { goals } = await authenticatedGoals(slug);
      const scoped = goals.filter(goal => goal.threadId === threadId || goal.mainThreadId === threadId);
      for (const goal of scoped) seen.set(goal.goalId, goal);
      return scoped.map(view);
    },
    start: async (slug, input, turnFence) => {
      const result = await authenticatedGoalOperation(slug, { op: "start", commandId: input.commandId, kind: "research", title: input.title, goal: input.brief || input.title, query: input.query }, turnFence);
      return { protocolVersion: 1, taskId: result.goal.goalId, commandId: input.commandId, acceptedAt: result.goal.createdAt, task: view(result.goal) };
    },
    amend: async (slug, input, turnFence) => {
      const goal = seen.get(input.taskId);
      if (!goal || goal.threadId !== input.threadId) throw new CommandAccessError();
      const result = await authenticatedGoalOperation(slug, { op: goal.lifecycle === "completed" ? "reopen" : "amend", commandId: input.commandId, goalId: goal.goalId, expectedRevision: input.expectedRevision, note: input.note,
        ...(goal.lifecycle !== "completed" && input.missingFact ? { missingFact: input.missingFact } : {}), ...(goal.lifecycle !== "completed" && input.publicQuery ? { query: input.publicQuery } : {}) }, turnFence);
      return { task: view(result.goal), replayed: result.replayed, supersededRunning: goal.lifecycle === "running" };
    },
    cancel: async (slug, input, turnFence) => {
      const goal = seen.get(input.taskId);
      if (!goal || goal.threadId !== input.threadId) throw new CommandAccessError();
      if (["completed", "cancelled", "failed"].includes(goal.lifecycle)) return { task: view(goal), cancelled: false, replayed: false };
      const result = await authenticatedGoalOperation(slug, { op: "cancel", commandId: input.commandId, goalId: goal.goalId, expectedRevision: goal.revision }, turnFence);
      return { task: view(result.goal), cancelled: result.goal.lifecycle === "cancelled", replayed: result.replayed };
    },
  };
}
