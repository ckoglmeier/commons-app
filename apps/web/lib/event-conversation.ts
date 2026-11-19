import type { CommonsState } from "@commons/contracts";

export type ConversationEntry =
  | { id: string; kind: "message"; at: string; message: CommonsState["messages"][number] }
  | { id: string; kind: "activity"; at: string | null; activity: CommonsState["itinerary"][number]; changed: boolean }
  | { id: string; kind: "removed"; at: string }
  | { id: string; kind: "proposal"; at: string; proposal: CommonsState["proposals"][number] };

/**
 * A read projection, not copied messages. Only already-visible shared records enter it.
 * With `includeMessages: false` (group messages paused) messages of every author type are left out; activity receipts,
 * decisions and removals stay, and the stored messages are untouched.
 */
export function eventConversation(state: CommonsState, options: { includeMessages?: boolean } = {}): ConversationEntry[] {
  const includeMessages = options.includeMessages ?? true;
  const entries: ConversationEntry[] = (includeMessages ? state.messages : []).map(message => ({ id: `message:${message.id}`, kind: "message", at: message.occurredAt, message }));
  for (const activity of state.itinerary) {
    const changes = state.auditEvents.filter(event => event.targetId === activity.id && ["itinerary.added", "itinerary.updated", "participation.updated"].includes(event.action));
    const updates = changes.filter(event => event.action !== "participation.updated").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    entries.push({ id: `activity:${activity.id}`, kind: "activity", activity, at: updates[0]?.occurredAt ?? null, changed: updates[0]?.action === "itinerary.updated" });
  }
  const removed = new Set<string>();
  for (const event of [...state.auditEvents].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))) {
    if (event.action !== "itinerary.deleted" || removed.has(event.targetId) || state.itinerary.some(item => item.id === event.targetId)) continue;
    removed.add(event.targetId);
    // Deliberately do not echo free-form audit summaries or deleted record contents.
    entries.push({ id: `removed:${event.targetId}`, kind: "removed", at: event.occurredAt });
  }
  for (const proposal of state.proposals) entries.push({ id: `proposal:${proposal.id}`, kind: "proposal", at: proposal.approvedAt ?? proposal.createdAt, proposal });
  return entries.sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.id.localeCompare(b.id));
}
