import type { PollAudience } from "@commons/contracts";
import { and, eq } from "drizzle-orm";
import type { CommandTransaction } from "./event-command";
import { memberships, people } from "./schema";

// Supplied only by the server authentication adapter, never by a response body.
export type PollViewer = { authUserId: string; email: string | null };

export async function pollViewerAccess(tx: Pick<CommandTransaction, "select">, poll: { commonsId: string; createdByPersonId: string; audience: PollAudience | null }, viewer?: PollViewer) {
  if (!poll.audience && !viewer) return { allowed: true, personId: null };
  if (!viewer) return { allowed: false, personId: null };
  const [person] = await tx.select({ id: people.id, name: people.displayName }).from(people).where(eq(people.authUserId, viewer.authUserId)).limit(1);
  if (!poll.audience) {
    return { allowed: true, personId: person?.id ?? null, respondentName: person?.name?.trim() || "Signed-in participant" };
  }
  const [membership] = person ? await tx.select({ status: memberships.status, role: memberships.role, attendance: memberships.attendanceState }).from(memberships)
    .where(and(eq(memberships.commonsId, poll.commonsId), eq(memberships.personId, person.id))).limit(1) : [];
  // A response-only grant cannot resurrect someone who declined or was removed.
  if (membership && ["left", "removed"].includes(membership.status)) return { allowed: false, personId: person?.id ?? null };
  const memberAllowed = membership?.status === "active" && (membership.role === "organizer" || poll.createdByPersonId === person!.id || poll.audience.personIds.includes(person!.id));
  const guestAllowed = Boolean(viewer.email && poll.audience.guestEmails.includes(viewer.email.trim().toLowerCase()));
  return { allowed: memberAllowed || guestAllowed, personId: person?.id ?? null, respondentName: person?.name?.trim() || "Signed-in participant" };
}
