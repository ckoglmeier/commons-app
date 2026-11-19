import type { ItineraryItem, Stay } from "@commons/contracts";
import { distanceLabel, stayDistances, tripMapPlaces } from "./trip-map";

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export function stayNights(stay: Pick<Stay, "startsOn" | "endsOn">) {
  return Math.max(1, Math.round((Date.parse(`${stay.endsOn}T12:00:00Z`) - Date.parse(`${stay.startsOn}T12:00:00Z`)) / 86_400_000));
}

/** What the group needs to compare options, using only saved facts. Prices
 * are whatever was entered; per-person figures divide by included people. */
export function stayComparison(stays: Stay[], itinerary: ItineraryItem[], timezone: string) {
  const distances = new Map(stayDistances(tripMapPlaces(stays, itinerary, timezone)).map(row => [row.stay.id, row]));
  return new Map(stays.map(stay => {
    const nights = stayNights(stay), people = stay.includedPersonIds.length, currency = stay.currency ?? "USD";
    const fees = stay.includesTaxesAndFees === false ? " before taxes and fees" : stay.includesTaxesAndFees === true ? " with taxes and fees" : "";
    const room = stay.roomPriceCents ?? null;
    // A per-room quote only becomes a group total once someone says how many rooms.
    const total = stay.totalCents ?? (room !== null && stay.roomCount ? room * stay.roomCount : null);
    const price = room !== null ? {
      total: `${money(room, currency)} per room for ${nights === 1 ? "the night" : `${nights} nights`}${fees}`,
      perRoomPerNight: `about ${money(Math.round(room / nights), currency)} per room per night`,
      perPersonPerNight: stay.roomCount && people ? `${stay.roomCount} ${stay.roomCount === 1 ? "room" : "rooms"}: ${money(total!, currency)} total, about ${money(Math.round(total! / people / nights), currency)} per person per night` : "Rooms needed not set",
    } : total === null ? null : {
      total: `${money(total, currency)} total${stay.costSource === "estimate" ? " estimate" : ""}${fees}`,
      perRoomPerNight: null,
      perPersonPerNight: people ? `about ${money(Math.round(total / people / nights), currency)} per person per night` : null,
    };
    const row = distances.get(stay.id);
    const distance = !stay.pin ? "Not on the map" : row?.nearestKm == null || row.farthestKm == null ? "No placed activities to compare"
      : `${distanceLabel(row.nearestKm) === distanceLabel(row.farthestKm) ? distanceLabel(row.nearestKm) : `${distanceLabel(row.nearestKm)}–${distanceLabel(row.farthestKm)}`} from ${row.distances.length} ${row.distances.length === 1 ? "activity" : "activities"}${stay.pin.precision === "approximate" ? " (approximate area)" : ""}`;
    return [stay.id, { nights, people, price, distance }];
  }));
}

/** A short line for a poll option, so people see what they're choosing between. */
export function stayPollDescription(stay: Stay, compared: ReturnType<typeof stayComparison> extends Map<string, infer V> ? V : never) {
  const price = compared.price && [compared.price.total, compared.price.perRoomPerNight, compared.price.perPersonPerNight === "Rooms needed not set" ? null : compared.price.perPersonPerNight].filter(Boolean).join(", ");
  const text = [stay.address || null, price || null, stay.details ?? null].filter(Boolean).join(" · ");
  // Poll option descriptions hold 180 characters; end on a whole word.
  return (text.length > 180 ? `${text.slice(0, 179).replace(/\s+\S*$/, "")}…` : text) || null;
}
