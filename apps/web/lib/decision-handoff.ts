import type { PollDetail } from "@commons/contracts";
import { commonsViewPath } from "./commons-route";

export const decisionActions = ["dates", "stay", "plan"] as const;
export type DecisionAction = typeof decisionActions[number];
export type DecisionHandoff = { action: DecisionAction; pollId: string; planId: string | null };

export function parseDecisionAction(value?: string): DecisionAction | null {
  return decisionActions.find(action => action === value) ?? null;
}

export function decisionHandoffPath(slug: string, pollId: string, action: DecisionAction) {
  return `${commonsViewPath(slug, action === "plan" ? "plan" : "logistics")}&decisionPoll=${encodeURIComponent(pollId)}&decisionAction=${action}`;
}

export function resolveDecisionHandoff(poll: Pick<PollDetail, "id" | "decision" | "currentActorRole">, action: DecisionAction,
  plans: Array<{ id: string; status: string }>): DecisionHandoff | null {
  if (!poll.decision || poll.currentActorRole !== "organizer") return null;
  const planId = poll.decision.planId;
  // A deleted/cancelled linked Idea must not fall through to creating a duplicate.
  if (action === "plan" && poll.decision.target === "plan_idea" &&
      (!planId || !plans.some(plan => plan.id === planId && plan.status !== "cancelled"))) return null;
  return { action, pollId: poll.id, planId: action === "plan" ? planId : null };
}
