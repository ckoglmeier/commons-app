import { and, asc, eq } from "drizzle-orm";
import { commandFingerprint, CommandConflictError, type CommandTransaction } from "./event-command";
import { commons, itineraryItems, memberships, pollDecisions, polls } from "./schema";
import { loadSavedItineraryAnchors } from "./itinerary-anchors";

/** Shared canonical input fence, excluding transcripts, profiles, codes, costs and
 * private travel. Does not depend on this job's own changing lifecycle.
 */
export async function workflowContextInTransaction(tx: CommandTransaction, tripId: string) {
  const [trip] = await tx.select().from(commons).where(eq(commons.id, tripId));
  if (!trip) throw new CommandConflictError();
  const anchors = await loadSavedItineraryAnchors(tx, trip);
  const plans = await tx.select({ id: itineraryItems.id, version: itineraryItems.updatedAt }).from(itineraryItems)
    .where(and(eq(itineraryItems.commonsId, tripId), eq(itineraryItems.audience, "everyone"))).orderBy(asc(itineraryItems.id)).limit(501);
  const participants = await tx.select({ id: memberships.personId, role: memberships.role, status: memberships.status }).from(memberships)
    .where(eq(memberships.commonsId, tripId)).orderBy(asc(memberships.personId)).limit(501);
  // A reviewed decision can change the permitted planning context without
  // writing Plan. Pin only opaque versions, never ballot bodies or summaries.
  const decisions = await tx.select({ id: pollDecisions.id, pollId: pollDecisions.pollId, evidenceFingerprint: pollDecisions.evidenceFingerprint,
    version: pollDecisions.createdAt, sourceVersion: polls.updatedAt, status: polls.status }).from(pollDecisions)
    .innerJoin(polls, eq(polls.id, pollDecisions.pollId)).where(eq(polls.commonsId, tripId)).orderBy(asc(pollDecisions.id)).limit(501);
  if (!anchors.complete || plans.length > 500 || participants.length > 500 || decisions.length > 500) throw new CommandConflictError();
  // Include the current topic context through explicit recipe/brief pins, not by
  // hashing every conversation turn (which would invalidate the job's own reply).
  const value = { tripVersion: trip.updatedAt.toISOString(), anchors: anchors.facts,
    planVersions: plans.map(p => ({ id: p.id, version: p.version.toISOString() })), participantRefs: participants,
    decisionVersions: decisions.map(d => ({ ...d, version: d.version.toISOString(), sourceVersion: d.sourceVersion.toISOString() })) };
  return { value, fingerprint: commandFingerprint("", "workflow-context-v2", value) };
}
