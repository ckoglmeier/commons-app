import type { CommonsState, CommonsSummary, TripTask } from "@commons/contracts";

export const organizerEarlySteps = [
  { key: "dates", question: "Have you picked dates?", title: "Decide trip dates", doneLabel: "Dates are picked", optional: false },
  { key: "location", question: "Have you picked a location?", title: "Choose a trip location", doneLabel: "Location is picked", optional: false },
  { key: "lodging", question: "Have you found lodging?", title: "Find lodging", doneLabel: "Lodging is found", optional: true },
  { key: "transport", question: "Have you figured out transportation?", title: "Figure out transportation", doneLabel: "Transportation is figured out", optional: true },
  { key: "people", question: "Have you figured out who’s coming?", title: "Work out who’s coming", doneLabel: "The group is decided", optional: false },
  { key: "budget", question: "Have you agreed on a budget?", title: "Agree on a trip budget", doneLabel: "Budget is agreed", optional: true },
] as const;
export type OrganizerEarlyStep = typeof organizerEarlySteps[number];
export type OrganizerEarlyStepKey = OrganizerEarlyStep["key"];
export type EarlyTaskIds = Record<OrganizerEarlyStepKey, string>;

/** Namespaced task identity gives retries and co-organizers the same ordinary to-do.
 * UUID v8: SHA-256 name hash. This is identity, never an authorization token.
 */
export async function organizerEarlyTaskIds(tripId: string): Promise<EarlyTaskIds> {
  const entries = await Promise.all(organizerEarlySteps.map(async step => {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`commons:organizer-early-task:v1:${tripId}:${step.key}`))).slice(0, 16);
    digest[6] = (digest[6] & 0x0f) | 0x80;
    digest[8] = (digest[8] & 0x3f) | 0x80;
    const hex = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
    return [step.key, `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`] as const;
  }));
  return Object.fromEntries(entries) as EarlyTaskIds;
}

export function organizerEarlyQuestions(commons: CommonsSummary, state: CommonsState, tasks: readonly TripTask[], ids: EarlyTaskIds, today?: string): OrganizerEarlyStep[] {
  if (state.commonsId !== commons.id || commons.status === "closing" || commons.status === "archived" || (today && commons.endsOn && commons.endsOn < today)) return [];
  return organizerEarlySteps.filter(step => {
    if (tasks.some(task => task.id === ids[step.key] || task.title.trim().toLowerCase() === step.title.toLowerCase())) return false;
    // Saved dates/location answer these questions. A found stay does not prove a booking.
    if (step.key === "dates") return !(commons.startsOn && commons.endsOn);
    if (step.key === "location") return !commons.locationName?.trim();
    if (step.key === "lodging") return !(commons.lodging || state.stays?.some(stay => stay.status === "planned" || stay.status === "confirmed"));
    if (step.key === "budget") return state.targetBudgetCents == null;
    // Existing arrangements and active/invited people never prove transport coverage or attendance.
    return true;
  });
}
