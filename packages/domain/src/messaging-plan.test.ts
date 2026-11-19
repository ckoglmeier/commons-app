import assert from "node:assert/strict";
import test from "node:test";
import type { ItineraryItem, Stay, TravelPlan } from "@commons/contracts";
import { answerPlanQuestion, type PlanAnswer } from "./messaging-plan";

const me = "person-maya";
const item = (fields: Partial<ItineraryItem> & { title: string }): ItineraryItem => ({ id: fields.title, startsAt: null, participantScope: "everyone", status: "planned", provenanceLabel: "Added by Casey", ...fields });
// Los Angeles in June: UTC-7. Friday June 11 to Sunday June 13, 2027.
const itinerary = [
  item({ title: "Welcome drinks", startsAt: "2027-06-12T00:00:00Z", location: "The Patio, 1 Plaza St" }),
  item({ title: "The Girl and the Fig", mealType: "restaurant", startsAt: "2027-06-12T02:00:00Z", location: "110 W Spain St" }),
  item({ title: "Wine tasting", startsAt: "2027-06-12T18:00:00Z", location: "Ram's Gate" }),
  item({ title: "Bike ride", scheduledDate: "2027-06-12" }),
  item({ title: "Group dinner", mealType: "restaurant", startsAt: "2027-06-13T02:00:00Z" }),
  item({ title: "Spa morning", startsAt: "2027-06-12T17:00:00Z", participantScope: "subgroup", participantIds: ["person-sam"], location: "Secret Spa" }),
  item({ title: "Hot air balloon", status: "idea", startsAt: "2027-06-12T15:00:00Z", location: "Idea Field" }),
  item({ title: "Cancelled brunch", status: "cancelled", startsAt: "2027-06-13T17:00:00Z", location: "Gone Cafe" }),
];
const stays: Stay[] = [
  { id: "s1", name: "Vineyard Cottage", address: "12 Grape Rd", startsOn: "2027-06-11", endsOn: "2027-06-13", checkInTime: "16:00", status: "confirmed", includedPersonIds: [me], sourceLabel: "x" },
  { id: "s2", name: "Sam's Room", address: "99 Secret Ln", startsOn: "2027-06-11", endsOn: "2027-06-13", status: "confirmed", includedPersonIds: ["person-sam"], sourceLabel: "x" },
];
const travelPlans: TravelPlan[] = [
  { id: "t1", personId: me, personName: "Maya", kind: "arrival", date: "2027-06-11", time: "14:30", route: "DEN → SFO", note: "", sourceLabel: "x" },
  { id: "t2", personId: "person-sam", personName: "Sam", kind: "arrival", date: "2027-06-11", time: "09:00", route: "JFK → SFO", note: "", sourceLabel: "x" },
];
const ask = (body: string, now = "2027-06-11T22:00:00Z", overrides: Partial<Parameters<typeof answerPlanQuestion>[0]> = {}): PlanAnswer =>
  answerPlanQuestion({ body, now: new Date(now), timezone: "America/Los_Angeles", tripName: "Sonoma Weekend", startsOn: "2027-06-11", endsOn: "2027-06-13", personId: me, itinerary, stays, travelPlans, ...overrides });
const text = (answer: PlanAnswer) => { assert.equal(answer.kind, "answer", JSON.stringify(answer)); return (answer as { text: string }).text; };

test("when is dinner: the meal's time, not the trip's dates", () => {
  const answer = text(ask("when is dinner?"));
  assert.match(answer, /Fri, Jun 11, 7:00 PM/); assert.match(answer, /The Girl and the Fig/); assert.doesNotMatch(answer, /Jun 13/);
});

test("the address for dinner is the restaurant's, not the stay's", () => {
  const answer = text(ask("what's the address for dinner"));
  assert.match(answer, /110 W Spain St/); assert.doesNotMatch(answer, /Grape/);
});

test("once tonight's dinner has passed, dinner means the next one", () => {
  assert.match(text(ask("when is dinner", "2027-06-12T05:00:00Z")), /Group dinner/);
});

test("what's next skips what has already happened today", () => {
  assert.match(text(ask("what's next", "2027-06-12T01:00:00Z")), /The Girl and the Fig/);
  assert.match(text(ask("what are we doing next?", "2027-06-12T03:00:00Z")), /Wine tasting/);
  assert.match(text(ask("whats up next", "2027-06-12T03:00:00Z")), /^Next up/);
  assert.match(text(ask("next", "2027-06-12T03:00:00Z")), /Wine tasting/);
});

test("what's planned for Friday is that day, and only that day", () => {
  const answer = text(ask("What's planned for Friday?"));
  assert.match(answer, /Welcome drinks/); assert.match(answer, /Girl and the Fig/); assert.doesNotMatch(answer, /Wine tasting|Group dinner/);
  assert.match(text(ask("what's happening saturday")), /Wine tasting/);
  assert.match(text(ask("what's the plan for sun")), /Nothing is saved for Sun, Jun 13/, "a cancelled plan isn't on the plan");
});

test("today, tonight and tomorrow are in the trip's time zone", () => {
  // 11pm in Los Angeles is already the next day in UTC.
  assert.match(text(ask("what's on tomorrow", "2027-06-12T06:00:00Z")), /Sat, Jun 12/);
  assert.match(text(ask("what's on tonight", "2027-06-11T22:00:00Z")), /Welcome drinks/);
  assert.doesNotMatch(text(ask("what's on tonight", "2027-06-12T22:00:00Z")), /Wine tasting/, "a 11am tasting isn't tonight");
});

test("a day with nothing saved says so, plainly", () => {
  assert.match(text(ask("what's planned for Jun 13", "2027-06-11T22:00:00Z", { itinerary: itinerary.filter(entry => entry.title === "Welcome drinks") })), /Nothing is saved for Sun, Jun 13/);
});

test("something that isn't saved stays unknown, and never borrows a nearby fact", () => {
  assert.deepEqual(ask("when is the hike?"), { kind: "unknown" });
  assert.deepEqual(ask("where's the hike"), { kind: "unknown" });
  assert.deepEqual(ask("what time is the karaoke"), { kind: "unknown" });
});

test("a saved item missing the detail says which detail is missing", () => {
  assert.match(text(ask("when is the bike ride")), /Bike ride is on Sat, Jun 12\. It has no time yet/);
  assert.match(text(ask("where is the bike ride")), /no place yet/);
});

test("nobody learns about things they can't see: subgroup activities, ideas, cancelled plans, another person's stay or flight", () => {
  assert.deepEqual(ask("where is the spa"), { kind: "unknown" });
  assert.deepEqual(ask("when is the balloon"), { kind: "unknown" });
  assert.deepEqual(ask("where's cancelled brunch"), { kind: "unknown" });
  const everything = [ask("where are we staying"), ask("what's the schedule"), ask("what's happening saturday"), ask("when do i land")].map(text).join(" ");
  assert.doesNotMatch(everything, /Secret Spa|Spa morning|Idea Field|Gone Cafe|99 Secret|Sam's Room|JFK/);
  assert.match(text(ask("what time is the spa morning", "2027-06-11T22:00:00Z", { personId: "person-sam" })), /Spa morning/);
});

test("stays: where, address, check-in and check-out", () => {
  assert.match(text(ask("where are we staying?")), /Vineyard Cottage, 12 Grape Rd/);
  assert.match(text(ask("what's the address?")), /12 Grape Rd/);
  assert.match(text(ask("what's the address of the house")), /12 Grape Rd/);
  assert.match(text(ask("when is check in")), /check-in is Fri, Jun 11 at 4:00 PM/);
  assert.match(text(ask("when is checkout")), /check-out is Sun, Jun 13\. No time is saved/);
  assert.deepEqual(ask("where are we staying", "2027-06-11T22:00:00Z", { stays: [] }), { kind: "unknown" });
  assert.deepEqual(ask("what's the address", "2027-06-11T22:00:00Z", { stays: [] }), { kind: "unknown" });
});

test("the trip's own dates still answer, and the trip's name isn't mistaken for an activity", () => {
  assert.match(text(ask("when does it start")), /Fri, Jun 11 to Sun, Jun 13/);
  assert.match(text(ask("Sonoma when does it start")), /Fri, Jun 11/);
  assert.match(text(ask("what are the dates")), /Fri, Jun 11/);
  assert.match(text(ask("Sonoma: where are we staying?", "2027-06-11T22:00:00Z", { itinerary: [item({ title: "Sonoma wine tour", startsAt: "2027-06-12T18:00:00Z" })] })), /Vineyard Cottage/);
});

test("your own flight", () => {
  assert.match(text(ask("when do I land?")), /Getting there: Fri, Jun 11 at 2:30 PM, DEN → SFO/);
  assert.deepEqual(ask("when does my flight land", "2027-06-11T22:00:00Z", { travelPlans: [] }), { kind: "unknown" });
});

test("ordinary chat isn't a plan question, so nothing is claimed about it", () => {
  for (const body of ["sounds great", "thanks", "ok", "yes", "2", "dinner was amazing", "I love the wine tasting", "see you friday", ""]) assert.deepEqual(ask(body), { kind: "none" }, body);
});

test("long days are capped and say there's more", () => {
  const many = Array.from({ length: 7 }, (_, index) => item({ title: `Stop ${index + 1}`, startsAt: `2027-06-12T1${index}:00:00Z` }));
  assert.match(text(ask("what's planned for saturday", "2027-06-11T22:00:00Z", { itinerary: many })), /And 3 more on the trip page\.$/);
});
