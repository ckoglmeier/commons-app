import airports from "./airport-timezones.json";
export type LocationTimezoneMatch = { id: string; label: string; timezone: string };

export function normalizeLocationSearch(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Only an exact, unambiguous IATA code can suggest a zone while entering a flight. */
export function airportTimezone(value: string): string | undefined {
  const code = value.trim().toUpperCase();
  const index = (airports.codes as Record<string, number>)[code];
  return index === undefined ? undefined : airports.zones[index];
}
