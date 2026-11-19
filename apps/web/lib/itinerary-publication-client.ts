import { PollDetailSchema, type PollWorkingDraft } from "@commons/contracts";
import { itineraryPublicationInput } from "./itinerary-workshop";
export type ItineraryPublicationAttempt = { key: string; commandId: string };
/** The caller invokes this only after explicit publication confirmation. */
export async function publishItineraryDraft(slug: string, draft: PollWorkingDraft, access: "invitees" | "link", pending: { current: ItineraryPublicationAttempt | null }, sourcePollId?: string) {
  const key = JSON.stringify({ id: draft.id, version: draft.version, access, sourcePollId });
  if (pending.current?.key !== key) pending.current = { key, commandId: crypto.randomUUID() };
  const response = await fetch(`/api/v1/commons/${slug}/polls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...itineraryPublicationInput(draft, pending.current.commandId, access), ...(sourcePollId ? { sourcePollId } : {}) }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Publication couldn’t complete. Try again with the same saved version.");
  const poll = PollDetailSchema.parse(payload.poll);
  pending.current = null;
  return poll;
}
