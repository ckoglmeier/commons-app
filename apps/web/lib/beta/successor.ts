import { EventBriefSchema } from "@commons/contracts";
import { z } from "zod";

type EventBrief = z.infer<typeof EventBriefSchema>;

/**
 * A clean successor draft (BR-08). It reuses planning structure the organizer or traveler selects: the destination as a suggestion, and
 * titles of activity ideas and stay options as things to reconsider. It never carries dates, votes, attendance, bookings, payments, private
 * messages, consent, notes, links or the people of the earlier trip unless the person explicitly chooses to start with the same group.
 */
export const SuccessorSelectionSchema = z.object({
  keepDestination: z.boolean().default(false),
  activityIds: z.array(z.string().uuid()).max(12).default([]),
  stayIds: z.array(z.string().uuid()).max(6).default([]),
  /** Starts with the earlier group as unsent, unreviewed people. Nobody is invited and nobody's consent carries over. */
  includePeople: z.boolean().default(false),
  commandId: z.string().uuid(),
});
export type SuccessorSelection = z.infer<typeof SuccessorSelectionSchema>;

export type SuccessorSource = {
  tripName: string;
  locationName: string | null;
  activities: { id: string; title: string }[];
  stays: { id: string; name: string }[];
};

export class SuccessorSelectionError extends Error {
  constructor() { super("Choose items from the trip you are planning again."); this.name = "SuccessorSelectionError"; }
}

const withoutYear = (name: string) => name.replace(/\b20\d{2}\b/g, "").replace(/\s{2,}/g, " ").trim() || name;
const clip = (value: string, length: number) => (value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`);

export function buildSuccessorDraft(source: SuccessorSource, selection: SuccessorSelection) {
  const activities = new Map(source.activities.map(row => [row.id, row.title]));
  const stays = new Map(source.stays.map(row => [row.id, row.name]));
  if (selection.activityIds.some(id => !activities.has(id)) || selection.stayIds.some(id => !stays.has(id))) throw new SuccessorSelectionError();
  const reconsider = [
    ...[...new Set(selection.activityIds)].map(id => clip(`Do again? ${activities.get(id)}`, 180)),
    ...[...new Set(selection.stayIds)].map(id => clip(`Stay again? ${stays.get(id)}`, 180)),
  ].slice(0, 12);
  const brief: EventBrief = EventBriefSchema.parse({
    summary: clip(`Planned again from ${source.tripName}`, 500),
    goals: reconsider,
    constraints: [],
    suggestedFirstMoves: ["Choose dates", "Decide who is coming", "Add what should be different this time"],
    unresolvedQuestion: null,
  });
  return {
    proposedName: clip(withoutYear(source.tripName), 100),
    // A destination from the earlier trip is a suggestion for the draft, never a confirmed place or a date.
    locationName: selection.keepDestination ? source.locationName : null,
    brief,
    includePeople: selection.includePeople,
  };
}

/** The attribution entry for this path: a quiet recap invitation, never a referral code or a person. */
export const SUCCESSOR_ATTRIBUTION = { entryKind: "recap" as const, entryRef: "plan-the-next-one" };
