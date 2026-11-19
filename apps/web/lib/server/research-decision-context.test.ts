import test from "node:test";
import assert from "node:assert/strict";
import { eventAttendanceDates, TripContextSnapshotSchema, type TripContextSnapshot } from "@commons/contracts";
import type { WorkflowValidationScope } from "@commons/database";
import { assertResearchDecisionContextCurrent, projectResearchDecisionContext, ResearchContextConflict,
  buildSavedWineryDecision, buildSavedTransportDecision, type ResearchContextSelection } from "./research-decision-context";

const uuid = (n: number) => `98000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-10-03T18:00:00.000Z";
const scope: WorkflowValidationScope = { tripId: uuid(1), actorId: uuid(2), taskId: uuid(3), threadId: uuid(4), artifactId: uuid(5),
  pins: { goalRevision: 1, briefRevision: 1, contextVersion: "shared-context-1", recipe: { key: "transport-decision-v1", version: 1, digest: "a".repeat(64) }, policyVersion: "policy-1" } };
function fact<T>(id: string, recordType: "trip" | "membership" | "stay" | "travel_plan" | "itinerary_item" | "budget", recordId: string, value: T) {
  return { id, version: now, provenance: { kind: "saved_record", recordType, recordId, threadId: null, label: null },
    freshness: { asOf: now, updatedAt: now }, value };
}
function snapshot(): TripContextSnapshot {
  const member = (id: number, attendance: string) => fact(`traveler:${uuid(id)}`, "membership", uuid(id), {
    personId: uuid(id), name: `PRIVATE_NAME_${id}`, role: id === 2 ? "organizer" : "member", membership: "active", managed: false, attendance, attendanceDates: null });
  return TripContextSnapshotSchema.parse({ schemaVersion: 1, tripId: uuid(1), assembledAt: now, audience: "active_organizers",
    trip: fact("trip", "trip", uuid(1), { name: "PRIVATE_TRIP_NAME", destination: "Sonoma", startsOn: "2026-11-05", endsOn: "2026-11-07", timezone: "America/Los_Angeles" }),
    travelers: [member(2, "attending"), member(6, "attending"), member(7, "declined"), member(8, "unknown")],
    stays: [fact(`stay:${uuid(9)}`, "stay", uuid(9), { stayId: uuid(9), name: "Saved Sonoma Lodge", address: "Internal route address",
      startsOn: "2026-11-05", endsOn: "2026-11-07", status: "confirmed", bookingReportedByOrganizer: true, availabilityVerified: false,
      timezone: "America/Los_Angeles", checkInTime: "16:00", checkOutTime: "11:00", costCents: 123456, costKind: "confirmation", currency: "USD", includedPersonIds: [uuid(2), uuid(6)] })],
    logistics: [fact(`travel:${uuid(10)}`, "travel_plan", uuid(10), { travelPlanId: uuid(10), travelerIds: [uuid(2), uuid(6)],
      kind: "arrival", visibility: "basic", route: "PRIVATE_ROUTE_DONT_PARSE_SFO", date: "2026-11-05", localTime: "13:12", status: "booked",
      arrivesAt: null, departsAt: null, connections: [{ origin: "DEN", destination: "OAK", departureDate: "2026-11-05", arrivalDate: "2026-11-05",
        departureTime: "11:00", arrivalTime: "13:12", departureTimezone: "America/Denver", arrivalTimezone: "America/Los_Angeles", flightNumber: "PRIVATE_FLIGHT_NUMBER" }] })],
    plans: [fact(`plan:${uuid(11)}`, "itinerary_item", uuid(11), { itemId: uuid(11), title: "Winery visit", status: "idea",
      scheduledDate: null, startsAt: null, location: null, participantScope: "everyone" })],
    budget: fact("budget", "budget", uuid(1), { targetTotalCents: 900000, recordedExpenseTotalCents: 0, recordedExpenseCount: 0, currency: "USD" }),
    polls: [], tasks: [], pendingProposals: [], threads: [], unknowns: [], capabilities: [] });
}
function selection(context = snapshot()): ResearchContextSelection {
  const ref = (f: { id: string; version: string | number }) => ({ id: f.id, version: f.version });
  return { party: context.travelers.slice(0, 2).map(ref), stays: context.stays.map(ref), flights: context.logistics.map(ref), plans: context.plans.map(ref) };
}
const project = (context = snapshot(), selected = selection(context), currentScope = scope) => projectResearchDecisionContext(context, currentScope, selected);

test("project only explicitly selected reported-attending people; preserve OAK rather than scenario SFO", () => {
  const value = project().value;
  assert.equal(value.party.size, 2); assert.equal(value.flights[0].connections[0].destination, "OAK");
  assert.equal(value.trip.startsOn, "2026-11-05"); assert.equal(value.stays[0].availabilityVerified, false);
  assert.equal(value.plans[0].status, "idea"); assert.equal(value.factRefs.length, 6);
  assert.deepEqual(value.scope, { tripId: scope.tripId, threadId: scope.threadId, taskId: scope.taskId, actorId: scope.actorId,
    artifactId: scope.artifactId, goalRevision: 1, briefRevision: 1, contextVersion: scope.pins.contextVersion, recipe: scope.pins.recipe, policyVersion: scope.pins.policyVersion });
});
test("exclude names, trip label, money, raw route and flight numbers from dependency projection", () => {
  const serialized = JSON.stringify(project());
  assert.doesNotMatch(serialized, /PRIVATE_|costCents|includedPersonIds|budget|provenance|freshness|bookingReportedByOrganizer/);
});
test("missing structured endpoints remain unknown even if route prose names an airport", () => {
  const context = snapshot(); context.logistics[0].value.connections = [];
  assert.deepEqual(project(context).value.flights[0].connections, []);
});
test("preserve partial attendance prose without claiming availability for all legs", () => {
  const context = snapshot(); context.travelers[1].value.attendanceDates = "Friday only";
  assert.equal(project(context).value.party.members[1].attendanceDates, "Friday only");
});
test("benign input row/selection ordering and read timestamps do not stale dependencies", () => {
  const context = snapshot(), expected = project(context), selected = selection(context);
  context.travelers.reverse(); selected.party.reverse(); context.assembledAt = "2026-10-03T19:00:00.000Z";
  for (const fact of [...context.travelers, ...context.stays, ...context.logistics]) fact.freshness.asOf = context.assembledAt;
  assertResearchDecisionContextCurrent(expected, project(context, selected));
});
test("selected values change fences even if row versions and generic context hash repeat", () => {
  const expected = project();
  const mutations = [
    (c: TripContextSnapshot) => { c.logistics[0].value.connections![0].destination = "SFO"; },
    (c: TripContextSnapshot) => { c.logistics[0].value.connections![0].arrivalTime = "15:12"; },
    (c: TripContextSnapshot) => { c.stays[0].value.startsOn = "2026-11-06"; },
    (c: TripContextSnapshot) => { c.plans[0].value.status = "confirmed"; },
    (c: TripContextSnapshot) => { c.travelers[1].value.attendanceDates = "Saturday only"; },
    (c: TripContextSnapshot) => { c.trip.value.endsOn = "2026-11-08"; },
  ];
  for (const mutate of mutations) { const context = snapshot(); mutate(context); assert.throws(() => assertResearchDecisionContextCurrent(expected, project(context)), ResearchContextConflict); }
});
test("task, artifact, policy, brief and shared context changes fence the same saved facts", () => {
  const expected = project();
  for (const changed of [
    { ...scope, artifactId: uuid(30) }, { ...scope, taskId: uuid(31) },
    { ...scope, pins: { ...scope.pins, policyVersion: "policy-2" } },
    { ...scope, pins: { ...scope.pins, briefRevision: 2 } },
    { ...scope, pins: { ...scope.pins, goalRevision: 2 } },
    { ...scope, pins: { ...scope.pins, contextVersion: "shared-context-2" } },
  ]) assert.throws(() => assertResearchDecisionContextCurrent(expected, project(snapshot(), selection(), changed)), ResearchContextConflict);
});
test("changed source version, deletion or duplicate source cannot resolve a selected ref", () => {
  for (const mutation of [
    (c: TripContextSnapshot) => { c.stays[0].version = "2026-10-03T19:00:00.000Z"; },
    (c: TripContextSnapshot) => { c.stays = []; },
    (c: TripContextSnapshot) => { c.stays.push(c.stays[0]); },
  ]) { const context = snapshot(); mutation(context); assert.throws(() => project(context, selection()), ResearchContextConflict); }
});
test("cross-trip scope and revoked/non-organizer actor fail closed", () => {
  assert.throws(() => project(snapshot(), selection(), { ...scope, tripId: uuid(99) }), ResearchContextConflict);
  for (const mutation of [
    (c: TripContextSnapshot) => { c.travelers[0].value.role = "member"; },
    (c: TripContextSnapshot) => { c.travelers[0].value.membership = "invited"; },
    (c: TripContextSnapshot) => { c.travelers = c.travelers.slice(1); },
  ]) { const context = snapshot(); mutation(context); assert.throws(() => project(context, selection()), ResearchContextConflict); }
});
test("invited, declined or unknown attendance is not silently counted as the party", () => {
  for (const attendance of ["unknown", "declined", "helping"] as const) {
    const context = snapshot(); context.travelers[1].value.attendance = attendance;
    assert.throws(() => project(context), ResearchContextConflict);
  }
  const context = snapshot(); context.travelers[1].value.membership = "invited";
  assert.throws(() => project(context), ResearchContextConflict);
});
test("private/unclassified, tentative, wrong-kind or unrelated flights cannot enter shared research", () => {
  for (const mutation of [
    (c: TripContextSnapshot) => { c.logistics[0].value.visibility = "private"; },
    (c: TripContextSnapshot) => { delete c.logistics[0].value.visibility; },
    (c: TripContextSnapshot) => { c.logistics[0].value.status = "considering"; },
    (c: TripContextSnapshot) => { c.logistics[0].value.kind = "car_rental"; },
    (c: TripContextSnapshot) => { c.logistics[0].value.travelerIds = [uuid(7)]; },
  ]) { const context = snapshot(); mutation(context); assert.throws(() => project(context), ResearchContextConflict); }
});
test("pending discussion provenance, mismatched record identity or blank version is not canonical", () => {
  for (const mutation of [
    (c: TripContextSnapshot) => { c.stays[0].provenance.kind = "thread_discussion"; },
    (c: TripContextSnapshot) => { c.stays[0].value.stayId = uuid(99); },
    (c: TripContextSnapshot) => { c.stays[0].provenance.recordId = uuid(99); },
    (c: TripContextSnapshot) => { c.stays[0].version = ""; },
  ]) { const context = snapshot(); mutation(context); assert.throws(() => project(context)); }
});
test("a saturated row window cannot claim complete canonical context", () => {
  const context = snapshot(); context.plans = Array.from({ length: 40 }, (_, index) => ({ ...context.plans[0], id: `plan:${uuid(100 + index)}` }));
  assert.throws(() => project(context, { ...selection(), plans: [] }), ResearchContextConflict);
});
test("considering lodging, non-shared plans, repeated selection and reversed dates fail closed", () => {
  for (const mutation of [
    (c: TripContextSnapshot) => { c.stays[0].value.status = "considering"; },
    (c: TripContextSnapshot) => { c.plans[0].value.participantScope = "some"; },
    (c: TripContextSnapshot) => { c.trip.value.endsOn = "2026-11-04"; },
    (c: TripContextSnapshot) => { c.stays[0].value.endsOn = "2026-11-04"; },
  ]) { const context = snapshot(); mutation(context); assert.throws(() => project(context), ResearchContextConflict); }
  const selected = selection(); selected.party.push(selected.party[0]);
  assert.throws(() => project(snapshot(), selected), ResearchContextConflict);
});

const queries = [{ id: "group-policy", text: "Sonoma group tasting policies", followUpFor: null }];
const winery = { title: "Which winery?", queries, nominated: [{ id: "flowers", name: "Flowers", priority: false, memberConnection: false }] };
test("saved winery builder derives party, dates, weekdays and runtime identity, not browser pins", () => {
  const projection = project(snapshot(), selection(), { ...scope, pins: { ...scope.pins, recipe: { ...scope.pins.recipe, key: "winery-decision-v1" } } });
  const brief = buildSavedWineryDecision(projection, winery);
  assert.equal(brief.partySize, 2); assert.equal(brief.startsOn, "2026-11-05");
  assert.deepEqual(brief.requestedWeekdays, ["Thursday", "Friday", "Saturday"]);
  assert.equal(brief.taskId, scope.taskId); assert.deepEqual(brief.factRefs, projection.value.factRefs);
  for (const field of ["partySize", "startsOn", "ownerId", "recipe", "contextRevision", "factRefs"])
    assert.throws(() => buildSavedWineryDecision(projection, { ...winery, [field]: "FORGED" }));
});
function transport() {
  const context = snapshot();
  context.logistics.push({ ...context.logistics[0], id: `travel:${uuid(12)}`, provenance: { ...context.logistics[0].provenance, recordId: uuid(12) },
    value: { ...context.logistics[0].value, travelPlanId: uuid(12), kind: "departure", connections: [{ origin: "OAK", destination: "DEN",
      departureDate: "2026-11-07", arrivalDate: "2026-11-07", departureTime: "16:00", arrivalTime: "19:00",
      departureTimezone: "America/Los_Angeles", arrivalTimezone: "America/Denver", flightNumber: null }] } });
  const projection = project(context), request = { title: "Whole-trip transport", queries,
    stayRef: { id: projection.value.stays[0].id, version: projection.value.stays[0].version },
    arrivalRef: { id: projection.value.flights[0].id, version: now }, departureRef: { id: projection.value.flights[1].id, version: now }, wineryDate: "2026-11-06" };
  return { context, projection, request };
}
test("reviewed transport answers distinguish airport drivers from winery-day drivers and preserve zero", () => {
  const { projection, request } = transport();
  const answers = { drivers: { arrival: 2, wineries: 0, return: 1 }, luggagePieces: 0 };
  const original = buildSavedTransportDecision(projection, request);
  const answered = buildSavedTransportDecision(projection, { ...request, answers });
  assert.deepEqual(answered.legs.map(leg => leg.willingDrivers), [2, 0, 1]);
  assert.equal(answered.willingDrivers, null, "Per-leg answers never invent an all-trip driver commitment.");
  assert.equal(answered.luggagePieces, 0);
  assert.equal(answered.legs[0].origin, "OAK");
  assert.notEqual(answered.legs[0].requirementVersion, original.legs[0].requirementVersion);
  const revised = buildSavedTransportDecision(projection, { ...request, answers: { ...answers, luggagePieces: 3 } });
  assert.notEqual(revised.legs[0].requirementVersion, answered.legs[0].requirementVersion);
});
test("transport answers are strict, bounded and optional; null is not zero", () => {
  const { projection, request } = transport();
  const answers = { drivers: { arrival: null, wineries: 0, return: null }, luggagePieces: null };
  const brief = buildSavedTransportDecision(projection, { ...request, answers });
  assert.deepEqual(brief.legs.map(leg => leg.willingDrivers), [null, 0, null]);
  assert.equal(brief.luggagePieces, null);
  for (const invalid of [
    { ...answers, drivers: { ...answers.drivers, arrival: 3 } }, // Two selected travelers.
    { ...answers, drivers: { ...answers.drivers, arrival: -1 } },
    { ...answers, drivers: { ...answers.drivers, arrival: 1.5 } },
    { ...answers, drivers: { ...answers.drivers, arrival: "2" } },
    { ...answers, luggagePieces: 201 }, { ...answers, luggagePieces: -1 },
    { ...answers, approved: true }, { ...answers, drivers: { arrival: 1, wineries: 0 } },
  ]) assert.throws(() => buildSavedTransportDecision(projection, { ...request, answers: invalid } as Parameters<typeof buildSavedTransportDecision>[1]));
});
test("saved transport builder uses actual arrival/departure airports across all three legs", () => {
  const { projection, request } = transport(), brief = buildSavedTransportDecision(projection, request);
  assert.equal(brief.legs[0].origin, "OAK"); assert.equal(brief.legs[2].destination, "OAK");
  assert.deepEqual(brief.legs.map(leg => leg.date), ["2026-11-05", "2026-11-06", "2026-11-07"]);
  assert.ok(brief.legs.every(leg => leg.requirementVersion === brief.legs[0].requirementVersion && leg.partySize === 2));
  assert.equal(brief.luggagePieces, null); assert.equal(brief.willingDrivers, null);
});
test("transport refuses wrong kind, stale selections, date scope and silently combined cohorts", () => {
  const { projection, request, context } = transport();
  assert.throws(() => buildSavedTransportDecision(projection, { ...request, departureRef: request.arrivalRef }), ResearchContextConflict);
  assert.throws(() => buildSavedTransportDecision(projection, { ...request, stayRef: { ...request.stayRef, version: "stale" } }), ResearchContextConflict);
  assert.throws(() => buildSavedTransportDecision(projection, { ...request, wineryDate: "2026-11-08" }));
  context.logistics[1].value.travelerIds = [scope.actorId];
  assert.throws(() => buildSavedTransportDecision(project(context), request), ResearchContextConflict);
});
test("partial attendance holds a whole-party transport brief, and changing the reviewed day changes leg versions", () => {
  const { context, projection, request } = transport(); context.travelers[1].value.attendanceDates = "Friday only";
  assert.throws(() => buildSavedTransportDecision(project(context), request), ResearchContextConflict);
  const first = buildSavedTransportDecision(projection, request), second = buildSavedTransportDecision(projection, { ...request, wineryDate: "2026-11-07" });
  assert.notEqual(first.legs[1].requirementVersion, second.legs[1].requirementVersion);
});
test("transport accepts the exact current full-trip attendance stamp without interpreting prose", () => {
  const { context, request } = transport();
  const stamp = eventAttendanceDates(context.trip.value.startsOn, context.trip.value.endsOn);
  for (const traveler of context.travelers.slice(0, 2)) traveler.value.attendanceDates = stamp;
  const projection = project(context), brief = buildSavedTransportDecision(projection, request);
  assert.ok(projection.value.party.members.every(member => member.attendanceDates === stamp));
  assert.deepEqual(brief.legs.map(leg => leg.date), ["2026-11-05", "2026-11-06", "2026-11-07"]);
  assert.equal(brief.partySize, 2); assert.equal(brief.willingDrivers, null); assert.equal(brief.luggagePieces, null);
});
test("transport still holds partial, obsolete or malformed attendance stamps and unknown-window stamps", () => {
  for (const attendanceDates of ["Friday only", "2026-11-06/2026-11-07", "2026-11-05/2026-11-08",
    "2026-11-05 to 2026-11-07", " 2026-11-05/2026-11-07 ", "unset/unset"]) {
    const { context, request } = transport(); context.travelers[1].value.attendanceDates = attendanceDates;
    assert.throws(() => buildSavedTransportDecision(project(context), request), ResearchContextConflict);
  }
  for (const dates of [[null, null], ["2026-11-05", null], [null, "2026-11-07"]] as const) {
    const { context, request } = transport();
    [context.trip.value.startsOn, context.trip.value.endsOn] = dates;
    context.travelers[1].value.attendanceDates = eventAttendanceDates(dates[0], dates[1]);
    assert.throws(() => buildSavedTransportDecision(project(context), request), ResearchContextConflict);
  }
});
test("transport never repairs absent connection fields from route prose or trip dates", () => {
  const { context, request } = transport(); context.logistics[0].value.connections = [];
  const brief = buildSavedTransportDecision(project(context), request);
  assert.equal(brief.legs[0].origin, null); assert.equal(brief.legs[0].date, null);
});
test("recipe-specific builder refuses a different domain; unknown dates remain unknown", () => {
  assert.throws(() => buildSavedWineryDecision(project(), winery), ResearchContextConflict);
  const context = snapshot(); context.trip.value.startsOn = null; context.trip.value.endsOn = null;
  const projection = project(context, selection(context), { ...scope, pins: { ...scope.pins, recipe: { ...scope.pins.recipe, key: "winery-decision-v1" } } });
  const brief = buildSavedWineryDecision(projection, winery);
  assert.equal(brief.startsOn, null); assert.deepEqual(brief.requestedWeekdays, []);
});
