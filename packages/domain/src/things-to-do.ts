import { actionItems, type ActionItem } from "./action-items";

/** `goals` is accepted and ignored so older callers keep compiling; there are no goals to show. */
export type ThingsToDoInput = Parameters<typeof actionItems>[0] & { goals?: readonly never[] };
export type ThingToDo = ActionItem & {
  scope: { tripId: string; personId: string };
  state: "actionable" | "waiting";
  source: "personal_task" | "poll" | "travel";
  /** Only a saved personal task can be checked off. Other items resolve through their source workflow. */
  completion: "task_receipt" | "source_workflow";
};

/** One person-scoped read model for Trip and messaging.
 * Reuses saved identities; creates no task, notification or authority. Call with freshly
 * authenticated, trip-filtered inputs. A projection is not permission to send an SMS.
 */
export function thingsToDo(input: ThingsToDoInput): ThingToDo[] {
  if (input.state.commonsId !== input.tripId) return [];
  const scope = { tripId: input.tripId, personId: input.personId };
  const actionable: ThingToDo[] = actionItems(input).map(item => ({
    ...item, scope, state: "actionable",
    source: item.target.kind === "todo" ? "personal_task" : ["poll", "poll_results"].includes(item.target.kind) ? "poll" : "travel",
    completion: item.target.kind === "todo" ? "task_receipt" : "source_workflow",
  }));
  return actionable;
}
