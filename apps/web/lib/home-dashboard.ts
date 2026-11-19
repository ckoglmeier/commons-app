import type { CommonsState, CommonsSummary } from "@commons/contracts";

function includesTraveler(item: CommonsState["itinerary"][number], personId: string, participation: CommonsState["participation"]) {
  const response = participation[item.id];
  if (response === "skip" || response === "maybe") return false;
  if (item.participantScope === "everyone") return true;
  if (item.participantScope === "subgroup") {
    return item.expectedParticipantIds?.includes(personId) || item.participantIds?.includes(personId);
  }
  // Planning estimates on an optional activity are not an opt-in.
  return response === "in" || Boolean(item.participantIds?.includes(personId) && item.respondedParticipantIds?.includes(personId));
}

export function homeShortcuts(state: CommonsState, commons: CommonsSummary, personId: string, participation: CommonsState["participation"], now: number) {
  const plans = state.itinerary.filter(item => item.status !== "cancelled");
  const next = plans.filter(item => item.startsAt && item.status !== "idea" && Date.parse(item.startsAt) >= now &&
    includesTraveler(item, personId, participation))
    .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))[0];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: commons.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  const stays = (state.stays ?? []).filter(stay => stay.status !== "considering");
  const stay = stays.filter(stay => stay.includedPersonIds.includes(personId) && stay.endsOn >= today)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  return { hasPlans: plans.length > 0, next, stay, legacyStay: stays.length === 0 ? commons.lodging : undefined };
}

export type HomeUpdate = { id: string; title: string; detail: string; at: string; destination: "plan" | "money" | "logistics" | "conversation"; itemId?: string };

/** Only visible canonical records; never render raw audit summaries or private travel. */
export function homeUpdates(state: CommonsState, options: { includeMessages?: boolean } = {}): HomeUpdate[] {
  const updates: HomeUpdate[] = [];
  const seen = new Set<string>();
  for (const event of [...state.auditEvents].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    const family = event.action.split(".")[0];
    const key = `${family}:${event.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const plan = family === "itinerary" ? state.itinerary.find(item => item.id === event.targetId) : undefined;
    const stay = family === "stay" ? state.stays?.find(item => item.id === event.targetId && item.status !== "considering") : undefined;
    const expense = family === "expense" ? state.expenses.find(item => item.id === event.targetId) : undefined;
    if (plan) updates.push({ id: event.id, title: plan.title, detail: plan.status === "cancelled" ? "Plan cancelled" : event.action.endsWith("added") ? "Added to the plan" : "Plan updated", at: event.occurredAt, destination: "plan", itemId: plan.id });
    else if (stay) updates.push({ id: event.id, title: stay.name, detail: "Stay updated", at: event.occurredAt, destination: "logistics" });
    else if (expense) updates.push({ id: event.id, title: expense.title, detail: "Expense updated", at: event.occurredAt, destination: "money" });
  }
  for (const message of (options.includeMessages ?? true) ? state.messages.filter(message => message.actorType === "human") : []) {
    updates.push({ id: message.id, title: message.body, detail: message.actorName, at: message.occurredAt, destination: "conversation" });
  }
  for (const proposal of state.proposals.filter(proposal => proposal.status === "approved" && proposal.approvedAt)) {
    updates.push({ id: `decision:${proposal.id}`, title: proposal.title, detail: "Decision approved", at: proposal.approvedAt!, destination: "conversation" });
  }
  return updates.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}
