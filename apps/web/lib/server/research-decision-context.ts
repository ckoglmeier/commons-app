import { createHash } from "node:crypto";
import { z } from "zod";
import { DecisionFactRefSchema, eventAttendanceDates, FlightConnectionSchema, ResearchDecisionBriefSchema, TripContextSnapshotSchema, type TripContextSnapshot } from "@commons/contracts";
import type { WorkflowSavedContext, WorkflowValidationScope } from "@commons/database";

// Both server preparation and the common minimized validation callback use this
// allowlist. No invented placeholder names/money are needed to parse the latter.
const snapshotShape = TripContextSnapshotSchema.shape;
const ResearchSourceSnapshotSchema = TripContextSnapshotSchema.pick({ schemaVersion: true, tripId: true, assembledAt: true, audience: true, plans: true }).extend({
  trip: snapshotShape.trip.extend({ value: snapshotShape.trip.shape.value.omit({ name: true }).strip() }),
  travelers: z.array(snapshotShape.travelers.element.extend({ value: snapshotShape.travelers.element.shape.value.omit({ name: true }).strip() })).max(60),
  stays: z.array(snapshotShape.stays.element.extend({ value: snapshotShape.stays.element.shape.value.omit({ costCents: true, costKind: true, currency: true }).strip() })).max(10),
  logistics: z.array(snapshotShape.logistics.element.extend({ value: snapshotShape.logistics.element.shape.value.omit({ route: true, connections: true }).extend({
    connections: z.array(FlightConnectionSchema.omit({ flightNumber: true }).strip()).max(8).optional(),
  }).strip() })).max(40),
}).strip();

const refs = (max: number) => z.array(DecisionFactRefSchema).max(max);
/** Explicit, saved row selection from the reviewed job, NOT the whole roster. */
export const ResearchContextSelectionSchema = z.object({
  party: refs(50).min(1), stays: refs(9), flights: refs(39), plans: refs(39),
}).strict();
export type ResearchContextSelection = z.infer<typeof ResearchContextSelectionSchema>;
type SourceSnapshot = z.infer<typeof ResearchSourceSnapshotSchema>;
type Fact = SourceSnapshot["trip"] | SourceSnapshot["travelers"][number]
  | SourceSnapshot["stays"][number] | SourceSnapshot["logistics"][number] | SourceSnapshot["plans"][number];

export class ResearchContextConflict extends Error {
  constructor() { super("Research context needs an authorized reread and explicit rebase."); }
}
function requireContext(value: unknown): asserts value { if (!value) throw new ResearchContextConflict(); }
const ref = (fact: Fact) => DecisionFactRefSchema.parse({ id: fact.id, version: fact.version });
const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
function select<T extends Fact>(facts: T[], selected: z.infer<typeof DecisionFactRefSchema>[], type: Fact["provenance"]["recordType"], prefix: string) {
  return sorted(selected).map(expected => {
    const matches = facts.filter(fact => fact.id === expected.id);
    requireContext(matches.length === 1);
    const fact = matches[0];
    requireContext(fact.version === expected.version && fact.provenance.kind === "saved_record"
      && fact.provenance.recordType === type && fact.provenance.recordId !== null
      && fact.id === `${prefix}:${fact.provenance.recordId}`);
    return fact;
  });
}

/** Pure SERVER projection, not an authorization API. The caller must reread via
 * loadCoordinatorTripContext(includeOwnTravel:false) under the current lease and
 * active-organizer scope. Never accept a browser/model-supplied snapshot, selection
 * receipt or fingerprint as proof. No SQL, prose parsing, inference or public query.
 * Window saturation is a hold, not proof that the bounded snapshot is complete.
 */
export function projectResearchDecisionContext(raw: TripContextSnapshot | Readonly<WorkflowSavedContext>, scope: WorkflowValidationScope, rawSelection: ResearchContextSelection) {
  const context = ResearchSourceSnapshotSchema.parse(raw), selection = ResearchContextSelectionSchema.parse(rawSelection);
  requireContext(context.tripId === scope.tripId && scope.pins.contextVersion.length > 0);
  requireContext(context.travelers.length < 60 && context.stays.length < 10 && context.logistics.length < 40 && context.plans.length < 40);
  requireContext(new Set(context.travelers.map(fact => fact.value.personId)).size === context.travelers.length);
  requireContext(context.travelers.some(fact => fact.value.personId === scope.actorId
    && fact.value.role === "organizer" && fact.value.membership === "active"
    && fact.provenance.kind === "saved_record" && fact.provenance.recordType === "membership"
    && fact.provenance.recordId === scope.actorId && fact.id === `traveler:${scope.actorId}`));
  const trip = context.trip;
  requireContext(trip.id === "trip" && trip.provenance.kind === "saved_record" && trip.provenance.recordType === "trip"
    && trip.provenance.recordId === scope.tripId);
  requireContext(!trip.value.startsOn || !trip.value.endsOn || trip.value.startsOn <= trip.value.endsOn);
  const all = [...selection.party, ...selection.stays, ...selection.flights, ...selection.plans];
  requireContext(new Set(all.map(fact => fact.id)).size === all.length);
  // The domain comparison carries a bounded fact-reference list, including trip.
  requireContext(all.length < 50);
  const party = select(context.travelers, selection.party, "membership", "traveler");
  requireContext(party.every(fact => fact.value.personId === fact.provenance.recordId
    && fact.value.membership === "active" && fact.value.attendance === "attending"));
  const partyIds = new Set(party.map(fact => fact.value.personId));
  const stays = select(context.stays, selection.stays, "stay", "stay").map(fact => {
    const value = fact.value;
    requireContext(value.stayId === fact.provenance.recordId && value.status !== "considering"
      && value.startsOn <= value.endsOn && value.name.trim().length > 0);
    // Do not promote included-person lists into room occupancy or availability.
    return { ...ref(fact), name: value.name, address: value.address, startsOn: value.startsOn, endsOn: value.endsOn,
      timezone: value.timezone ?? null, checkInTime: value.checkInTime, checkOutTime: value.checkOutTime,
      status: value.status, availabilityVerified: false as const };
  });
  const flights = select(context.logistics, selection.flights, "travel_plan", "travel").map(fact => {
    const value = fact.value;
    requireContext(value.travelPlanId === fact.provenance.recordId && ["basic", "all"].includes(value.visibility ?? "")
      && ["arrival", "departure"].includes(value.kind) && value.status !== "considering"
      && value.travelerIds.length > 0 && value.travelerIds.length < 20
      && new Set(value.travelerIds).size === value.travelerIds.length
      && value.travelerIds.some(id => partyIds.has(id)));
    // Missing connections/endpoints stay unknown. Never parse `route` or use trip
    // timezone to invent flight endpoint times. Flight numbers stay out.
    const connections = (value.connections ?? []).map(connection => ({
      origin: connection.origin, destination: connection.destination, departureDate: connection.departureDate,
      arrivalDate: connection.arrivalDate, departureTime: connection.departureTime, arrivalTime: connection.arrivalTime,
      departureTimezone: connection.departureTimezone, arrivalTimezone: connection.arrivalTimezone,
    }));
    return { ...ref(fact), kind: value.kind as "arrival" | "departure", status: value.status,
      partyRefs: sorted(party.filter(member => value.travelerIds.includes(member.value.personId)).map(ref)), connections };
  });
  const plans = select(context.plans, selection.plans, "itinerary_item", "plan").map(fact => {
    const value = fact.value;
    requireContext(value.itemId === fact.provenance.recordId && value.participantScope === "everyone");
    return { ...ref(fact), title: value.title, status: value.status, date: value.scheduledDate ?? null,
      startsAt: value.startsAt, location: value.location };
  });
  const value = {
    schemaVersion: 1 as const,
    // Identity from WorkflowValidationScope, never from caller-owned plan input.
    scope: { tripId: scope.tripId, threadId: scope.threadId, taskId: scope.taskId, actorId: scope.actorId,
      artifactId: scope.artifactId, goalRevision: scope.pins.goalRevision, briefRevision: scope.pins.briefRevision, contextVersion: scope.pins.contextVersion,
      recipe: scope.pins.recipe, policyVersion: scope.pins.policyVersion },
    trip: { ...ref(trip), destination: trip.value.destination, startsOn: trip.value.startsOn,
      endsOn: trip.value.endsOn, timezone: trip.value.timezone },
    // Number of explicitly selected, reported-attending people, NOT all members
    // or a guarantee they attend every leg. Keep the exact saved attendance value
    // in the source seal: a canonical full-window stamp is distinct from unresolved
    // partial-date prose, which is never parsed into attendance.
    party: { size: party.length, members: party.map(fact => ({ ...ref(fact), attendanceDates: fact.value.attendanceDates })) },
    stays, flights, plans, factRefs: sorted([ref(trip), ...all]),
  };
  const fingerprint = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  // Binding obtains runtime pins inside its transaction. Source dependencies must
  // also be sealable before binding, without pretending the caller owns those pins.
  // Trip identity stays in this seal; actor/lease/recipe checks remain runtime-owned.
  const { scope: runtimeScope, ...facts } = value;
  const sourceFingerprint = createHash("sha256").update(JSON.stringify({ tripId: runtimeScope.tripId, ...facts })).digest("hex");
  return { value, fingerprint, sourceFingerprint };
}
export type ResearchDecisionContextProjection = ReturnType<typeof projectResearchDecisionContext>;

/** Compare server-rebuilt dependencies, not just the generic context hash. The
 * host still needs to fence these dependencies atomically at binding/commit.
 */
export function assertResearchDecisionContextCurrent(expected: ResearchDecisionContextProjection, current: ResearchDecisionContextProjection) {
  requireContext(expected.fingerprint === current.fingerprint);
}

const reviewed = z.object({ title: ResearchDecisionBriefSchema.shape.title, queries: ResearchDecisionBriefSchema.shape.queries }).strict();
export const SavedWineryDecisionRequestSchema = reviewed.extend({ nominated: ResearchDecisionBriefSchema.shape.nominated,
  /** Optional reviewed appointment day, distinct from the entire trip window. */
  visitDate: z.string().date().nullable().optional() }).strict();
/** Complete reviewed answer set, not a chat parser or a saved trip fact. Null is
 * unanswered; zero is an explicit answer. Names/notes/authority are excluded. */
export const TransportDecisionAnswersSchema = z.object({
  drivers: z.object({ arrival: ResearchDecisionBriefSchema.shape.willingDrivers,
    wineries: ResearchDecisionBriefSchema.shape.willingDrivers,
    return: ResearchDecisionBriefSchema.shape.willingDrivers }).strict(),
  luggagePieces: ResearchDecisionBriefSchema.shape.luggagePieces,
}).strict();
export const SavedTransportDecisionRequestSchema = reviewed.extend({ stayRef: DecisionFactRefSchema, arrivalRef: DecisionFactRefSchema,
  departureRef: DecisionFactRefSchema, wineryDate: z.string().date().nullable(),
  answers: TransportDecisionAnswersSchema.optional() }).strict();
function base(projection: ResearchDecisionContextProjection, kind: "winery" | "transport") {
  const { scope, trip, party, factRefs } = projection.value;
  requireContext(scope.recipe.key === `${kind}-decision-v1` && scope.recipe.version === 1);
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
  const requestedWeekdays: typeof weekdays[number][] = [];
  if (trip.startsOn && trip.endsOn) {
    const start = Date.parse(`${trip.startsOn}T00:00:00Z`), end = Date.parse(`${trip.endsOn}T00:00:00Z`);
    for (let day = start; day <= end && requestedWeekdays.length < 7; day += 86_400_000) {
      const name = weekdays[new Date(day).getUTCDay()];
      if (!requestedWeekdays.includes(name)) requestedWeekdays.push(name);
    }
  }
  return { schemaVersion: 1, kind, taskId: scope.taskId, threadId: scope.threadId, ownerId: scope.actorId,
    revision: scope.briefRevision, contextRevision: scope.contextVersion, recipe: { key: scope.recipe.key, version: scope.recipe.version },
    partySize: party.size, startsOn: trip.startsOn, endsOn: trip.endsOn, requestedWeekdays, factRefs,
    luggagePieces: null, willingDrivers: null };
}
/** Human-reviewed nominations/queries are request inputs, not saved trip facts.
 * This builder deliberately accepts no party/dates/endpoints/runtime overrides.
 * Projection stays server-local; public queries still need the common privacy gate.
 */
export function buildSavedWineryDecision(projection: ResearchDecisionContextProjection, request: z.infer<typeof SavedWineryDecisionRequestSchema>) {
  const { visitDate, ...input } = SavedWineryDecisionRequestSchema.parse(request), derived = base(projection, "winery");
  if (visitDate) {
    requireContext(derived.startsOn && derived.endsOn && visitDate >= derived.startsOn && visitDate <= derived.endsOn);
    const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
    derived.requestedWeekdays = [weekdays[new Date(`${visitDate}T00:00:00Z`).getUTCDay()]];
  }
  return ResearchDecisionBriefSchema.parse({ ...derived, ...input, legs: [] });
}
/** First bounded transport shape: one explicitly selected saved arrival cohort,
 * one saved departure cohort, one selected lodging anchor, and a reviewed winery
 * day. Different arrival cohorts are a missing-input hold, not silently combined.
 * Missing typed endpoints/dates stay null; selected ideas are not routed stops.
 */
export function buildSavedTransportDecision(projection: ResearchDecisionContextProjection, request: z.infer<typeof SavedTransportDecisionRequestSchema>) {
  const input = SavedTransportDecisionRequestSchema.parse(request), value = projection.value;
  const match = <T extends { id: string; version: string | number }>(items: T[], reference: z.infer<typeof DecisionFactRefSchema>) => {
    const found = items.find(item => item.id === reference.id && item.version === reference.version);
    requireContext(found); return found;
  };
  const stay = match(value.stays, input.stayRef), arrival = match(value.flights, input.arrivalRef), departure = match(value.flights, input.departureRef);
  // Supported attendance writers stamp the reviewed full trip window. Accept
  // only that exact current value with both dates known, never a parsed range or
  // "unset" window. Preserve legacy absence of a date restriction; the selected
  // person must still have explicitly reported attending and cover both cohorts.
  const fullTripStamp = value.trip.startsOn && value.trip.endsOn
    ? eventAttendanceDates(value.trip.startsOn, value.trip.endsOn) : null;
  requireContext(arrival.kind === "arrival" && departure.kind === "departure"
    && arrival.partyRefs.length === value.party.size && departure.partyRefs.length === value.party.size
    && value.party.members.every(member => !member.attendanceDates?.trim()
      || fullTripStamp !== null && member.attendanceDates === fullTripStamp));
  const incoming = arrival.connections.at(-1), outgoing = departure.connections[0];
  // Reviewed route requirements are dependencies too; a different winery day
  // cannot reuse supplier coverage for the old leg merely because saved rows match.
  const requirementVersion = createHash("sha256").update(JSON.stringify({ context: projection.sourceFingerprint, wineryDate: input.wineryDate,
    ...(input.answers ? { answers: input.answers } : {}) })).digest("hex");
  const common = { requirementVersion, partySize: value.party.size };
  return ResearchDecisionBriefSchema.parse({ ...base(projection, "transport"), title: input.title, queries: input.queries, nominated: [],
    luggagePieces: input.answers?.luggagePieces ?? null,
    legs: [
      { ...common, id: "arrival", label: "Airport arrival to lodging", origin: incoming?.destination ?? null,
        destination: stay.name, date: incoming?.arrivalDate ?? null, needsLuggage: true,
        ...(input.answers ? { willingDrivers: input.answers.drivers.arrival } : {}) },
      { ...common, id: "wineries", label: "Lodging to selected wineries and back", origin: stay.name,
        destination: stay.name, date: input.wineryDate, needsLuggage: false,
        ...(input.answers ? { willingDrivers: input.answers.drivers.wineries } : {}) },
      { ...common, id: "return", label: "Lodging to departure airport", origin: stay.name,
        destination: outgoing?.origin ?? null, date: outgoing?.departureDate ?? null, needsLuggage: true,
        ...(input.answers ? { willingDrivers: input.answers.drivers.return } : {}) },
    ] });
}
