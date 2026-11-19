import type { CommonsParticipant, CommonsSummary, CommonsState } from "@commons/contracts";

export function homeSetup(commons: CommonsSummary, state: CommonsState, people: CommonsParticipant[]) {
  const active = people.filter(person => person.membershipStatus === "active");
  const travel = state.travelPlans ?? [];
  const covered = active.length > 0 && active.every(person => (["arrival", "departure"] as const).every(kind => travel.some(plan => plan.kind === kind && (plan.personIds ?? [plan.personId]).includes(person.id))));
  const hasTravel = travel.length > 0;
  const hasStay = Boolean(commons.lodging || state.stays?.length);
  const hasPlans = state.itinerary.length > 0;
  return {
    // Only known travel context merits a setup prompt; no universal flight requirement.
    showTravel: (hasTravel || hasStay) && !covered,
    takingShape: hasTravel || hasStay || hasPlans,
  };
}
