import type { CommonsSummary } from "@commons/contracts";

type TripPhaseInput = Pick<CommonsSummary, "status" | "startsOn" | "endsOn" | "timezone">;

function localDateKey(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function isPostTrip(trip: TripPhaseInput, now = new Date()) {
  if (trip.status === "closing" || trip.status === "archived") return true;
  if (!trip.endsOn) return false;

  return localDateKey(now, trip.timezone) > trip.endsOn;
}

export function hasTripStarted(trip: Pick<TripPhaseInput, "status" | "startsOn" | "timezone">, now = new Date()) {
  if (trip.status === "closing" || trip.status === "archived") return true;
  if (!trip.startsOn) return false;

  return localDateKey(now, trip.timezone) >= trip.startsOn;
}
