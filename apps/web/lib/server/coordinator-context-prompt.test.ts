import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TripContextSnapshotSchema, type TripContextSnapshot } from "@commons/contracts";
import { renderTripContextForModel, tripLocalTime, TRIP_CONTEXT_RULES } from "./coordinator-context-prompt";
import { buildPublicResearchQuery, sanitizeTypedResearchQuery, sanitizePublicLodgingQuery } from "./coordinator-research-query";
import { routeCoordinatorIntent } from "./coordinator-routing";

const asOf = "2027-01-01T00:00:00.000Z";
const meta = (id: string, recordType: "stay" | "itinerary_item" | "poll" | "membership" | "trip" | "budget" | "coordinator_thread", kind: "saved_record" | "poll_preference" = "saved_record") =>
  ({ id, version: "v1", provenance: { kind, recordType, recordId: null, threadId: null, label: null }, freshness: { asOf, updatedAt: asOf } });
function snapshot(plans: number, threads = 2): TripContextSnapshot {
  const activeThread = randomUUID();
  const person = randomUUID(), stayId = randomUUID();
  return TripContextSnapshotSchema.parse({
    schemaVersion: 1, tripId: randomUUID(), assembledAt: asOf, audience: "active_organizers",
    trip: { ...meta("trip", "trip"), value: { name: "Synthetic trip", destination: "Breckenridge, Colorado", startsOn: "2027-02-12", endsOn: "2027-02-15", timezone: "America/Denver" } },
    travelers: [{ ...meta(`traveler:${person}`, "membership"), value: { personId: person, name: "Casey Synthetic", role: "organizer", membership: "active", managed: false, attendance: "attending", attendanceDates: null } }],
    stays: [{ ...meta(`stay:${stayId}`, "stay"), value: { stayId, name: "Synthetic Peak Lodge", address: "100 Ridge Rd", startsOn: "2027-02-12", endsOn: "2027-02-15", checkInTime: null, checkOutTime: null, status: "confirmed", bookingReportedByOrganizer: true, availabilityVerified: false, costCents: 184_000, costKind: "confirmation", currency: "USD", includedPersonIds: [person] } }],
    plans: Array.from({ length: plans }, (_, index) => ({ ...meta(`plan:${index}`, "itinerary_item"), value: { itemId: randomUUID(), title: `Plan ${index} ${"x".repeat(80)}`, status: "idea", startsAt: null, location: null, participantScope: "everyone" } })),
    logistics: [], budget: { ...meta("budget", "budget"), value: { targetTotalCents: null, recordedExpenseTotalCents: 0, recordedExpenseCount: 0, currency: "USD" } },
    polls: [], pendingProposals: [],
    threads: Array.from({ length: threads }, (_, index) => ({ threadId: index === 0 ? randomUUID() : activeThread, title: index === 0 ? "Other topic" : "Active topic", status: "active", summary: "Tentative talk", summaryTurnVersion: 1, turnVersion: 3, openQuestions: [], approvedOutcomes: [], artifactCounts: { drafts: 0, polls: 0, research: 0, linkedIdeas: 0 }, lastActivityAt: asOf })),
    capabilities: ["answer"], unknowns: ["budget", "plans"],
  });
}

test("live food input is sourced organizer context, never public research context, and budget omissions are explicit", async () => {
  const value = snapshot(0, 0), pollId = randomUUID();
  value.foodPreferences = [{ ...meta(`food:${pollId}`, "poll", "poll_preference"), value: { runId: randomUUID(), pollId, title: "Food preferences", status: "open", responseCount: 1, omittedResponses: 0, entries: [{ responseId: randomUUID(), name: "Dietary Guest", requirements: "PRIVATE_ALLERGY_MARKER", preferences: null, notes: null, truncated: false }] } }];
  const rendered = renderTripContextForModel(value, { maxChars: 24000 });
  assert.match(rendered.json, /PRIVATE_ALLERGY_MARKER/);
  assert.ok(rendered.sources.some(s => s.kind === "trip_fact" && s.factId === `food:${pollId}`));
  assert.doesNotMatch(buildPublicResearchQuery("Find restaurants for PRIVATE_ALLERGY_MARKER", value) ?? "", /PRIVATE_ALLERGY_MARKER/);
  assert.doesNotMatch(sanitizeTypedResearchQuery("restaurants PRIVATE_ALLERGY_MARKER", value)?.query ?? "", /PRIVATE_ALLERGY_MARKER/);
  const smaller = renderTripContextForModel(value, { maxChars: rendered.json.length - 100 });
  assert.equal(smaller.budgetExceeded, false); assert.equal(JSON.parse(smaller.json).coverage.omittedFoodPolls, 1);
  assert.ok(!smaller.sources.some(s => s.kind === "trip_fact" && s.factId === `food:${pollId}`));
  value.foodPreferences[0].value.entries[0].requirements = "Severe peanut allergy; carries epinephrine.";
  for (const query of ["restaurants peanut allergy Denver", "restaurants epinephrine Denver"]) {
    assert.doesNotMatch(sanitizeTypedResearchQuery(query, value)?.query ?? "", /peanut|allergy|epinephrine/i);
    assert.doesNotMatch(buildPublicResearchQuery(query, value) ?? "", /peanut|allergy|epinephrine/i);
  }
  value.foodPreferences[0].value.entries[0].requirements = "Allergie aux œufs; préfère végétalien. 蛋";
  for (const term of ["œufs", "végétalien", "蛋"]) assert.ok(!(sanitizeTypedResearchQuery(`restaurants ${term} Denver`, value)?.query ?? "").includes(term));
});

test("ordinary public searches survive saved food prose while distinctive private details stay blocked", () => {
  const value = snapshot(0, 0), pollId = randomUUID(); value.trip.value.destination = "Napa";
  const queries = ["wine tasting tours in Napa and Sonoma", "best brunch near the lodge", "dinner restaurants in Napa", "wine and a good brunch near the hotel"];
  const baseline = queries.map(query => buildPublicResearchQuery(query, value));
  value.foodPreferences = [{ ...meta(`food:${pollId}`, "poll", "poll_preference"), value: { runId: randomUUID(), pollId, title: "Food", status: "closed", roundState: "earlier", replacementState: "private_draft", responseCount: 1, omittedResponses: 0, entries: [{ responseId: randomUUID(), name: "Dietary Guest", requirements: "No nuts, and I am vegetarian for dinner in the evening", preferences: "Love wine and a good brunch near the hotel", notes: "PRIVATE_MEAL_CANARY", truncated: false }] } }];
  queries.forEach((query, index) => {
    assert.equal(buildPublicResearchQuery(query, value), baseline[index], query);
    assert.deepEqual(sanitizeTypedResearchQuery(query, value), { query, changed: false }, query);
  });
  for (const query of ["restaurants vegetarian nuts Napa", "dinner PRIVATE_MEAL_CANARY Napa", value.foodPreferences[0].value.entries[0].requirements!]) {
    assert.doesNotMatch(sanitizeTypedResearchQuery(query, value)?.query ?? "", /vegetarian|nuts|PRIVATE_MEAL_CANARY/i);
    assert.doesNotMatch(buildPublicResearchQuery(query, value) ?? "", /vegetarian|nuts|PRIVATE_MEAL_CANARY/i);
  }
  for (const abbreviation of ["CF", "MS", "PK", "cf", "ra", "uc", "ed"]) {
    value.foodPreferences[0].value.entries[0].requirements = abbreviation;
    assert.deepEqual(sanitizeTypedResearchQuery("best restaurants in Napa", value), { query: "best restaurants in Napa", changed: false });
    assert.equal(buildPublicResearchQuery("best restaurants in Napa", value), "best restaurants in Napa");
    assert.doesNotMatch(sanitizeTypedResearchQuery(`restaurants for ${abbreviation} in Napa`, value)?.query ?? "", new RegExp(`\\b${abbreviation}\\b`, "i"));
    assert.doesNotMatch(buildPublicResearchQuery(`restaurants for ${abbreviation} in Napa`, value) ?? "", new RegExp(`\\b${abbreviation}\\b`, "i"));
  }
});

test("food vocabulary cannot make saved trip places private, while names and addresses remain filtered", () => {
  const value = snapshot(1, 0), pollId = randomUUID();
  value.trip.value.destination = "Napa";
  value.stays[0].value.name = "Sonoma Valley Lodge";
  value.stays[0].value.address = "100 Ridge Rd, Sonoma, Yountville";
  value.plans[0].value.location = "Sonoma Plaza";
  const queries = ["restaurants open late in Napa", "wine tasting tours in Napa and Sonoma", "Sonoma Plaza parking", "Yountville restaurants"];
  const baseline = queries.map(query => buildPublicResearchQuery(query, value));
  value.foodPreferences = [{ ...meta(`food:${pollId}`, "poll", "poll_preference"), value: { runId: randomUUID(), pollId, title: "Food", status: "closed", responseCount: 1, omittedResponses: 0, entries: [{ responseId: randomUUID(), name: "Dietary Guest", requirements: "PRIVATE_ALLERGY_MARKER", preferences: "Napa cabbage slaw and Sonoma cheese", notes: "Love Yountville and Valley wine near Sonoma Plaza", truncated: false }] } }];
  queries.forEach((query, index) => {
    assert.deepEqual(sanitizeTypedResearchQuery(query, value), { query, changed: false }, query);
    assert.equal(buildPublicResearchQuery(query, value), baseline[index], query);
  });
  // Exact saved place text is not a private dietary phrase merely because it
  // also appears as an answer. Unrelated food words are still protected.
  value.foodPreferences[0].value.entries[0].notes = "Napa";
  assert.deepEqual(sanitizeTypedResearchQuery("Napa", value), { query: "Napa", changed: false });
  for (const query of ["restaurants PRIVATE_ALLERGY_MARKER Napa", "restaurants cabbage cheese Napa", "restaurants for Casey Synthetic near Sonoma Valley Lodge at 100 Ridge Rd, Yountville"]) {
    for (const result of [sanitizeTypedResearchQuery(query, value)?.query ?? "", buildPublicResearchQuery(query, value) ?? ""])
      assert.doesNotMatch(result, /PRIVATE_ALLERGY_MARKER|cabbage|cheese|Casey Synthetic|Sonoma Valley Lodge|100 Ridge Rd/i);
  }
  // Saved destination/location fields are not an exemption from roster or
  // address rules, even when those same values occur in food answers.
  value.trip.value.destination = "Casey Synthetic";
  value.plans[0].value.location = "100 Ridge Rd";
  value.foodPreferences[0].value.entries[0].notes = "Casey Synthetic at 100 Ridge Rd";
  assert.doesNotMatch(sanitizeTypedResearchQuery("restaurants for Casey Synthetic at 100 Ridge Rd", value)?.query ?? "", /Casey Synthetic|100 Ridge Rd/);
  assert.doesNotMatch(buildPublicResearchQuery("restaurants nearby", value) ?? "", /Casey Synthetic/);
  value.plans[0].value.location = "Jackson, MS";
  for (const [location, term] of [["Jackson, MS", "MS"], ["Vegan House", "vegan"], ["Private Canary Venue", "Canary"]]) {
    value.plans[0].value.location = location;
    value.foodPreferences[0].value.entries[0].requirements = term;
    value.foodPreferences[0].value.entries[0].notes = null;
    const query = `${term} restaurants in Napa`;
    assert.doesNotMatch(sanitizeTypedResearchQuery(query, value)?.query ?? "", new RegExp(`\\b${term}\\b`, "i"), "place components never grant blanket permission");
    assert.doesNotMatch(buildPublicResearchQuery(query, value) ?? "", new RegExp(`\\b${term}\\b`, "i"));
  }
});

test("only explicit reviewed text searches may retain generic food predicates, never mixed private details", () => {
  const value = snapshot(0, 0), pollId = randomUUID(); value.trip.value.destination = "Napa";
  value.foodPreferences = [{ ...meta(`food:${pollId}`, "poll", "poll_preference"), value: { runId: randomUUID(), pollId, title: "Food", status: "open", responseCount: 1, omittedResponses: 0, entries: [{ responseId: randomUUID(), name: "Dietary Guest", requirements: "vegetarian gluten-free peanut allergy epinephrine PRIVATE_MEAL_MARKER", preferences: "Italian and spicy Thai food in Napa", notes: null, truncated: false }] } }];
  const queries = ["Italian restaurants in Napa", "vegetarian restaurants in Napa", "gluten-free bakery Napa", "spicy Thai food Napa", "peanut-free restaurants in Napa"];
  const route = (query: string, explicit = true, voice = false, slash = false) => routeCoordinatorIntent({ text: `Search for ${query}`, ...(explicit ? { explicitAction: { kind: "research" as const, query } } : {}), publicLodgingQuery: slash,
    draftSelected: false, snapshot: value, activeThreadId: null, flags: { tripChangesEnabled: true, researchConfigured: true }, inputMode: voice ? "voice" : "text" });
  for (const query of queries) {
    assert.deepEqual(sanitizeTypedResearchQuery(query, value, { reviewedFoodSearch: true }), { query, changed: false });
    for (const slash of [false, true]) assert.deepEqual(route(query, true, false, slash), { capability: "research", query, querySource: "organizer_typed" });
    assert.notEqual(sanitizeTypedResearchQuery(query, value)?.query, query, "shared/default check remains strict");
    assert.notEqual(buildPublicResearchQuery(query, value), query, "Commons-composed check remains strict");
    const spoken = route(query, true, true), inferred = route(query, false);
    assert.ok(spoken.capability !== "research" || spoken.query !== query, "voice cannot opt in");
    assert.ok(inferred.capability !== "research" || inferred.query !== query, "an inferred route cannot opt in");
  }
  for (const query of ["vegetarian restaurants for Casey Synthetic Napa", "vegetarian restaurants for Casey Napa", "vegetarian restaurants for Dietary Guest Napa", "vegetarian restaurants for our host Jamie Rivera Napa", "vegetarian restaurants PRIVATE_MEAL_MARKER Napa", "vegetarian restaurants epinephrine Napa", "vegetarian restaurants at 100 Ridge Rd Napa"]) {
    const result = sanitizeTypedResearchQuery(query, value, { reviewedFoodSearch: true })?.query ?? "";
    assert.doesNotMatch(result, /vegetarian|Casey|Dietary Guest|Jamie Rivera|PRIVATE_MEAL_MARKER|epinephrine|100 Ridge Rd/i, query);
  }
  assert.doesNotMatch(sanitizeTypedResearchQuery("peanut allergy restaurants Napa", value, { reviewedFoodSearch: true })?.query ?? "", /peanut|allergy/);
  assert.doesNotMatch(sanitizePublicLodgingQuery("vegetarian restaurants near hotel under $200 for Casey", value, { reviewedFoodSearch: true })?.query ?? "", /vegetarian|Casey|200/);
});

test("renders compact JSON with the active conversation first, unknowns, and source references", () => {
  const value = snapshot(2), focus = value.threads[1].threadId;
  const rendered = renderTripContextForModel(value, { maxChars: 6_000, focusThreadId: focus });
  const parsed = JSON.parse(rendered.json);
  assert.equal(parsed.conversations[0].id, focus);
  assert.equal(parsed.conversations[0].active, true);
  assert.equal(parsed.stays[0].availabilityVerified, false);
  assert.deepEqual(parsed.unknowns, ["budget", "plans"]);
  assert.equal(parsed.stays[0].cost.kind, "confirmation");
  assert.equal(rendered.truncated, false);
  assert.ok(rendered.sources.some(source => source.kind === "trip_fact" && source.factId.startsWith("stay:")));
  assert.match(TRIP_CONTEXT_RULES, /not saved yet/);
});

test("truncation drops discussion and optional ideas, marks coverage, and never silently drops core facts", () => {
  const value = snapshot(40);
  const full = renderTripContextForModel(value, { maxChars: 100_000 });
  const rendered = renderTripContextForModel(value, { maxChars: 3_000 });
  const parsed = JSON.parse(rendered.json);
  assert.equal(rendered.truncated, true);
  assert.ok(rendered.json.length <= 3_000);
  assert.equal(rendered.budgetExceeded, false);
  assert.ok(parsed.plans.length < 40 && parsed.plans.length < JSON.parse(full.json).plans.length);
  assert.equal(parsed.stays.length, 1);
  assert.equal(parsed.trip.destination, "Breckenridge, Colorado");
  assert.deepEqual(parsed.unknowns, ["budget", "plans"]);
  assert.ok(rendered.sources.filter(source => source.kind === "trip_fact" && source.factId.startsWith("plan:")).length === parsed.plans.length, "sources match what was actually sent");
});

test("approved decisions and scheduled plans survive preference truncation", () => {
  const value = snapshot(40); value.plans[0].value.status = "confirmed";
  value.polls = [{ ...meta("poll", "poll"), value: { pollId: randomUUID(), title: "Dates", status: "closed", threadId: null, responseCount: 8, resultsVisible: true, leadingOption: null,
    decision: { summary: "Thursday–Saturday", approvedAt: asOf, approvedByName: "Organizer" } } }];
  const result = renderTripContextForModel(value, { maxChars: 4000 });
  assert.equal(result.budgetExceeded, false);
  assert.equal(JSON.parse(result.json).plans[0].status, "confirmed"); assert.equal(JSON.parse(result.json).polls[0].decision.summary, "Thursday–Saturday");
});
test("oversized protected core produces an explicit bounded notice, not incomplete model facts", () => {
  const value = snapshot(40); value.plans.forEach(plan => { plan.value.status = "confirmed"; });
  const result = renderTripContextForModel(value, { maxChars: 3000 });
  assert.equal(result.budgetExceeded, true); assert.ok(result.json.length <= 3000); assert.deepEqual(result.sources, []);
  assert.equal(JSON.parse(result.json).coverage.protectedFactsOmitted, true);
});

test("plan and travel times reach the model as the trip's local time, never as raw UTC (live: a 9 AM Mountain lesson was read as 3:00 PM)", () => {
  assert.equal(tripLocalTime("2026-10-11T15:00:00.000Z", "America/Denver"), "Sun, Oct 11, 9:00 AM");
  assert.equal(tripLocalTime(null, "America/Denver"), null);
  assert.equal(tripLocalTime("2026-10-11T15:00:00.000Z", "Not/AZone"), null, "an unknown zone gives no time rather than a wrong one");
  const value = snapshot(1, 0);
  value.trip.value.timezone = "America/Denver";
  value.plans[0].value.startsAt = "2026-10-11T15:00:00.000Z";
  const rendered = JSON.parse(renderTripContextForModel(value, { maxChars: 24_000 }).json);
  assert.equal(rendered.plans[0].startsLocal, "Sun, Oct 11, 9:00 AM");
  assert.doesNotMatch(JSON.stringify(rendered.plans), /T15:00/);
});

test("confirmation questions use the selected Plan item and its current saved status", async () => {
  const {savedPlanStatusReply} = await import("./coordinator-plan-status");
  const {CoordinatorThreadSchema} = await import("@commons/contracts");
  const value = snapshot(2);
  value.plans[0].value = {...value.plans[0].value,title:"Fly-fishing lesson",status:"confirmed"};
  value.plans[1].value = {...value.plans[1].value,title:"Balloon Fiesta Kids’ Day",status:"confirmed"};
  const focus=value.threads[1].threadId;
  value.threads[1].title="Balloon Fiesta Kids’ Day";
  const conversation=CoordinatorThreadSchema.parse({version:0,activeThreadId:focus,threads:[],turns:[],drafts:[],polls:[],hasEarlier:false});
  assert.match(savedPlanStatusReply("Have we confirmed this event?",value,conversation,focus)!,/^Balloon Fiesta Kids’ Day.*confirmed, as reported/);
  value.plans[1].value.status="planned";
  assert.match(savedPlanStatusReply("Have we confirmed this event?",value,conversation,focus)!,/planned, not confirmed/);
  assert.match(savedPlanStatusReply("Is fly fishing confirmed?",value,conversation,focus)!,/^Fly-fishing lesson.*confirmed, as reported/);
  assert.match(savedPlanStatusReply("Have we confirmed this event?",value,conversation,null)!,/Which Plan item/);
  assert.equal(savedPlanStatusReply("Move fly fishing up a day",value,conversation,focus),null);
});

test("flight arrival uses the airport timezone even when the trip timezone differs; missing endpoints stay unknown", () => {
  const value = snapshot(0);
  value.trip.value.timezone = "America/Denver";
  value.logistics = TripContextSnapshotSchema.parse({ ...value, logistics: [{
    ...meta("flight", "trip"), value: {
      travelPlanId: randomUUID(), travelerIds: [], kind: "arrival", status: "confirmed",
      route: "DEN → SFO", date: "2026-11-05", localTime: "13:12",
      arrivesAt: "2026-11-05T21:12:00.000Z", departsAt: null,
      connections: [{origin:"DEN",destination:"SFO",departureDate:null,departureTime:null,departureTimezone:"America/Denver",arrivalDate:"2026-11-05",arrivalTime:"13:12",arrivalTimezone:"America/Los_Angeles",flightNumber:null}],
    },
  }] }).logistics;
  const flight = JSON.parse(renderTripContextForModel(value,{maxChars:24000}).json).logistics[0];
  assert.equal(flight.arrivesLocal, "Thu, Nov 5, 1:12 PM");
  assert.equal(flight.flights[0].arrivalTime, "1:12 PM");
  assert.equal(flight.flights[0].departureTime, null);
  value.logistics[0].value.connections = [];
  assert.equal(JSON.parse(renderTripContextForModel(value,{maxChars:24000}).json).logistics[0].arrivesLocal, null);
});
