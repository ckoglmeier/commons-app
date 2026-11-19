import type { CoordinatorGoal } from "@commons/contracts";

/** One saved-state label for the server list and Coordinator's client views. */
export const goalLabel = (goal: Pick<CoordinatorGoal, "executionBlocked" | "planning" | "lifecycle">) =>
  goal.executionBlocked ? "Planned · research unavailable" :
    goal.planning && !["completed", "cancelled", "failed"].includes(goal.lifecycle) ? goal.planning.label :
      ({ ready: "Ready", running: "Working", waiting_for_input: "Needs your answer", waiting_for_approval: "Needs review", waiting_for_event: "Waiting for responses", completed: "Completed", failed: "Stopped", cancelled: "Cancelled" }[goal.lifecycle]);
