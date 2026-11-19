import type { ConfirmationDraft, FlightConnection } from "@commons/contracts";

export function readLocalDate(value: string | undefined): string | null {
  if (!value) return null;
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  const numeric = value.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  const named = value.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i);
  const year = iso ? Number(iso[1]) : numeric ? Number(numeric[3]) + (numeric[3].length === 2 ? 2000 : 0) : named ? Number(named[3]) : 0;
  const month = iso ? Number(iso[2]) : numeric ? Number(numeric[1]) : named ? ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(named[1].slice(0, 3).toLowerCase()) + 1 : 0;
  const day = Number(iso?.[3] ?? numeric?.[2] ?? named?.[2] ?? 0);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.toISOString().slice(0, 10) : null;
}

export function readLocalTime(value: string | undefined): string | null {
  const match = value?.replace(/a\.?m\.?/gi, "AM").replace(/p\.?m\.?/gi, "PM").match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  if (Number(match[2]) > 59 || (match[3] ? hour < 1 || hour > 12 : hour > 23)) return null;
  if (match[3]?.toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[3]?.toUpperCase() === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function routes(text: string) {
  return [...text.matchAll(/\b([A-Z]{3})\s*(?:→|->|to)\s*([A-Z]{3})\b|\(([A-Z]{3})\)[^\n]{0,100}?\bto\b[^\n]{0,100}?\(([A-Z]{3})\)/g)].map(match => ({
    index: match.index!, origin: match[1] ?? match[3], destination: match[2] ?? match[4],
  }));
}

function connection(text: string, route: ReturnType<typeof routes>[number] | undefined): FlightConnection {
  const departureLine = text.match(/(?:^|\n)[ \t]*(?:departure time|departs at|depart(?:s|ing)?|departure)\b(?![ \t]+date)[ \t]*[:#-]?[ \t]*([^\n]+)/i)?.[1];
  const arrivalLine = text.match(/(?:^|\n)[ \t]*(?:arrival time|arrives at|arriv(?:e|es|ing|al))\b(?![ \t]+date)[ \t]*[:#-]?[ \t]*([^\n]+)/i)?.[1];
  const departureDate = readLocalDate(text.match(/(?:departure date|departing date)\s*:?\s*([^\n]+)/i)?.[1]) ?? readLocalDate(departureLine);
  const arrivalDate = readLocalDate(text.match(/(?:arrival date|arriving date)\s*:?\s*([^\n]+)/i)?.[1]) ?? readLocalDate(arrivalLine);
  // An unlabeled pair is interpretable only as an explicit time range. A lone
  // time never supplies both endpoints. Dates without endpoint labels remain
  // visible as departure dates; +1 is required for a next-day inference.
  const range = text.match(/(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?))\s*[–—-]\s*(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?))/i);
  const departureTime = readLocalTime(departureLine) ?? readLocalTime(range?.[1]);
  const arrivalTime = readLocalTime(arrivalLine) ?? readLocalTime(range?.[2]);
  const itineraryDateLine = text.split("\n").find(line => /^(?:\s*(?:flight date|travel date|date)\s*:|\s*(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?(?:20\d{2}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}\b))/i.test(line));
  const date = departureDate ?? readLocalDate(itineraryDateLine);
  const nextDay = /(?:\+\s*1\b|next day)/i.test(text);
  const sharedDate = date && !departureDate && !arrivalDate && range && !nextDay && departureTime && arrivalTime && arrivalTime >= departureTime ? date : null;
  const timezone = (line: string | undefined) => line?.match(/\b(?:[A-Z]{1,3}[SD]T|UTC(?:[+-]\d{1,2}(?::\d{2})?)?|GMT(?:[+-]\d{1,2}(?::\d{2})?)?|[A-Z][a-z_]+\/[A-Z][A-Za-z_]+)\b/)?.[0] ?? null;
  return {
    origin: route?.origin ?? null, destination: route?.destination ?? null,
    departureDate: date,
    arrivalDate: arrivalDate ?? (nextDay && date ? new Date(Date.parse(`${date}T12:00:00Z`) + 86400000).toISOString().slice(0, 10) : sharedDate),
    departureTime, arrivalTime,
    departureTimezone: timezone(departureLine), arrivalTimezone: timezone(arrivalLine),
    flightNumber: text.match(/\b(?:flight(?: number)?\s*[:#]?\s*)?([A-Z]{2}\s?\d{1,4})\b/)?.[1] ?? null,
  };
}

function readConnections(text: string) {
  const found = routes(text);
  if (found.length <= 1) return [connection(text, found[0])];
  // A labeled flight header belongs to the route below it, not to the previous
  // route's trailing facts. Keep unlabeled trailing codes with their own block.
  const starts = found.map((route, index) => {
    if (index === 0) return 0;
    const previous = found[index - 1].index;
    const header = [...text.slice(previous, route.index).matchAll(/(?:^|\n)[ \t]*flight\b[^\n]*\b[A-Z]{2}\s?\d{1,4}\b[^\n]*\n/gi)].at(-1);
    return header ? previous + header.index! : route.index;
  });
  return found.slice(0, 8).map((route, index) => connection(text.slice(starts[index], starts[index + 1] ?? text.length), route));
}

export function summarizeConnections(kind: "arrival" | "departure", connections: FlightConnection[]) {
  const first = connections[0];
  const last = connections.at(-1);
  return {
    kind,
    date: (kind === "arrival" ? last?.arrivalDate : first?.departureDate) ?? null,
    route: first?.origin && last?.destination ? [first.origin, ...connections.map(item => item.destination).filter(Boolean)].join(" → ").slice(0, 120) : null,
    time: (kind === "arrival" ? last?.arrivalTime : first?.departureTime) ?? null,
    departureTime: first?.departureTime ?? null,
    arrivalTime: last?.arrivalTime ?? null,
    connections,
  };
}

export function readFlightItinerary(text: string): NonNullable<ConfirmationDraft["travelSegments"]> {
  const headings = [...text.matchAll(/(?:^|\n)\s*(outbound|departing|return|returning|inbound)(?:\s+flight)?[^\n]*\n/gi)];
  // Do not silently drop parts of an itinerary too complex for this editor.
  if (headings.length > 2 || routes(text).length > 8) return [];
  if (headings.length) return headings.slice(0, 2).map((heading, index) => summarizeConnections(
    /return|inbound/i.test(heading[1]) ? "departure" : "arrival",
    readConnections(text.slice(heading.index!, headings[index + 1]?.index ?? text.length).replace(/^\s*(?:outbound|departing|return|returning|inbound)(?:\s+flight)?[ \t]*[:-]?[ \t]*/i, "")),
  ));
  const connections = readConnections(text);
  // Two opposite routes are a round trip. Contiguous legs to a different
  // destination are connections, not an invented homeward flight.
  if (connections.length === 2 && connections[0].origin && connections[0].origin === connections[1].destination && connections[0].destination === connections[1].origin) {
    return connections.map((item, index) => summarizeConnections(index === 0 ? "arrival" : "departure", [item]));
  }
  return [summarizeConnections("arrival", connections)];
}
