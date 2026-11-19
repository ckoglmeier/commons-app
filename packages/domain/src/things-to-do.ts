import { coordinatorActionItems, type CoordinatorActionItem } from "./coordinator-action-items";

export type ThingsToDoInput = Parameters<typeof coordinatorActionItems>[0];
export type ThingToDo = CoordinatorActionItem & {
  scope: { tripId: string; personId: string };
  state: "actionable" | "waiting";
  source: "personal_task" | "goal" | "poll" | "proposal" | "travel" | "legacy_task";
  /** Only a saved personal task can be checked off. Other items resolve through their source workflow. */
  completion: "task_receipt" | "source_workflow";
};

/** One person-scoped read model for Trip, Coordinator and a future messaging adapter.
 * Reuses saved identities; creates no task, notification or authority. Call with freshly
 * authenticated, trip-filtered inputs. A projection is not permission to send an SMS.
 */
export function thingsToDo(input: ThingsToDoInput): ThingToDo[] {
  if (input.state.commonsId !== input.tripId) return [];
  const scope = { tripId: input.tripId, personId: input.personId };
  const actionable: ThingToDo[] = coordinatorActionItems(input).map(item => ({
    ...item, scope, state: "actionable",
    source: item.target.kind === "todo" ? "personal_task" : item.id.startsWith("legacy:") ? "legacy_task" : item.target.kind === "task" ? "goal" : ["poll", "poll_results"].includes(item.target.kind) ? "poll" : item.target.kind === "proposal" ? "proposal" : "travel",
    completion: item.target.kind === "todo" ? "task_receipt" : "source_workflow",
  }));
  const actionableIds = new Set(actionable.map(item => item.id));
  // Waiting work follows actions. Preserve existing starter-only controls: shared
  // organizer visibility must not be mistaken for permission to amend another goal.
  const waiting: ThingToDo[] = input.organizer ? (input.goals ?? [])
    .filter(goal => goal.ownedByMe && !actionableIds.has(`task:${goal.goalId}`) && (["ready", "running", "waiting_for_event"].includes(goal.lifecycle) || ["waiting_for_input", "waiting_for_approval"].includes(goal.lifecycle) && ["shared", "collecting"].includes(goal.planning?.stage ?? "")))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.goalId.localeCompare(b.goalId))
    .map(goal => ({
      id: `task:${goal.goalId}`, title: goal.title,
      detail: goal.executionBlocked ? "Work is planned; execution is unavailable." : goal.planning?.nextAction || goal.waitDetail || (goal.lifecycle === "running" ? "Work is in progress." : goal.lifecycle === "ready" ? "Work is planned." : "Waiting for the next update."),
      action: "View goal", target: { kind: "task", id: goal.threadId }, scope,
      state: "waiting", source: "goal", completion: "source_workflow",
    })) : [];
  return [...actionable, ...waiting];
}
