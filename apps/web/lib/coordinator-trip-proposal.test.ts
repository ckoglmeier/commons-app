import assert from "node:assert/strict";
import test from "node:test";
import { buildTripChangeProposal, isTripRecordRequest, savedTripFactsReply, tripProposalGap, tripRecordRequestSource, type TripProposalContext, type TripSuggestion } from "./coordinator-trip-proposal";

const stayId = "11111111-1111-4111-8111-111111111111";
const travelerId = "22222222-2222-4222-8222-222222222222";
const context: TripProposalContext = {
  name: "Synthetic mountain trip", startsOn: "2026-12-20", endsOn: "2026-12-24", locationName: "Colorado",
  targetBudgetCents: 200_000, travelers: [{ id: travelerId, name: "Synthetic Organizer" }],
  stays: [{ id: stayId, name: "Mountain rental", address: "Address to update", startsOn: "2026-12-20", endsOn: "2026-12-23",
    status: "planned", totalCents: 266_653, currency: "USD", bookingUrl: null, updatedAt: "2026-09-27T12:00:00.000Z", includedPersonIds: [travelerId] }],
};
const empty: TripSuggestion = { operations: [], budgetCents: null, startsOn: null, endsOn: null, locationName: null,
  stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null,
  stayTotalCents: null, stayBookingUrl: null, stayStatus: null,
  planId: null, planTitle: null, planStatus: null, planStartsOn: null, planStartsTime: null, planNote: null, planContactLabel: null };

test("budget and lodging proposal keeps trip dates separate and starts unsaved", () => {
  const suggestion: TripSuggestion = { ...empty, operations: ["budget", "stay"], budgetCents: 300_000,
    stayAddress: "100 Synthetic Lane", stayStatus: "confirmed" };
  const proposal = buildTripChangeProposal(suggestion, context, "Set our budget to $3,000 and record the booked lodging address");
  assert.ok(proposal);
  assert.deepEqual(proposal.operations, ["budget", "stay"]);
  assert.equal(proposal.state, "pending");
  assert.equal(proposal.base.budgetCents, 200_000);
  assert.equal(proposal.changes.budgetCents, 300_000);
  assert.equal(proposal.changes.stay?.id, stayId);
  assert.equal(proposal.changes.stay?.address, "100 Synthetic Lane");
  assert.equal(proposal.changes.startsOn, "2026-12-20");
  assert.equal(proposal.changes.endsOn, "2026-12-24");
  assert.equal(proposal.receipt, null);
});

test("ambiguous existing lodging cannot be silently selected", () => {
  const two = { ...context, stays: [...context.stays, { ...context.stays[0], id: "33333333-3333-4333-8333-333333333333" }] };
  assert.equal(buildTripChangeProposal({ ...empty, operations: ["stay"], stayAddress: "100 Synthetic Lane" }, two, "Update my lodging"), null);
});

test("a new address updates the saved stay; an explicitly new stay creates a proposal", () => {
  const suggestion = { ...empty, operations: ["stay"] as Array<"stay">, stayName: "Mountain rental", stayAddress: "New synthetic address" };
  assert.equal(buildTripChangeProposal(suggestion, context, "Save the new lodging address")?.changes.stay?.id, stayId);
  assert.equal(buildTripChangeProposal({ ...suggestion, stayName: "Second rental" }, context, "Add another stay")?.changes.stay?.id, null);
  assert.equal(buildTripChangeProposal({ ...suggestion, stayName: "Second rental" }, context, "Add this booked stay")?.changes.stay?.id, null);
  assert.equal(buildTripChangeProposal({ ...suggestion, stayId }, context, "Add another stay"), null);
});

test("new stay carries the earlier organizer-reported total for the same address and gets a location-based default name", () => {
  const address = "100 Snowberry Ln, Breckenridge, CO 80424";
  const suggestion: TripSuggestion = { ...empty, operations: ["stay"], stayName: "Breck Condo", stayAddress: address,
    stayStartsOn: "2026-12-20", stayEndsOn: "2026-12-23", stayStatus: "confirmed", stayTotalCents: null };
  const earlier = `2,666.53 total cost. Here's the spot: https://example.test/rooms/123 Address: ${address}`;
  const proposal = buildTripChangeProposal(suggestion, context, "Add another stay", [earlier,
    "I booked this. Raise the trip ceiling to 3000.", "Add another stay"]);
  assert.ok(proposal);
  assert.equal(proposal.changes.stay?.id, null);
  assert.equal(proposal.changes.stay?.name, "Breckenridge House");
  assert.equal(proposal.changes.stay?.totalCents, 266_653);
  assert.match(proposal.source, /\$2,666\.53 from an earlier organizer message/);
});

test("an explicit property name wins, while unrelated or nightly amounts do not become a new stay total", () => {
  const address = "50 Maple Ave, Steamboat Springs, CO 80487";
  const suggestion: TripSuggestion = { ...empty, operations: ["stay"], stayName: "Maple Cabin", stayAddress: address,
    stayStartsOn: "2026-12-20", stayEndsOn: "2026-12-23", stayTotalCents: 17_500 };
  const nameAndRate = `Add another stay at ${address}. Call it Maple Cabin. The rate is $175 per night.`;
  const unrelated = "The other cabin at 100 Snowberry Ln, Breckenridge, CO 80424 had a 2,666.53 total cost.";
  const proposal = buildTripChangeProposal(suggestion, context, nameAndRate, [unrelated, nameAndRate]);
  assert.ok(proposal);
  assert.equal(proposal.changes.stay?.name, "Maple Cabin");
  assert.equal(proposal.changes.stay?.totalCents, null);
  assert.equal(buildTripChangeProposal(suggestion, context,
    `Add another stay at ${address}. Total cost: $175 per night.`, [unrelated])?.changes.stay?.totalCents, null);
});

test("the latest explicit USD stay total in the request beats earlier same-property cost", () => {
  const address = "50 Maple Ave, Steamboat Springs, CO 80487";
  const suggestion: TripSuggestion = { ...empty, operations: ["stay"], stayAddress: address,
    stayStartsOn: "2026-12-20", stayEndsOn: "2026-12-23", stayTotalCents: null };
  const earlier = `Lodging total: $1,200 at ${address}`;
  const source = `Add another stay at ${address}. Total cost is $1,350.`;
  const proposal = buildTripChangeProposal(suggestion, context, source, [earlier, source]);
  assert.equal(proposal?.changes.stay?.totalCents, 135_000);
  assert.equal(proposal?.changes.stay?.name, "Steamboat Springs House");
  assert.doesNotMatch(proposal?.source ?? "", /earlier organizer message/);
});

test("model-only dollar figures are not offered as trip edits", () => {
  assert.equal(buildTripChangeProposal({ ...empty, operations: ["budget"], budgetCents: 300_000 }, context, "Update the budget"), null);
});

test("advice and unrelated poll work are not trip mutations", () => {
  assert.equal(buildTripChangeProposal(empty, context, "What should we do next?"), null);
  assert.equal(isTripRecordRequest("Help us write a lodging poll"), false);
  assert.equal(isTripRecordRequest("Change the lodging poll wording"), false);
  assert.equal(isTripRecordRequest("Update the trip budget to $3,000"), true);
  assert.equal(isTripRecordRequest("Add the location to my lodging"), true);
  const original = "Add the location and dates to my lodging";
  assert.equal(tripRecordRequestSource("Can you do the edits now? You just got an update", original), `${original}\nCan you do the edits now? You just got an update`);
  assert.equal(tripRecordRequestSource("Can you do the edits now?", undefined), null);
  assert.equal(tripRecordRequestSource("Can you edit the poll instead?", original), null);
  assert.equal(tripRecordRequestSource("Don't do the edits now", original), null);
  assert.equal(tripRecordRequestSource("What's the weather?", original), null);
});

test("saved-state questions use canonical local facts without a model call", () => {
  assert.match(savedTripFactsReply("What is our budget now?", context) ?? "", /\$2,000\.00 total/);
  assert.match(savedTripFactsReply("What's the saved lodging address?", context) ?? "", /Address to update/);
  assert.equal(savedTripFactsReply("What should our budget be?", context), null);
});

// Stage 8 (F2): the organizer stated the amount; the provider omitted the stay id. One saved stay is the stay meant, the amount the organizer typed is
// honoured (not only lodging-worded phrases), and anything that still cannot become a proposal gets honest code-authored text.
test("Update our stay: 'the total is now $2,100' with no stay id defaults to the single saved stay", () => {
  const suggestion: TripSuggestion = { ...empty, operations: ["stay"], stayTotalCents: 210_000 };
  const proposal = buildTripChangeProposal(suggestion, context, "Update our stay at Mountain rental: the total is now $2,100.");
  assert.ok(proposal, "a proposal is prepared");
  assert.equal(proposal.changes.stay?.id, stayId);
  assert.equal(proposal.changes.stay?.totalCents, 210_000);
  assert.equal(proposal.base.stay?.totalCents, 266_653);
  assert.deepEqual(proposal.operations, ["stay"]);
  // Not the organizer's number, an ambiguous message, or a rate: no proposal.
  assert.equal(buildTripChangeProposal({ ...suggestion, stayTotalCents: 250_000 }, context, "Update our stay: the total is now $2,100."), null, "the provider's amount must be the organizer's");
  assert.equal(buildTripChangeProposal(suggestion, context, "Update our stay: the total is now $2,100 and the deposit was $500."), null, "two amounts are ambiguous");
  assert.equal(buildTripChangeProposal(suggestion, context, "Update our stay: it is $2,100 per night."), null, "a rate is not a total");
  assert.equal(buildTripChangeProposal(suggestion, context, "Update our stay: we put down a $2,100 deposit."), null, "a deposit is not a total");
});

test("a dropped or incomplete trip suggestion is explained by code, never by prose that implies a proposal exists", () => {
  const two = { ...context, stays: [...context.stays, { ...context.stays[0], id: "33333333-3333-4333-8333-333333333333", name: "Second rental" }] };
  const asked: TripSuggestion = { ...empty, operations: ["stay"], stayTotalCents: 210_000 };
  const ambiguous = tripProposalGap(asked, two);
  assert.match(ambiguous, /nothing to review and nothing was saved/);
  assert.match(ambiguous, /Mountain rental, Second rental/);
  assert.match(tripProposalGap(asked, { ...context, stays: [] }), /No stay is saved yet/);
  const generic = tripProposalGap(null, context);
  assert.match(generic, /nothing to review and nothing was saved/);
  assert.doesNotMatch(generic, /I(?:’|')ve prepared|below/);
});
