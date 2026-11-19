import assert from "node:assert/strict";
import test from "node:test";
import {
  AddCommonsPersonRequestSchema,
  AddExpenseCommandSchema,
  AddStayCommandSchema,
  UpdateTravelPlanSharingCommandSchema,
  UpsertTravelPlanCommandSchema,
  UpsertFlightBookingCommandSchema,
  UpdateTargetBudgetCommandSchema,
} from "@commons/contracts";

test("accepts one arrival and one departure in an atomic flight booking", () => {
  const booking = UpsertFlightBookingCommandSchema.parse({
    commandId: "a96239f4-20c5-4380-80f0-05df5a4c402d",
    legs: [
      { kind: "arrival", date: "2027-03-20", route: "DEN → SNA", time: "10:25" },
      { kind: "departure", date: "2027-03-26", route: "SNA → DEN", time: "15:40" },
    ],
    includedPersonIds: ["3f58cadc-6b77-49a4-8dcb-05ca0fa530bc"],
    note: "",
    totalCents: 85_000,
    currency: "USD",
  });
  assert.equal(booking.legs.length, 2);
  assert.throws(() => UpsertFlightBookingCommandSchema.parse({
    ...booking,
    legs: [booking.legs[0], booking.legs[0]],
  }), /Include no more than one flight there and one flight home/);
});

test("accepts an accountless managed traveler", () => {
  const traveler = AddCommonsPersonRequestSchema.parse({
    displayName: "Managed Traveler",
    email: null,
    accessMode: "managed",
  });
  assert.equal(traveler.accessMode, "managed");
  assert.equal(traveler.email, null);
});

test("accepts a confirmed budget-only lodging expense without allocating balances", () => {
  const expense = AddExpenseCommandSchema.parse({
    commandId: "lodging-1",
    title: "Test lodging",
    amountCents: 120_000,
    paidByPersonId: "organizer",
    occurredOn: "2026-09-01",
    category: "Lodging",
    balanceMode: "budget_only",
    confirmationCode: "CONFIRM-123",
    splitMethod: "exact",
    shares: [{ personId: "organizer", amountCents: 0 }],
  });
  assert.equal(expense.balanceMode, "budget_only");
  assert.equal(expense.confirmationCode, "CONFIRM-123");
});

test("accepts family-trip spending without allocating balances", () => {
  const expense = AddExpenseCommandSchema.parse({
    commandId: "family-flights",
    title: "Flights",
    amountCents: 85_000,
    paidByPersonId: "organizer",
    occurredOn: "2027-03-20",
    category: "Transportation",
    balanceMode: "tracking_only",
    splitMethod: "exact",
    shares: [{ personId: "organizer", amountCents: 0 }],
  });
  assert.equal(expense.balanceMode, "tracking_only");
});

test("accepts a linked stay option with included travelers", () => {
  const travelerId = "3f58cadc-6b77-49a4-8dcb-05ca0fa530bc";
  const stay = AddStayCommandSchema.parse({
    commandId: "a96239f4-20c5-4380-80f0-05df5a4c402d",
    name: "Inn near the Plaza",
    address: "Santa Fe Plaza, Santa Fe, NM",
    startsOn: "2027-10-08",
    endsOn: "2027-10-13",
    status: "considering",
    includedPersonIds: [travelerId],
    bookingUrl: "https://example.com/inn-plaza",
    totalCents: 245_000,
    currency: "USD",
    costSource: "estimate",
    includesTaxesAndFees: false,
  });
  assert.equal(stay.bookingUrl, "https://example.com/inn-plaza");
  assert.deepEqual(stay.includedPersonIds, [travelerId]);
  assert.equal(stay.totalCents, 245_000);
  assert.equal(stay.costSource, "estimate");
});

test("requires provenance for a structured stay cost", () => {
  assert.throws(() => AddStayCommandSchema.parse({
    commandId: "a96239f4-20c5-4380-80f0-05df5a4c402d",
    name: "Inn near the Plaza",
    address: "Santa Fe Plaza, Santa Fe, NM",
    startsOn: "2027-10-08",
    endsOn: "2027-10-13",
    status: "planned",
    includedPersonIds: ["3f58cadc-6b77-49a4-8dcb-05ca0fa530bc"],
    totalCents: 245_000,
    currency: "USD",
  }));
});

test("rejects an invalid or duplicate stay roster", () => {
  const travelerId = "3f58cadc-6b77-49a4-8dcb-05ca0fa530bc";
  assert.throws(() => AddStayCommandSchema.parse({
    commandId: "a96239f4-20c5-4380-80f0-05df5a4c402d",
    name: "Inn near the Plaza",
    address: "Santa Fe Plaza, Santa Fe, NM",
    startsOn: "2027-10-13",
    endsOn: "2027-10-08",
    status: "considering",
    includedPersonIds: [travelerId, travelerId],
    bookingUrl: "not-a-link",
  }));
});

test("travel plans save privately and sharing requires an explicit scope", () => {
  const plan = UpsertTravelPlanCommandSchema.parse({
    commandId: "travel-1",
    travelPlanId: "3f58cadc-6b77-49a4-8dcb-05ca0fa530bc",
    kind: "car_rental",
    date: "2026-10-08",
    route: "City A → City B",
    time: "16:00",
    note: "",
    companionPersonId: null,
    includedPersonIds: ["organizer", "sam", "soren"],
    driverPersonId: "organizer",
    provider: "National",
    vehicle: "Standard SUV",
    returnDate: "2026-10-12",
    returnTime: "09:00",
    status: "confirmed",
    confirmationCode: "RENTAL-123",
    totalCents: 92_450,
    currency: "USD",
  });
  assert.equal(plan.totalCents, 92_450);
  assert.equal(plan.kind, "car_rental");
  assert.equal(plan.provider, "National");
  assert.deepEqual(plan.includedPersonIds, ["organizer", "sam", "soren"]);
  assert.equal("visibility" in plan, false);
  const sharing = UpdateTravelPlanSharingCommandSchema.parse({
    commandId: "travel-share-1",
    travelPlanId: "3f58cadc-6b77-49a4-8dcb-05ca0fa530bc",
    visibility: "all",
  });
  assert.equal(sharing.visibility, "all");
});

test("rental times are optional without making flight times optional", () => {
  const rental = UpsertTravelPlanCommandSchema.parse({
    commandId: "rental-without-times",
    kind: "car_rental",
    date: "2027-03-20",
    route: "SNA Airport",
    time: null,
    note: "",
    companionPersonId: null,
    includedPersonIds: [],
    returnDate: "2027-03-29",
    returnTime: null,
  });
  assert.equal(rental.time, null);
  assert.equal(rental.returnTime, null);

  assert.throws(() => UpsertTravelPlanCommandSchema.parse({
    commandId: "arrival-without-time",
    kind: "arrival",
    date: "2027-03-20",
    route: "DEN → SNA",
    time: null,
    note: "",
    companionPersonId: null,
    includedPersonIds: [],
  }), /Add a time for an arrival or departure plan/);
});

test("accepts an organizer target trip budget", () => {
  const command = UpdateTargetBudgetCommandSchema.parse({
    commandId: "budget-1",
    amountCents: 500_000,
  });
  assert.equal(command.amountCents, 500_000);
});
