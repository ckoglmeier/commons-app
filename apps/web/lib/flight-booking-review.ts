import type { FlightConnection } from "@commons/contracts";

export const maxFlightsPerDirection = 8;
export const blankFlightConnection = (): FlightConnection => ({ origin: null, destination: null, departureDate: null, departureTime: null, arrivalDate: null, arrivalTime: null, departureTimezone: null, arrivalTimezone: null, flightNumber: null });
export type FlightLegReview = { kind: "arrival" | "departure"; date: string; route: string; time: string; connections?: FlightConnection[] };

export function summarizeFlightReview(leg: FlightLegReview, connections: FlightConnection[]): FlightLegReview {
  const first = connections[0], last = connections.at(-1);
  return { ...leg, connections,
    route: first?.origin && last?.destination ? [first.origin, ...connections.map(item => item.destination)].filter(Boolean).join(" → ").slice(0, 120) : "",
    date: (leg.kind === "arrival" ? last?.arrivalDate : first?.departureDate) ?? "",
    time: (leg.kind === "arrival" ? last?.arrivalTime : first?.departureTime) ?? "",
  };
}

export function appendFlightConnection(leg: FlightLegReview): FlightLegReview {
  const connections = leg.connections ?? [];
  if (!connections.length || connections.length >= maxFlightsPerDirection) return leg;
  const previous = connections.at(-1)!;
  return summarizeFlightReview(leg, [...connections, { ...blankFlightConnection(), origin: previous.destination, departureTimezone: previous.arrivalTimezone }]);
}

export function removeFlightConnection(leg: FlightLegReview, index: number): FlightLegReview {
  if (!leg.connections || leg.connections.length <= 1 || index < 0 || index >= leg.connections.length) return leg;
  return summarizeFlightReview(leg, leg.connections.filter((_, i) => i !== index));
}
