import assert from "node:assert/strict";
import test from "node:test";
import { calculateExpectedPlanCosts, calculateExpectedStayCosts, calculateExpectedTripCost } from "./expected-trip-cost";

test("does not silently treat foreign booking totals as USD", () => {
  const result = calculateExpectedTripCost([], [{ amountCents: 25000, travelPlanId: "flight" }],
    [{ id: "hotel", totalCents: 100000, currency: "EUR", costSource: "confirmation" }],
    [{ id: "flight", totalCents: 20000, currency: "GBP", visibility: "all" }]);
  assert.equal(result.estimatedCents, 0);
  assert.equal(result.recordedCents, 25000);
  assert.equal(result.expectedTotalCents, 25000);
});

test("uses recorded expenses against their plan estimate without double counting", () => {
  assert.deepEqual(
    calculateExpectedTripCost(
      [{ id: "stay", expectedCostCents: 100_000 }, { id: "boat", expectedCostCents: 20_000 }],
      [{ amountCents: 25_000, itineraryItemId: "stay" }, { amountCents: 5_000 }],
    ),
    {
      estimatedCents: 120_000,
      recordedCents: 30_000,
      remainingExpectedCents: 95_000,
      expectedTotalCents: 125_000,
    },
  );
});

test("raises the expected total when actual spending exceeds a plan estimate", () => {
  const result = calculateExpectedTripCost(
    [{ id: "dinner", expectedCostCents: 10_000 }],
    [{ amountCents: 12_500, itineraryItemId: "dinner" }],
  );
  assert.equal(result.remainingExpectedCents, 0);
  assert.equal(result.expectedTotalCents, 12_500);
});

test("multiplies per-person estimates by expected attendance", () => {
  const result = calculateExpectedTripCost(
    [{ id: "concert", expectedCostCents: 7_500, expectedCostBasis: "per_person", expectedParticipantIds: ["a", "b", "c", "d"] }],
    [],
  );
  assert.equal(result.estimatedCents, 30_000);
  assert.equal(result.expectedTotalCents, 30_000);
});

test("updates a per-person forecast when expected attendance changes", () => {
  const result = calculateExpectedTripCost(
    [{ id: "concert", expectedCostCents: 7_500, expectedCostBasis: "per_person", expectedParticipantIds: ["a", "b"] }],
    [{ amountCents: 5_000, itineraryItemId: "concert" }],
  );
  assert.equal(result.estimatedCents, 15_000);
  assert.equal(result.remainingExpectedCents, 10_000);
  assert.equal(result.expectedTotalCents, 15_000);
});

test("exposes each planned estimate and its recorded coverage", () => {
  assert.deepEqual(
    calculateExpectedPlanCosts(
      [
        { id: "massage", expectedCostCents: 27_500 },
        { id: "fishing", expectedCostCents: 8_000, expectedCostBasis: "per_person", expectedParticipantIds: ["sam", "adult"] },
      ],
      [{ amountCents: 10_000, itineraryItemId: "massage" }],
    ),
    [
      { planId: "massage", estimatedCents: 27_500, recordedCents: 10_000, remainingExpectedCents: 17_500 },
      { planId: "fishing", estimatedCents: 16_000, recordedCents: 0, remainingExpectedCents: 16_000 },
    ],
  );
});

test("shows a fully covered plan with no remaining estimate", () => {
  assert.deepEqual(
    calculateExpectedPlanCosts(
      [{ id: "stay", expectedCostCents: 200_000 }],
      [{ amountCents: 244_956, itineraryItemId: "stay" }],
    ),
    [{ planId: "stay", estimatedCents: 200_000, recordedCents: 244_956, remainingExpectedCents: 0 }],
  );
});

test("includes Stay costs in the forecast without double counting a linked expense", () => {
  assert.deepEqual(
    calculateExpectedTripCost(
      [],
      [{ amountCents: 100_000, stayId: "house" }],
      [{ id: "house", totalCents: 240_000, costSource: "confirmation" }],
    ),
    {
      estimatedCents: 240_000,
      recordedCents: 100_000,
      remainingExpectedCents: 140_000,
      expectedTotalCents: 240_000,
    },
  );
});

test("treats a migrated expense-backed Stay as already recorded", () => {
  assert.deepEqual(
    calculateExpectedStayCosts(
      [{ id: "house", totalCents: 240_000, costSource: "expense" }],
      [{ amountCents: 240_000, stayId: "house" }],
    ),
    [{ stayId: "house", estimatedCents: 240_000, recordedCents: 240_000, remainingExpectedCents: 0 }],
  );
});

test("includes only explicitly shared travel costs and replaces them with a linked expense", () => {
  const result = calculateExpectedTripCost(
    [],
    [{ amountCents: 40_000, travelPlanId: "rental-shared" }],
    [],
    [
      { id: "rental-shared", totalCents: 65_000, visibility: "all" },
      { id: "flight-private", totalCents: 90_000, visibility: "private" },
      { id: "flight-basic", totalCents: 45_000, visibility: "basic" },
    ],
  );
  assert.equal(result.estimatedCents, 65_000);
  assert.equal(result.recordedCents, 40_000);
  assert.equal(result.remainingExpectedCents, 25_000);
  assert.equal(result.expectedTotalCents, 65_000);
});

test("keeps budget-only records in planned costs and out of recorded spending", () => {
  assert.deepEqual(
    calculateExpectedTripCost(
      [{ id: "dog-care", expectedCostCents: 70_000 }],
      [{ amountCents: 80_000, itineraryItemId: "dog-care", balanceMode: "budget_only" }],
    ),
    { estimatedCents: 80_000, recordedCents: 0, remainingExpectedCents: 80_000, expectedTotalCents: 80_000 },
  );
});

test("counts tracking-only family spending as actual without creating forecast duplication", () => {
  const result = calculateExpectedTripCost(
    [],
    [{ amountCents: 85_000, travelPlanId: "flights", balanceMode: "tracking_only" }],
    [],
    [{ id: "flights", totalCents: 85_000, visibility: "all" }],
  );
  assert.equal(result.recordedCents, 85_000);
  assert.equal(result.remainingExpectedCents, 0);
  assert.equal(result.expectedTotalCents, 85_000);
});

import { emptyBudgetInputs } from "./budget/budget-calculations";
import { calculateBudgetForecastAdjustment } from "./expected-trip-cost";
test("saved worksheet supplies remaining category estimates without duplicating plans or spending", () => {
  const worksheet = { ...emptyBudgetInputs(), travelers: "4", nights: "2", lodgingPerNight: "500", mealsPerPersonPerDay: "25", activitiesTotal: "200", transportTotal: "80" };
  const stays = [{ id: "stay", totalCents: 80_000 }];
  const plans = [{ id: "dinner", mealType: "restaurant", expectedCostCents: 10_000 }, { id: "tour", expectedCostCents: 5_000 }];
  const expenses = [{ amountCents: 20_000, stayId: "stay" }, { amountCents: 2_000, category: "Transportation" }];
  const adjustment = calculateBudgetForecastAdjustment(plans, expenses, stays, [], "USD", worksheet);
  assert.equal(adjustment.additionalCents, 61_000);
  const cost = calculateExpectedTripCost(plans, expenses, stays, [], "USD", worksheet);
  assert.equal(cost.expectedTotalCents, 158_000);
  assert.equal(cost.recordedCents, 22_000);
  assert.equal(cost.remainingExpectedCents, 136_000);
  assert.equal(calculateExpectedTripCost(plans, expenses, stays, [], "EUR", worksheet).expectedTotalCents, 0);
});

test("actual category overruns stay visible and incomplete worksheet never replaces existing forecasts", () => {
  const worksheet = { ...emptyBudgetInputs(), travelers: "2", nights: "1", lodgingPerNight: "100" };
  const expenses = [{ amountCents: 15_000, category: "Lodging" }, { amountCents: 3_000, category: "Other" }];
  assert.equal(calculateExpectedTripCost([], expenses, [], [], "USD", worksheet).expectedTotalCents, 18_000);
  assert.equal(calculateExpectedTripCost([], expenses, [], [], "USD", { ...worksheet, nights: "TBD" }).expectedTotalCents, 18_000);
});

test("worksheet currency minor units convert to ledger hundredths and optional extras stay separate", () => {
  const worksheet = { ...emptyBudgetInputs("JPY"), travelers: "2", nights: "1", lodgingPerNight: "10000", optional: [{ id: "extra-1", label: "Spa", perPerson: "5000", participants: "1" }] };
  assert.equal(calculateExpectedTripCost([], [], [], [], "JPY", worksheet).expectedTotalCents, 1_000_000);
});

test("linked category costs cover the worksheet once regardless of an expense's generic category", () => {
  const worksheet = { ...emptyBudgetInputs(), travelers: "2", nights: "1", lodgingPerNight: "1000", mealsPerPersonPerDay: "25", activitiesTotal: "100", transportTotal: "100", travelPerPerson: "100" };
  const plans = [{ id: "meal", mealType: "restaurant", expectedCostCents: 10_000 }, { id: "tour", expectedCostCents: 10_000 }];
  const stays = [{ id: "stay", totalCents: 100_000 }];
  const travel = [{ id: "van", totalCents: 30_000, visibility: "all" as const }];
  const expenses = [{ amountCents: 60_000, stayId: "stay", category: "Other" }, { amountCents: 3_000, itineraryItemId: "meal", category: "Other" }, { amountCents: 2_000, itineraryItemId: "tour", category: "Food & drink" }, { amountCents: 15_000, travelPlanId: "van", category: "Other" }];
  assert.equal(calculateBudgetForecastAdjustment(plans, expenses, stays, travel, "USD", worksheet).additionalCents, 0);
  assert.equal(calculateExpectedTripCost(plans, expenses, stays, travel, "USD", worksheet).expectedTotalCents, 150_000);
});

test("three-decimal worksheet stays exact at source and rounds only its forecast display to ledger hundredths", () => {
  const worksheet = { ...emptyBudgetInputs("KWD"), travelers: "1", nights: "1", lodgingPerNight: "12.345" };
  assert.equal(calculateExpectedTripCost([], [], [], [], "KWD", worksheet).expectedTotalCents, 1235);
  assert.equal(worksheet.lodgingPerNight, "12.345");
});
