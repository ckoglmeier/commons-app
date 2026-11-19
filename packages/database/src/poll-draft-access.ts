import { and, eq, or } from "drizzle-orm";
import { pollDrafts } from "./schema";

/** An active membership is checked by the caller under the event lock.
 * Shared drafts are NEVER visible to members, including their former author.
 * Legacy private drafts remain owner-only, even for other organizers.
 */
export function pollDraftAccess(actorPersonId: string, role: string) {
  const ownPrivate = and(eq(pollDrafts.organizerShared, false), eq(pollDrafts.ownerPersonId, actorPersonId));
  if (role !== "organizer") return ownPrivate;
  return or(ownPrivate, eq(pollDrafts.organizerShared, true));
}

export function canEditPollDraft(draft: { ownerPersonId: string; organizerShared: boolean }, actorPersonId: string, role: string) {
  return draft.organizerShared ? role === "organizer" : draft.ownerPersonId === actorPersonId;
}
