import type { CommonsParticipant, CommonsSummary, TravelPlan } from "@commons/contracts";
import { PUBLIC_DEMO_COMMONS_ID } from "./commons-route";

// Illustrative records for the named public demo only, never real event data.
export function publicDemoTravelPlans(commons: CommonsSummary, participants: CommonsParticipant[]): TravelPlan[] {
  if (commons.id !== PUBLIC_DEMO_COMMONS_ID || commons.slug !== "cape-cod-couples-week" || !commons.startsOn || !commons.endsOn) return [];
  const startsOn = commons.startsOn;
  const endsOn = commons.endsOn;
  const byName = (firstName: string) => participants.find(person => person.displayName.startsWith(firstName));
  const flight = (firstName: string, secondName: string | null, kind: "arrival" | "departure", route: string, time: string, note: string): TravelPlan | null => {
    const first = byName(firstName);
    const second = secondName ? byName(secondName) : null;
    if (!first || (secondName && !second)) return null;
    return {
      id: `cape-travel-${firstName}-${kind}`,
      personId: first.id,
      personIds: [first.id, ...(second ? [second.id] : [])],
      personName: second ? `${firstName} + ${secondName}` : firstName,
      kind,
      date: kind === "arrival" ? startsOn : endsOn,
      route, time, note,
      visibility: "basic",
      sourceLabel: `Shared by ${firstName}`,
    };
  };
  const owner = byName("Jordan");
  const rental: TravelPlan | null = owner ? {
    id: "cape-travel-Jordan-rental",
    personId: owner.id,
    personIds: [owner.id],
    personName: "Jordan",
    kind: "car_rental",
    provider: "National",
    vehicle: "Standard SUV",
    route: "Boston Logan Airport",
    date: startsOn,
    time: "12:00",
    returnDate: endsOn,
    returnTime: "10:30",
    driverPersonId: owner.id,
    driverName: owner.displayName,
    status: "confirmed",
    visibility: "basic",
    note: "Pick-up and return at the airport rental center.",
    sourceLabel: "Sample rental · added by Jordan",
  } : null;
  return [
    // Casey intentionally has no travel records so the empty state is reviewable.
    flight("Jordan", null, "arrival", "DEN → Boston · Delta 225", "11:05", "Rental car · house around 2:30"),
    flight("Maya", "Ben", "arrival", "Drive from New York", "15:00", "Grocery stop on the way in"),
    flight("Jess", "Aaron", "arrival", "Train → Providence", "11:48", "Sharing a car with Priya and Dev"),
    flight("Priya", "Dev", "arrival", "Flight → Providence", "12:20", "Sharing a car with Jess and Aaron"),
    flight("Jordan", null, "departure", "Falmouth → Boston · Delta 418", "09:15", "Rental-car return before 12:30 flight"),
    flight("Maya", "Ben", "departure", "Drive to New York", "10:00", "Leaving after breakfast"),
    flight("Jess", "Aaron", "departure", "Providence → New York · Amtrak", "13:45", "Car leaves the house at 10:45"),
    flight("Priya", "Dev", "departure", "Providence → DCA", "14:30", "Same car as Jess and Aaron"),
    rental,
  ].filter((plan): plan is TravelPlan => Boolean(plan));
}
