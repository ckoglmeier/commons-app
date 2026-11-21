import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommonsParticipant, CommonsState, CommonsSummary } from "@commons/contracts";
import { DEFAULT_LETTER_SECTIONS, moveLetterSection, tripLetterDateline, tripLetterFacts, tripLetterUpdateText } from "./trip-letter";

test("the shareable update states saved facts only and omits what is still open", () => {
  const text = tripLetterUpdateText({ name: "Cape week", url: "https://example.test/c/1", facts: [{ label: "When", value: "July 18–25, 2027" }, { label: "Where", value: "Still open" }, { label: "Staying", value: "Nothing saved yet" }], updates: [{ title: "Whale watch", detail: "Added to the plan" }, { title: "B", detail: "Stay updated" }, { title: "C", detail: "Stay updated" }, { title: "Dropped", detail: "Stay updated" }] });
  assert.ok(text.includes("When: July 18–25, 2027"));
  assert.ok(!text.includes("Still open") && !text.includes("Nothing saved yet") && !text.includes("Dropped"));
  assert.ok(text.endsWith("https://example.test/c/1"));
});

test("moving a section stays in bounds and keeps every section", () => {
  assert.deepEqual(moveLetterSection(DEFAULT_LETTER_SECTIONS, "welcome", -1), DEFAULT_LETTER_SECTIONS);
  const moved = moveLetterSection(DEFAULT_LETTER_SECTIONS, "welcome", 1);
  assert.deepEqual(moved.map(section => section.id), ["facts", "welcome", "photo", "latest"]);
  assert.equal(moved.length, DEFAULT_LETTER_SECTIONS.length);
});

const commons = { id: "trip", slug: "trip", name: "Trip", startsOn: null, endsOn: null, locationName: null, timezone: "America/New_York", status: "planning", coverImageUrl: null } as CommonsSummary;
const empty = { itinerary: [], stays: [], auditEvents: [], participation: {} } as unknown as CommonsState;
const person = (id: string) => ({ id }) as CommonsParticipant;

test("an empty trip reads as open, with nothing inferred", () => {
  assert.deepEqual(tripLetterFacts(empty, commons, "me", {}, 0), [
    { label: "When", value: "Still open" },
    { label: "Where", value: "Still open" },
    { label: "Staying", value: "Nothing saved yet" },
  ]);
});

test("saved dates and place are stated as saved", () => {
  const facts = tripLetterFacts(empty, { ...commons, startsOn: "2027-07-18", endsOn: "2027-07-25", locationName: "Falmouth, Massachusetts" }, "me", {}, 0);
  assert.equal(facts[0].value, "July 18–25, 2027");
  assert.equal(facts[1].value, "Falmouth, Massachusetts");
  const across = tripLetterFacts(empty, { ...commons, startsOn: "2027-12-30", endsOn: "2028-01-02" }, "me", {}, 0);
  assert.equal(across[0].value, "December 30, 2027 – January 2, 2028");
  assert.equal(tripLetterFacts(empty, { ...commons, startsOn: "2027-07-18" }, "me", {}, 0)[0].value, "Starts July 18, 2027");
});

test("a considered stay is not reported as where the group is staying", () => {
  const state = { ...empty, stays: [{ id: "s", name: "Maybe house", status: "considering", includedPersonIds: ["me"], startsOn: "2027-07-18", endsOn: "2027-07-25" }] } as unknown as CommonsState;
  assert.equal(tripLetterFacts(state, commons, "me", {}, 0)[2].value, "Nothing saved yet");
});

test("an unscheduled idea never becomes First up", () => {
  const state = { ...empty, itinerary: [{ id: "i", title: "Whale watch", status: "idea", startsAt: "2027-07-20T14:00:00.000Z", participantScope: "everyone" }] } as unknown as CommonsState;
  assert.equal(tripLetterFacts(state, commons, "me", {}, 0).some(fact => fact.label === "First up"), false);
});

test("the dateline only claims what is true", () => {
  assert.equal(tripLetterDateline(empty, commons, [person("me")], "me"), "Only you can see this page");
  assert.equal(tripLetterDateline(empty, commons, [person("me"), person("them")], "me"), null);
  const state = { ...empty, auditEvents: [{ occurredAt: "2026-10-24T12:00:00.000Z" }, { occurredAt: "2026-10-28T12:00:00.000Z" }] } as unknown as CommonsState;
  assert.equal(tripLetterDateline(state, commons, [person("me"), person("them")], "me"), "Updated October 28");
});

test("someone who joined after the stay was booked sees that it's booked and that they're not on it yet", () => {
  const booked = (includedPersonIds: string[], extra: Record<string, unknown> = {}) => ({ id: "house", name: "Vineyard Cottage", address: "12 Grape Rd", confirmationCode: "ABC123", status: "confirmed", includedPersonIds, startsOn: "2027-07-18", endsOn: "2027-07-25", ...extra });
  const facts = (stays: unknown[], personId = "me") => tripLetterFacts({ ...empty, stays } as unknown as CommonsState, commons, personId, {}, 0);
  // On the stay: the stay itself, as before.
  assert.deepEqual(facts([booked(["me", "maya"])])[2], { label: "Staying", value: "Vineyard Cottage" });
  // Not on it: its name and size only, never its address or confirmation code.
  const late = facts([booked(["maya", "sam"])])[2];
  assert.deepEqual(late, { label: "Staying", value: "Vineyard Cottage is booked for 2 people. You’re not on it yet.", personal: true });
  assert.equal(facts([booked(["maya"])])[2].value, "Vineyard Cottage is booked for 1 person. You’re not on it yet.");
  assert.ok(!/Grape|ABC123/.test(late.value));
  // Nothing booked that they can see: a planned stay, one with nobody on it, or one that has ended.
  for (const stays of [[], [booked(["maya"], { status: "planned" })], [booked(["maya"], { status: "considering" })], [booked([])]]) assert.equal(facts(stays)[2].value, "Nothing saved yet");
  assert.equal(tripLetterFacts({ ...empty, stays: [booked(["maya"])] } as unknown as CommonsState, commons, "me", {}, Date.parse("2027-08-01T12:00:00Z"))[2].value, "Nothing saved yet");
  // It's about the viewer, so it stays out of an update shared with the group.
  const text = tripLetterUpdateText({ name: "Cape week", url: "https://example.test/c/1", facts: facts([booked(["maya"])]), updates: [] });
  assert.ok(!text.includes("Vineyard Cottage") && !text.includes("not on it"));
});
