import type { CommonsState } from "@commons/contracts";

type Plan = CommonsState["itinerary"][number];
export type PlanAudience = Plan["participantScope"] | "self";

export function planAudienceValue(item: Plan, currentActorId: string): PlanAudience {
  return item.participantScope === "subgroup"
    && item.participantIds?.length === 1
    && item.participantIds[0] === currentActorId
    && (item.expectedParticipantIds ?? []).every((id) => id === currentActorId)
    ? "self"
    : item.participantScope;
}
