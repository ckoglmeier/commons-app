import assert from "node:assert/strict";
import test from "node:test";
import type { CommonsParticipant, CommonsState, CommonsSummary, TravelPlan } from "@commons/contracts";
import { homeSetup } from "./home-setup";
const commons: CommonsSummary = { id: "event", slug: "event", name: "Event", startsOn: null, endsOn: null, locationName: null, timezone: "UTC", status: "planning", coverImageUrl: null };
const state: CommonsState = { commonsId: "event", messages: [], proposals: [], itinerary: [], auditEvents: [], processedCommandIds: [], participation: {}, expenses: [], reimbursements: [], moments: [] };
const people: CommonsParticipant[] = ["adult", "managed"].map(id => ({ id, displayName: id, initials: "A", role: "member", membershipStatus: "active", accessMode: id === "managed" ? "managed" : "account", avatarUrl: null }));
const flight = (kind: "arrival" | "departure"): TravelPlan => ({ id: kind, personId: "adult", personIds: ["adult", "managed"], personName: "Adult", kind, date: "2026-12-20", route: "A to B", note: "", sourceLabel: "Added by adult", visibility: "basic" });
test("complete visible arrangements suppress setup/import, including managed travelers", () => {
  assert.deepEqual(homeSetup(commons, { ...state, travelPlans: [flight("arrival"), flight("departure")] }, people), { showTravel: false, takingShape: true });
});
test("partial travel invites review, not a not-booked claim", () => {
  assert.equal(homeSetup(commons, { ...state, travelPlans: [flight("arrival")] }, people).showTravel, true);
});
test("local or empty events do not acquire a universal flight requirement", () => {
  assert.equal(homeSetup(commons, state, people).showTravel, false);
});
