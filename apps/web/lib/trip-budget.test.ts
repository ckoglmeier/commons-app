import test from "node:test";
import assert from "node:assert/strict";
import { prefillTripBudget, tripBudgetLodgingReference } from "./trip-budget/prefill";

test("known dates and headcount seed a budget without inventing costs", () => {
  const value = prefillTripBudget({ startsOn: "2027-03-12", endsOn: "2027-03-15", travelerCount: 8, currency: "EUR" });
  assert.equal(value.nights, "3"); assert.equal(value.travelers, "8"); assert.equal(value.currency, "EUR"); assert.equal(value.lodgingPerNight, "");
  assert.equal(prefillTripBudget({ startsOn: "2027-03-15", endsOn: "2027-03-12", travelerCount: 0 }).nights, "");
  assert.equal(prefillTripBudget({}).travelers, "");
});

import { TripBudgetInputsSchema } from "@commons/contracts";
test("budget storage keeps incomplete values but bounds unknown fields and duplicate extras", () => {
  const value = { ...prefillTripBudget({}), nights: "not sure", optional: [{ id: "extra-1", label: "Museum?", perPerson: ".", participants: "" }] };
  assert.deepEqual(TripBudgetInputsSchema.parse(value), value);
  assert.equal(TripBudgetInputsSchema.safeParse({ ...value, optional: [value.optional[0], value.optional[0]] }).success, false);
  assert.equal(TripBudgetInputsSchema.safeParse({ ...value, extraPrivateField: "unexpected" }).success, false);
  assert.equal(TripBudgetInputsSchema.safeParse({ ...value, nights: "0".repeat(65) }).success, false);
});

test("known destinations use the existing lodging reference without matching vague or multi-city prose", () => {
  const rate = tripBudgetLodgingReference("Savannah, Georgia");
  assert.ok(rate);
  assert.equal(prefillTripBudget({ destinationName: "Savannah, Georgia" }).lodgingPerNight, String(rate.nightlyUsd));
  assert.equal(tripBudgetLodgingReference("Savannah or Charleston"), undefined);
  assert.equal(tripBudgetLodgingReference("West Savannah"), undefined);
  assert.equal(prefillTripBudget({ destinationName: "Unlisted place" }).lodgingPerNight, "");
  assert.equal(tripBudgetLodgingReference("napa-valley")?.name, "Napa Valley");
  assert.notEqual(prefillTripBudget({ destinationName: "Savannah", currency: "EUR" }).lodgingPerNight, String(rate.nightlyUsd));
});
