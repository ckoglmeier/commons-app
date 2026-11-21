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
  // The reference is in US dollars and nothing converts it, so another trip currency starts with lodging blank.
  assert.equal(prefillTripBudget({ destinationName: "Savannah", currency: "EUR" }).lodgingPerNight, "");
  assert.equal(prefillTripBudget({ destinationName: "Savannah", currency: "EUR" }).currency, "EUR");
});

import { readFileSync } from "node:fs";
import { emptyBudgetInputs, startingBudgetInputs, withTripCurrency } from "./budget/budget-calculations";
test("the worksheet works in the trip's currency, with no selector, rates or conversion", () => {
  assert.equal(startingBudgetInputs("JPY", 180).lodgingPerNight, "");
  assert.equal(startingBudgetInputs("USD", 180).lodgingPerNight, "180");
  const worksheet = readFileSync(new URL("./budget/budget-worksheet.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(worksheet, /<select|aria-label="Currency"|exchange|convert|SUPPORTED_CURRENCIES/i);
  const calculations = readFileSync(new URL("./budget/budget-calculations.ts", import.meta.url), "utf8");
  assert.doesNotMatch(calculations, /exchange-rates|convertBudgetCurrency|BUDGET_EXCHANGE_RATES/);
  const panel = readFileSync(new URL("../components/trip-budget-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /withTripCurrency\(view\.inputs, initial\.currency\)/);
});

test("a worksheet saved in another currency still reads, and is shown in the trip's currency", () => {
  const stored = { ...emptyBudgetInputs("EUR"), travelers: "4", nights: "2", lodgingPerNight: "300" };
  const parsed = TripBudgetInputsSchema.parse(stored);
  const shown = withTripCurrency(parsed, "USD");
  assert.equal(shown.currency, "USD");
  assert.equal(shown.lodgingPerNight, "300", "amounts are not converted");
  assert.equal(withTripCurrency(shown, "USD"), shown, "already in the trip's currency: unchanged");
  assert.equal(TripBudgetInputsSchema.safeParse(shown).success, true, "it saves back in the same stored shape");
});
