import type { CoordinatorThread, TripContextSnapshot } from "@commons/contracts";
import { resolvePlan } from "@/lib/coordinator-plan-proposal";
import { tripLocalTime } from "./coordinator-context-prompt";

/** A status lookup reads current records, never a prior assistant's claim. It grants no write authority. */
export function savedPlanStatusReply(prompt: string, snapshot: TripContextSnapshot, thread: CoordinatorThread, threadId: string | null): string | null {
  const text = prompt.trim();
  if (!/^(?:have|has|is|are|was|were|did|what(?:'s| is))\b/i.test(text) || !/\b(?:confirm(?:ed|ation)?|status)\b/i.test(text)) return null;
  const plans = snapshot.plans.map(({ value, freshness }) => ({
    id: value.itemId, title: value.title, status: value.status, timezone: snapshot.trip.value.timezone,
    startsAt: value.startsAt, endsAt: null, note: null, updatedAt: freshness.updatedAt ?? snapshot.assembledAt,
  }));
  let match = resolvePlan(text, plans);
  const refersToSelection = /\b(?:this|that|it|the event|the activity|the plan)\b/i.test(text);
  // Leave other kinds of status questions (e.g. lodging) to their existing context-aware route.
  if (match.kind === "none" && !refersToSelection) return null;
  if (match.kind === "none" && refersToSelection) {
    const links = thread.linkedIdeas.filter(link => link.threadId === threadId);
    const linked = plans.filter(plan => links.some(link => link.itineraryItemId === plan.id));
    match = linked.length === 1 ? { kind: "unique", plan: linked[0] }
      : linked.length > 1 ? { kind: "ambiguous", plans: linked }
      : resolvePlan(snapshot.threads.find(row => row.threadId === threadId)?.title ?? "", plans);
  }
  if (match.kind !== "unique") return "Which Plan item do you mean? I couldn’t identify one saved item from this question and the selected conversation.";
  const plan = match.plan;
  const time = tripLocalTime(plan.startsAt, snapshot.trip.value.timezone);
  const status = plan.status === "confirmed" ? "confirmed, as reported" : plan.status === "idea" ? "an idea, not confirmed" : "planned, not confirmed";
  return `${plan.title}${time ? ` (${time})` : ""} is saved in Plan as ${status}.`;
}
