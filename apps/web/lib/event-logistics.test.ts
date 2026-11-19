import assert from "node:assert/strict";
import test from "node:test";
import type { CommonsParticipant, CommonsSummary, Stay, TravelPlan } from "@commons/contracts";
import { eventLogisticsModel, visibleTravelForPerson } from "./event-logistics";

const event: CommonsSummary = { id: "event", slug: "event", name: "Neighborhood dinner", startsOn: null, endsOn: null, locationName: null, timezone: "America/Denver", status: "planning", coverImageUrl: null };
const people: CommonsParticipant[] = ["owner", "guest", "invited"].map(id => ({ id, displayName: id, initials: id[0], role: id === "owner" ? "organizer" : "member", membershipStatus: id === "invited" ? "invited" : "active", avatarUrl: null }));
const travel = (id: string, override: Partial<TravelPlan> = {}): TravelPlan => ({ id, personId: "owner", personIds: ["owner"], personName: "Owner", kind: "arrival", date: "2026-12-20", route: "DEN → SNA", note: "", sourceLabel: "Added by owner", visibility: "private", ...override });
const stay = (id: string, startsOn: string, status: Stay["status"] = "confirmed"): Stay => ({ id, name: id, address: "123 Example St", startsOn, endsOn: "2026-12-25", status, includedPersonIds: ["owner"], sourceLabel: "Added by owner" });

test("a local or undated event has basics and people, not fabricated missing bookings", () => {
  const model = eventLogisticsModel(event, [], [], people, "owner");
  assert.equal(model.peopleCount, 2);
  assert.deepEqual(model.stays, []);
  assert.deepEqual(model.sharedFlights, []);
  assert.deepEqual(model.sharedRentals, []);
  assert.deepEqual(model.privateTravel, []);
  assert.equal("readinessScore" in model, false);
});

test("multiple places deduplicate and committed stays stay chronological without promoting discovery", () => {
  const stays = [stay("later", "2026-12-23"), stay("idea", "2026-12-19", "considering"), stay("first", "2026-12-20", "planned")];
  const model = eventLogisticsModel({ ...event, locationName: "Laguna Beach", locationNames: ["Laguna Beach", "San Diego"] }, stays, [], people, "owner");
  assert.deepEqual(model.places, ["Laguna Beach", "San Diego"]);
  assert.deepEqual(model.stays.map(item => item.id), ["first", "later"]);
  assert.deepEqual(stays.map(item => item.id), ["later", "idea", "first"]);
});

test("private travel belongs to its owner or included travelers, never general group coverage", () => {
  const plans = [travel("owned-for-other", { personIds: ["guest"] }), travel("included", { personId: "guest", personIds: ["owner"] }), travel("other-private", { personId: "guest", personIds: ["guest"] }), travel("shared", { visibility: "basic", personIds: ["guest"] }), travel("rental", { kind: "car_rental", visibility: "all" })];
  const model = eventLogisticsModel(event, [], plans, people, "owner");
  assert.deepEqual(model.privateTravel.map(plan => plan.id), ["owned-for-other", "included"]);
  assert.deepEqual(model.sharedFlights.map(plan => plan.id), ["shared"]);
  assert.equal(model.arrivalCoverage, 1);
  assert.equal(model.departureCoverage, 0);
  assert.equal(model.sharedRentals.length, 1);
});

test("legacy lodging remains visible until first-class stays replace it", () => {
  const legacy = { name: "Existing stay", address: "123 Example St", sourceLabel: "Added by owner" };
  assert.deepEqual(eventLogisticsModel({ ...event, lodging: legacy }, [], [], people, "owner").legacyStay, legacy);
  assert.equal(eventLogisticsModel({ ...event, lodging: legacy }, [stay("new", "2026-12-20")], [], people, "owner").legacyStay, null);
});

test("person rows include every shared leg and rental, even when entered by someone else", () => {
  const plans = [travel("return", { kind: "departure", date: "2026-12-25", personIds: ["guest"], visibility: "basic" }), travel("rental", { kind: "car_rental", personIds: ["owner", "guest"], visibility: "all" }), travel("arrival", { personIds: ["guest"], visibility: "basic" })];
  assert.deepEqual(visibleTravelForPerson(plans, "guest", "owner").map(plan => plan.id), ["arrival", "rental", "return"]);
  assert.deepEqual(plans.map(plan => plan.id), ["return", "rental", "arrival"]);
});

test("private records are visible only to owner or included traveler, never through organizer role", () => {
  const plans = [travel("private-for-guest", { personIds: ["guest"] })];
  assert.equal(visibleTravelForPerson(plans, "guest", "unrelated-organizer").length, 0);
  assert.equal(visibleTravelForPerson(plans, "guest", "guest").length, 1);
  assert.equal(visibleTravelForPerson(plans, "guest", "owner").length, 1);
  assert.equal(visibleTravelForPerson(plans, "owner", "owner").length, 1, "owner can reach a booking without being a traveler");
  assert.equal(visibleTravelForPerson(plans, "owner", "guest").length, 0, "ownership is not participation");
});

test("multiple rentals and legacy single-traveler plans remain reachable without duplication", () => {
  const plans = [travel("legacy", { personIds: undefined, visibility: "basic" }), travel("rental-1", { kind: "car_rental" }), travel("rental-2", { kind: "car_rental" })];
  assert.equal(visibleTravelForPerson(plans, "owner", "owner").length, 3);
  assert.equal(visibleTravelForPerson(plans, "guest", "owner").length, 0);
});
