import type { TripContextSnapshot } from "@commons/contracts";
import { CommandConflictError, type CommandTransaction } from "./event-command";
import { loadCoordinatorTripContextInTransaction } from "./coordinator-context-repository";

type Fact<F extends { value: unknown; provenance: { label: string | null } }, V> = Omit<F, "value"> & { value: V };
type Member = TripContextSnapshot["travelers"][number];
type Stay = TripContextSnapshot["stays"][number];
type Travel = TripContextSnapshot["logistics"][number];
/** Validation-only saved facts. Deliberately not a full conversation snapshot
 * or a provider payload. No traveler names, money, profiles, ballots, prose route strings,
 * flight numbers, notes, private flights or conversation/decision bodies. */
export type WorkflowSavedContext = Pick<TripContextSnapshot, "schemaVersion" | "tripId" | "assembledAt" | "audience" | "plans"> & {
  trip: Fact<TripContextSnapshot["trip"], Omit<TripContextSnapshot["trip"]["value"], "name">>;
  travelers: Array<Fact<Member, Omit<Member["value"], "name">>>;
  stays: Array<Fact<Stay, Omit<Stay["value"], "costCents" | "costKind" | "currency">>>;
  logistics: Array<Fact<Travel, Omit<Travel["value"], "route" | "connections"> & {
    connections: Array<Omit<NonNullable<Travel["value"]["connections"]>[number], "flightNumber">>;
  }>>;
};
const fact = <F extends { value: unknown; provenance: { label: string | null } }, V>(source: F, value: V): Fact<F, V> =>
  ({ ...source, provenance: { ...source.provenance, label: null }, value });

export async function workflowSavedContextInTransaction(tx: CommandTransaction, tripId: string, actorId: string, now: Date): Promise<WorkflowSavedContext> {
  const snapshot = await loadCoordinatorTripContextInTransaction(tx, tripId, { actorPersonId: actorId, includeOwnTravel: false, now });
  // Existing display windows cannot certify coverage when saturated. A narrow
  // source reader can replace this conservative hold after separate qualification.
  if (snapshot.travelers.length >= 60 || snapshot.stays.length >= 10 || snapshot.plans.length >= 40 || snapshot.logistics.length >= 40
    || snapshot.logistics.some(row => row.value.travelerIds.length >= 20)) throw new CommandConflictError();
  const { destination, startsOn, endsOn, timezone } = snapshot.trip.value;
  return { schemaVersion: 1, tripId: snapshot.tripId, assembledAt: snapshot.assembledAt, audience: snapshot.audience,
    trip: fact(snapshot.trip, { destination, startsOn, endsOn, timezone }),
    travelers: snapshot.travelers.map(row => {
      const { personId, role, membership, managed, attendance, attendanceDates } = row.value;
      return fact(row, { personId, role, membership, managed, attendance, attendanceDates });
    }),
    stays: snapshot.stays.map(row => {
      const { stayId, name, address, startsOn, endsOn, timezone, checkInTime, checkOutTime, status, bookingReportedByOrganizer, availabilityVerified, includedPersonIds } = row.value;
      return fact(row, { stayId, name, address, startsOn, endsOn, timezone, checkInTime, checkOutTime, status, bookingReportedByOrganizer, availabilityVerified, includedPersonIds });
    }),
    plans: snapshot.plans.filter(row => row.value.participantScope === "everyone").map(row => fact(row, row.value)),
    logistics: snapshot.logistics.filter(row => row.value.visibility === "basic" || row.value.visibility === "all").map(row => {
      const { travelPlanId, travelerIds, kind, visibility, date, localTime, status, arrivesAt, departsAt } = row.value;
      const connections = (row.value.connections ?? []).map(({ origin, destination, departureDate, arrivalDate, departureTime, arrivalTime, departureTimezone, arrivalTimezone }) =>
        ({ origin, destination, departureDate, arrivalDate, departureTime, arrivalTime, departureTimezone, arrivalTimezone }));
      return fact(row, { travelPlanId, travelerIds, kind, visibility, date, localTime, status, arrivesAt, departsAt, connections });
    }),
  };
}

/** Isolated, frozen callback arguments keep a validator from mutating the
 * execution input or authoritative source object it is supposed to check. */
export function frozenWorkflowValidationCopy<T>(value: T): Readonly<T> {
  const copy = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    for (const child of Object.values(item)) freeze(child);
    Object.freeze(item);
  };
  freeze(copy); return copy;
}
