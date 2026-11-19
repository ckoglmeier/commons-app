import type { ItineraryItem, PlacePin, Stay } from "@commons/contracts";

/** One stay or activity as the trip map shows it. Pins come only from what
 * someone saved; an unplaced place stays in the list without a guessed point. */
export type TripMapPlace = {
  key: string;
  kind: "stay" | "activity";
  id: string;
  name: string;
  status: string;
  statusLabel: string;
  address: string | null;
  url: string | null;
  pin: PlacePin | null;
  day: string | null;
};

/** Rental listings hide the exact address until booking. */
export const rentalListingHost = /(^|\.)(airbnb\.[a-z.]+|vrbo\.com|homeaway\.[a-z.]+|vacasa\.com)$/i;
export function isRentalListing(url: string | null) {
  if (!url) return false;
  try { return rentalListingHost.test(new URL(url).hostname); } catch { return false; }
}

export type TripMapFilter = { kind: "all" | "stay" | "activity"; day: "any" | "undated" | string };

const stayStatus = { considering: "Considering", planned: "Planned", confirmed: "Confirmed" } as const;
const activityStatus = { idea: "Idea", planned: "Planned", confirmed: "Confirmed", cancelled: "Cancelled" } as const;

export function localDay(instant: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find(entry => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function tripMapPlaces(stays: Stay[], itinerary: ItineraryItem[], timezone: string): TripMapPlace[] {
  return [
    ...stays.map(stay => ({ key: `stay:${stay.id}`, kind: "stay" as const, id: stay.id, name: stay.name, status: stay.status,
      statusLabel: stayStatus[stay.status], address: stay.address, url: stay.bookingUrl ?? null, pin: stay.pin ?? null, day: null })),
    // Meals at home have no place of their own; cancelled plans are not options.
    ...itinerary.filter(item => item.status !== "cancelled" && item.mealType !== "home").map(item => ({
      key: `activity:${item.id}`, kind: "activity" as const, id: item.id, name: item.title, status: item.status,
      statusLabel: activityStatus[item.status], address: item.location ?? null, url: item.sourceUrl ?? null, pin: item.pin ?? null,
      day: item.scheduledDate ?? (item.startsAt ? localDay(item.startsAt, timezone) : null),
    })),
  ];
}

export function filterTripMapPlaces(places: TripMapPlace[], filter: TripMapFilter) {
  return places.filter(place => (filter.kind === "all" || place.kind === filter.kind)
    // Stays span the trip, so a day filter narrows activities only.
    && (place.kind === "stay" || filter.day === "any" || (filter.day === "undated" ? place.day === null : place.day === filter.day)));
}

export function tripMapDays(startsOn: string | null, endsOn: string | null, places: TripMapPlace[]) {
  const days = new Set(places.flatMap(place => place.day ? [place.day] : []));
  if (startsOn && endsOn && startsOn <= endsOn) {
    for (let day = new Date(`${startsOn}T12:00:00Z`), last = new Date(`${endsOn}T12:00:00Z`), count = 0; day <= last && count < 62; day.setUTCDate(day.getUTCDate() + 1), count++) {
      days.add(day.toISOString().slice(0, 10));
    }
  }
  return [...days].sort();
}

export function distanceKm(a: Pick<PlacePin, "latitude" | "longitude">, b: Pick<PlacePin, "latitude" | "longitude">) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude), dLng = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function usesMiles(locale: string) {
  return /^(en-US|en-LR|my)(-|$)/i.test(locale) || /^en$/i.test(locale);
}

export function distanceLabel(km: number, locale = "en-US") {
  const miles = usesMiles(locale), value = miles ? km / 1.609344 : km;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded.toLocaleString(locale)} ${miles ? "mi" : "km"}`;
}

/** Straight-line distance from each stay to the activities currently shown.
 * Describes geography only: no route, drive time or best choice is implied. */
export function stayDistances(places: TripMapPlace[]) {
  const activities = places.filter(place => place.kind === "activity");
  const placed = activities.filter(place => place.pin);
  return places.filter(place => place.kind === "stay").map(stay => {
    const distances = stay.pin ? placed.map(activity => ({ activity, km: distanceKm(stay.pin!, activity.pin!) })).sort((a, b) => a.km - b.km) : [];
    return { stay, distances, activityCount: activities.length, unplacedCount: activities.length - placed.length,
      nearestKm: distances[0]?.km ?? null, farthestKm: distances.at(-1)?.km ?? null };
  });
}

/** Directions between two exact places, opened by the person in their maps app. */
export function directionsUrl(from: PlacePin, to: PlacePin) {
  if (from.precision !== "exact" || to.precision !== "exact") return null;
  const point = (pin: PlacePin) => `${pin.latitude.toFixed(6)},${pin.longitude.toFixed(6)}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${point(from)}&destination=${point(to)}`;
}

export function pinSourceLabel(pin: PlacePin) {
  const where = pin.source === "map_link" ? "From a maps link" : pin.source === "page" ? "From the place’s web page" : "Placed on the map";
  return pin.precision === "approximate" ? `${where} · Approximate area` : where;
}

/**
 * What the map can honestly say about where a place is. A saved address is text, not a location: Commons never turns it into a point on its
 * own, so an address with no pin says so and offers the person's own placement. Nothing here implies routing or live information.
 */
export function placeLocationNote(place: Pick<TripMapPlace, "pin" | "address">) {
  if (place.pin) return pinSourceLabel(place.pin);
  if (place.address) return "Address saved, but not on the map yet. Commons doesn’t guess a location; place it yourself.";
  return "No address saved, and not on the map yet. Add an address, or place it yourself.";
}
