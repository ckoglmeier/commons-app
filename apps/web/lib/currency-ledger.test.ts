import assert from "node:assert/strict";
import test from "node:test";
import { pilotSnapshot } from "./pilot-fixture";
import { currencyLedger } from "./currency-ledger";
import { buildMoneySummary } from "./money-summary";
import { calculateExpectedTripCost } from "./expected-trip-cost";

test("Money and the shared ledger agree per currency, including legacy allocations and payment-only balances", () => {
  const snapshot = structuredClone(pilotSnapshot), [a, b] = snapshot.participants;
  const base = { ...snapshot.state.expenses[0], paidByPersonId: a.id, amountCents: 10001, currency: "USD", shares: [{ personId: a.id, amountCents: 5001 }, { personId: b.id, amountCents: 5000 }] };
  snapshot.state.expenses = [{ ...base, id: "legacy", balanceMode: undefined }, { ...base, id: "euro", currency: "EUR", status: "disputed" }, { ...base, id: "tracked", balanceMode: "tracking_only" }, { ...base, id: "budget", balanceMode: "budget_only" }];
  snapshot.state.reimbursements = ["USD", "EUR", "GBP"].map(currency => ({ id: currency, fromPersonId: b.id, fromPersonName: b.displayName, toPersonId: a.id, toPersonName: a.displayName, amountCents: 1234, currency, occurredOn: "2027-02-12", sourceLabel: "Synthetic" }));
  const report = buildMoneySummary(snapshot), ids = snapshot.participants.map(person => person.id);
  for (const currency of ["USD", "EUR", "GBP"]) {
    const ledger = currencyLedger(snapshot.state, currency, ids);
    const group = report.currencies.find(row => row.currency === currency)!;
    assert.equal(ledger.actualExpenses.reduce((sum, row) => sum + row.amountCents, 0), group.recordedCents);
    assert.deepEqual(ledger.balances.filter(row => row.netCents).map(row => [row.personId, row.netCents]).sort(), group.balances.filter(row => row.netCents).map(row => [row.personId, row.netCents]).sort());
    assert.equal(ledger.balances.reduce((sum, row) => sum + row.netCents, 0), 0);
    assert.equal(ledger.transfers[0].amountCents, currency === "GBP" ? 1234 : 3766);
  }
  const family = currencyLedger(snapshot.state, "USD", ids, true);
  assert.equal(family.actualExpenses.length, 2);
  assert.deepEqual([family.balances, family.transfers, family.reimbursements], [[], [], []]);
});

test("forecasts never let another currency cover an estimate or suppress a planned item", () => {
  const plans = [{ id: "walk", expectedCostCents: 10000 }];
  const stays = [{ id: "hotel", totalCents: 20000, currency: "EUR" }];
  const travel = [{ id: "van", totalCents: 5000, currency: "EUR", visibility: "all" as const }];
  const expenses = [
    { amountCents: 5000, currency: "EUR", itineraryItemId: "walk" },
    { amountCents: 7000, currency: "USD", stayId: "hotel" },
    { amountCents: 3000, currency: "EUR", stayId: "hotel" },
    { amountCents: 2000, currency: "EUR", itineraryItemId: "walk", balanceMode: "budget_only" as const },
  ];
  const usd = calculateExpectedTripCost(plans, expenses, stays, travel);
  assert.deepEqual(usd, { estimatedCents: 10000, recordedCents: 7000, remainingExpectedCents: 10000, expectedTotalCents: 17000 });
  const eur = calculateExpectedTripCost(plans, expenses, stays, travel, "EUR");
  assert.deepEqual(eur, { estimatedCents: 27000, recordedCents: 8000, remainingExpectedCents: 24000, expectedTotalCents: 32000 });
});
