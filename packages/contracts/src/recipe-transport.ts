import { zonedLocalToInstant } from "./zoned-time";

/**
 * Shared-ride suggestions from flights people already added to the trip. Pure and deterministic: the same records always give the same
 * groups, every rule is stated in the output, and nothing here saves, books, notifies or assigns anyone. A landing time is not a pickup
 * time, and nothing is estimated about driving, luggage or vehicle capacity.
 */
export type TransportDirection = "arrival" | "departure";
export type TransportLeg = {
  personId: string; name: string; direction: TransportDirection;
  /** The airport or place as it was entered, e.g. "SFO". Never geocoded or guessed. */
  place: string | null;
  /** Local calendar date and clock time at that place. */
  date: string | null; time: string | null;
  /** An IANA zone when one was supplied; anything else is treated as missing and the trip zone is assumed and said so. */
  timezone: string | null;
  /** People answered "maybe", or aren't confirmed, are counted apart from confirmed travelers. */
  provisional: boolean;
};
export type TransferMember = { personId: string; name: string; time: string; provisional: boolean };
export type TransferGroup = {
  id: string; direction: TransportDirection; place: string;
  /** Earliest and latest local time in the group, and whether the group's local date changes. */
  startLocal: string; endLocal: string; dates: string[];
  members: TransferMember[]; confirmedCount: number; provisionalCount: number;
  assumedTimezone: boolean;
};
export type TransportProposal = {
  windowMinutes: number; groups: TransferGroup[];
  needsDetails: Array<{ personId: string; name: string; direction: TransportDirection; missing: Array<"place" | "date" | "time"> }>;
  /** Travelers on the trip with no flight added in a direction. Absent is not the same as private; flights are always shared basic details. */
  noFlight: Array<{ personId: string; name: string; direction: TransportDirection }>;
  /** Places that have travelers but too few to share a ride, kept so a different airport is visible rather than silently dropped. */
  places: Array<{ direction: TransportDirection; place: string; names: string[] }>;
  assumptions: string[];
};

const normalize = (place: string) => place.trim().replace(/\s+/g, " ").toLocaleUpperCase();
function validZone(zone: string | null) {
  if (!zone) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return /[A-Za-z]+\/[A-Za-z_]+|^UTC$/.test(zone); } catch { return false; }
}
const mid = (a: string, b: string) => a === b ? a : `${a}–${b}`;

export function proposeTransferGroups(input: { legs: TransportLeg[]; tripTimezone: string; windowMinutes?: number; roster?: Array<{ personId: string; name: string }> }): TransportProposal {
  const windowMinutes = Math.min(Math.max(input.windowMinutes ?? 60, 15), 240);
  const needsDetails: TransportProposal["needsDetails"] = [];
  const usable: Array<TransportLeg & { place: string; date: string; time: string; instant: number; assumed: boolean }> = [];
  for (const leg of input.legs) {
    const missing = (["place", "date", "time"] as const).filter(field => !leg[field]?.toString().trim());
    if (missing.length) { needsDetails.push({ personId: leg.personId, name: leg.name, direction: leg.direction, missing }); continue; }
    const assumed = !validZone(leg.timezone), zone = assumed ? input.tripTimezone : leg.timezone!;
    const instant = zonedLocalToInstant(leg.date!, leg.time!, zone);
    if (!instant) { needsDetails.push({ personId: leg.personId, name: leg.name, direction: leg.direction, missing: [zonedLocalToInstant(leg.date!, "00:00", zone) ? "time" : "date"] }); continue; }
    usable.push({ ...leg, place: leg.place!, date: leg.date!, time: leg.time!, instant: Date.parse(instant), assumed });
  }
  const groups: TransferGroup[] = [], places = new Map<string, { direction: TransportDirection; place: string; legs: typeof usable }>();
  for (const leg of usable) {
    const key = `${leg.direction}|${normalize(leg.place)}`;
    places.set(key, { direction: leg.direction, place: leg.place.trim(), legs: [...(places.get(key)?.legs ?? []), leg] });
  }
  const placeList: TransportProposal["places"] = [];
  for (const [key, entry] of [...places].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...entry.legs].sort((a, b) => a.instant - b.instant || a.name.localeCompare(b.name));
    // Greedy window from the first arrival in a cluster: a person joins only if they land within the window of that first person.
    const clusters: typeof sorted[] = [];
    for (const leg of sorted) {
      const last = clusters.at(-1);
      if (last && leg.instant - last[0].instant <= windowMinutes * 60_000) last.push(leg); else clusters.push([leg]);
    }
    placeList.push({ direction: entry.direction, place: entry.place, names: sorted.map(leg => leg.name) });
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const first = cluster[0], last = cluster.at(-1)!;
      groups.push({ id: `${key}|${first.instant}`, direction: entry.direction, place: entry.place, startLocal: first.time, endLocal: last.time,
        dates: [...new Set(cluster.map(leg => leg.date))],
        members: cluster.map(leg => ({ personId: leg.personId, name: leg.name, time: leg.time, provisional: leg.provisional })),
        confirmedCount: cluster.filter(leg => !leg.provisional).length, provisionalCount: cluster.filter(leg => leg.provisional).length,
        assumedTimezone: cluster.some(leg => leg.assumed) });
    }
  }
  const have = new Set(input.legs.map(leg => `${leg.personId}|${leg.direction}`));
  const noFlight = (input.roster ?? []).flatMap(person => (["arrival", "departure"] as const).filter(direction => !have.has(`${person.personId}|${direction}`)).map(direction => ({ personId: person.personId, name: person.name, direction })));
  const assumptions = [
    `People are grouped when they land or leave within ${windowMinutes} minutes of the first person in the group, at the same airport or place, spelled the same way.`,
    "A landing time isn’t a pickup time. Allow for people getting off the plane and collecting bags; set the pickup time yourself.",
    "Nothing is estimated about driving time, luggage or vehicle size. Check those before you rely on a group.",
    ...(groups.some(group => group.assumedTimezone) ? ["Where a flight didn’t give a usable time zone, the trip’s time zone is assumed. Those groups are marked."] : []),
  ];
  return { windowMinutes, groups: groups.sort((a, b) => a.direction.localeCompare(b.direction) || a.place.localeCompare(b.place) || a.startLocal.localeCompare(b.startLocal)), needsDetails, noFlight,
    places: placeList.filter(item => item.names.length), assumptions };
}

/** A local range label such as "3:10–3:40 PM". The date is shown separately when a group spans more than one day. */
export function formatTransferWindow(group: Pick<TransferGroup, "startLocal" | "endLocal" | "dates">) {
  const clock = (value: string) => { const [hour, minute] = value.split(":").map(Number); return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`; };
  return `${mid(clock(group.startLocal), clock(group.endLocal))}${group.dates.length > 1 ? ` (${group.dates.length} different days)` : ""}`;
}
