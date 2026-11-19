import type { CommonsParticipant, CommonsSummary, Stay, TravelPlan } from "@commons/contracts";

// Defense in depth for presentation; the server remains the authorization boundary.
export function visibleTravelForPerson(travel: TravelPlan[], personId: string, actorId: string) {
  return travel.filter(plan => {
    const included = plan.personIds ?? [plan.personId];
    const authorized = plan.visibility !== "private" || plan.personId === actorId || included.includes(actorId);
    // Keep bookings entered for other travelers reachable by their owner, too.
    return authorized && (included.includes(personId) || (personId === actorId && plan.personId === actorId));
  }).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || a.id.localeCompare(b.id));
}

// Presentation only. The caller must use the existing membership-filtered snapshot.
// An absent shared record is never evidence that a traveler has not booked.
export function eventLogisticsModel(commons: CommonsSummary, stays: Stay[], travel: TravelPlan[], participants: CommonsParticipant[], actorId: string) {
  const sharedStays = stays.filter(stay => stay.status === "planned" || stay.status === "confirmed")
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.endsOn.localeCompare(b.endsOn));
  const sharedTravel = travel.filter(plan => plan.visibility !== "private");
  const privateTravel = travel.filter(plan => plan.visibility === "private"
    && (plan.personId === actorId || (plan.personIds ?? [plan.personId]).includes(actorId)));
  const activePeople = participants.filter(person => person.membershipStatus === "active");
  const coverage = (kind: "arrival" | "departure") => activePeople.filter(person => sharedTravel.some(plan =>
    plan.kind === kind && (plan.personIds ?? [plan.personId]).includes(person.id))).length;
  return {
    stays: sharedStays,
    legacyStay: sharedStays.length ? null : commons.lodging,
    sharedFlights: sharedTravel.filter(plan => plan.kind !== "car_rental"),
    sharedRentals: sharedTravel.filter(plan => plan.kind === "car_rental"),
    privateTravel,
    arrivalCoverage: coverage("arrival"), departureCoverage: coverage("departure"), peopleCount: activePeople.length,
    places: [...new Set([commons.locationName, ...(commons.locationNames ?? [])].filter((place): place is string => Boolean(place?.trim())))],
  };
}
