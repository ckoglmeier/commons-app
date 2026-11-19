import assert from "node:assert/strict";
import test from "node:test";
import type { CommonsState, CommonsSummary, Stay } from "@commons/contracts";
import { homeShortcuts, homeUpdates } from "./home-dashboard";
const commons: CommonsSummary = { id: "event", slug: "event", name: "Event", startsOn: null, endsOn: null, locationName: null, timezone: "America/Denver", status: "planning", coverImageUrl: null };
const empty: CommonsState = { commonsId: "event", messages: [], proposals: [], itinerary: [], auditEvents: [], processedCommandIds: [], participation: {}, expenses: [], reimbursements: [], moments: [] };
const now = Date.parse("2026-09-11T12:00:00Z");
const plan = { id: "one", title: "Lunch", startsAt: "2026-09-12T18:00:00Z", status: "planned" as const, participantScope: "everyone" as const, provenanceLabel: "Added by Jo" };
const stay: Stay = { id: "house", name: "House", address: "Main St", startsOn: "2026-09-12", endsOn: "2026-09-14", status: "confirmed", includedPersonIds: ["me"], sourceLabel: "Added by Jo" };
test("shortcuts progress independently from empty to plans to stay", () => {
  assert.equal(homeShortcuts(empty, commons, "me", {}, now).hasPlans, false);
  const state = { ...empty, itinerary: [plan] };
  assert.equal(homeShortcuts(state, commons, "me", {}, now).hasPlans, true);
});
test("optional next activity requires explicit participation and excludes past, cancelled and ideas", () => {
  const optional = { ...plan, participantScope: "optional" as const };
  const state = { ...empty, itinerary: [optional] };
  assert.equal(homeShortcuts(state, commons, "me", {}, now).next, undefined);
  assert.equal(homeShortcuts(state, commons, "me", { one: "maybe" }, now).next, undefined);
  assert.equal(homeShortcuts(state, commons, "me", { one: "in" }, now).next?.id, "one");
  for (const status of ["cancelled", "idea"] as const) assert.equal(homeShortcuts({ ...state, itinerary: [{ ...optional, status }] }, commons, "me", { one: "in" }, now).next, undefined);
  assert.equal(homeShortcuts(state, commons, "me", { one: "in" }, now + 7 * 86400000).next, undefined);
});
test("everyone and specific people count as included without another attendance response", () => {
  const state = { ...empty, itinerary: [plan] };
  assert.equal(homeShortcuts(state, commons, "me", {}, now).next?.id, plan.id);
  for (const people of [{ expectedParticipantIds: ["me"] }, { participantIds: ["me"] }]) {
    const subgroup = { ...plan, participantScope: "subgroup" as const, ...people };
    assert.equal(homeShortcuts({ ...empty, itinerary: [subgroup] }, commons, "me", {}, now).next?.id, plan.id);
    assert.equal(homeShortcuts({ ...empty, itinerary: [subgroup] }, commons, "other", { one: "in" }, now).next, undefined);
  }
});
test("next activity is the earliest included activity, independent of saved order", () => {
  const later = { ...plan, id: "fishing", startsAt: "2026-09-14T15:00:00Z", participantScope: "optional" as const };
  const earlier = { ...plan, id: "pool", startsAt: "2026-09-12T16:00:00Z", participantScope: "subgroup" as const, expectedParticipantIds: ["me"] };
  const unrelated = { ...earlier, id: "museum", startsAt: "2026-09-12T15:00:00Z", expectedParticipantIds: ["other"] };
  const state = { ...empty, itinerary: [later, plan, unrelated, earlier] };
  assert.equal(homeShortcuts(state, commons, "me", { fishing: "in" }, now).next?.id, "pool");
  assert.equal(homeShortcuts(state, commons, "other", { fishing: "in" }, now).next?.id, "museum");
  assert.deepEqual(state.itinerary.map(item => item.id), ["fishing", "one", "museum", "pool"]);
});
test("planning estimates do not opt travelers into optional activities", () => {
  const optional = { ...plan, participantScope: "optional" as const, expectedParticipantIds: ["me"], participantIds: ["me"], respondedParticipantIds: [] };
  const state = { ...empty, itinerary: [optional] };
  assert.equal(homeShortcuts(state, commons, "me", {}, now).next, undefined);
  assert.equal(homeShortcuts({ ...state, itinerary: [{ ...optional, respondedParticipantIds: ["me"] }] }, commons, "me", {}, now).next?.id, plan.id);
});
test("explicit skip and maybe responses stay out of next activity in every audience", () => {
  for (const participantScope of ["everyone", "subgroup", "optional"] as const) {
    const included = { ...plan, participantScope, expectedParticipantIds: ["me"], participantIds: ["me"], respondedParticipantIds: ["me"] };
    for (const response of ["skip", "maybe"] as const) {
      assert.equal(homeShortcuts({ ...empty, itinerary: [included] }, commons, "me", { one: response }, now).next, undefined);
    }
  }
});
test("stay belongs to this traveler and selects current before future", () => {
  const future = { ...stay, id: "future", startsOn: "2026-10-01", endsOn: "2026-10-04" };
  assert.equal(homeShortcuts({ ...empty, stays: [future, stay] }, commons, "me", {}, now).stay?.id, "house");
  assert.equal(homeShortcuts({ ...empty, stays: [stay] }, commons, "other", {}, now).stay, undefined);
});
test("feed collapses record edits and never prints raw private audit content", () => {
  const audit = { id: "a", commandId: "c", actorId: "me", targetId: "one", occurredAt: "2026-09-11T10:00:00Z", action: "itinerary.added", summary: "SECRET" };
  const state = { ...empty, itinerary: [plan], auditEvents: [audit, { ...audit, id: "b", occurredAt: "2026-09-11T11:00:00Z", action: "itinerary.updated" }, { ...audit, id: "private", targetId: "flight", action: "travel_plan.saved" }, { ...audit, id: "cover", action: "commons.cover_updated" }] };
  const feed = homeUpdates(state);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].id, "b");
  assert.doesNotMatch(JSON.stringify(feed), /SECRET/);
});
test("Home updates leave out group messages while they are paused and keep decisions and plan updates", () => {
  const message = { id: "m", actorId: "me", actorName: "Jo", actorType: "human" as const, body: "Anyone hungry?", occurredAt: "2026-09-11T09:00:00Z", source: "web" as const };
  const proposal = { id: "p", title: "Dinner at Porch", summary: "", status: "approved", approvedAt: "2026-09-11T10:00:00Z" } as unknown as CommonsState["proposals"][number];
  const state = { ...empty, messages: [message], proposals: [proposal] };
  assert.deepEqual(homeUpdates(state).map(item => item.detail).sort(), ["Decision approved", "Jo"]);
  assert.deepEqual(homeUpdates(state, { includeMessages: false }).map(item => item.detail), ["Decision approved"]);
});
