import assert from "node:assert/strict";
import test from "node:test";
import type { Expense } from "@commons/contracts";
import { pilotSnapshot } from "./pilot-fixture";
import { buildMoneySummary, moneySummaryAmount, moneySummaryCsv, moneySummaryShareUrl, moneySummaryTimestamp, moneySummaryViewerBalances } from "./money-summary";

const when = "2026-10-04T01:12:00.000Z";
const [first, second] = pilotSnapshot.participants;
function fixture() {
  const snapshot = structuredClone(pilotSnapshot);
  const expense: Expense = {
    id: "dinner", title: "Dinner", amountCents: 10001, currency: "USD", paidByPersonId: first.id, paidByName: first.displayName,
    occurredOn: "2026-10-03", category: "food", status: "confirmed", splitMethod: "exact", receiptStatus: "attached",
    sourceLabel: "secret-source", confirmationCode: "secret-code", receiptUrl: "https://private.example/secret-receipt", receiptFileName: "secret-file.pdf", note: "secret-note",
    shares: [{ personId: first.id, amountCents: 5001 }, { personId: second.id, amountCents: 5000 }],
  };
  snapshot.state.expenses = [expense,
    { ...expense, id: "estimate", title: "Budget estimate", balanceMode: "budget_only", amountCents: 999999 },
    { ...expense, id: "tracking", title: "Tracking expense", balanceMode: "tracking_only", amountCents: 2000 },
    { ...expense, id: "euro", currency: "EUR", amountCents: 12345, status: "disputed", shares: [{ personId: second.id, amountCents: 12345 }] },
  ];
  snapshot.state.reimbursements = [{ id: "repayment", fromPersonId: second.id, fromPersonName: second.displayName, toPersonId: first.id, toPersonName: first.displayName, amountCents: 1234, currency: "USD", occurredOn: "2026-10-03", sourceLabel: "secret-reimbursement-source" }];
  return snapshot;
}

test("ledger separates currencies, estimates and unallocated spending; reimbursements preserve the odd cent", () => {
  const snapshot = fixture(), before = structuredClone(snapshot);
  const report = buildMoneySummary(snapshot, when);
  assert.deepEqual(snapshot, before);
  assert.deepEqual(report.currencies.map(group => group.currency), ["EUR", "USD"]);
  const usd = report.currencies[1];
  assert.equal(usd.recordedCents, 12001);
  assert.equal(usd.expenses.length, 2);
  assert.deepEqual(usd.expenses.find(expense => expense.id === "tracking")?.shares, []);
  assert.deepEqual(usd.balances.find(balance => balance.personId === first.id), { personId: first.id, name: first.displayName, paidCents: 10001, shareCents: 5001, reimbursedCents: 0, receivedCents: 1234, netCents: 3766 });
  assert.equal(usd.balances.find(balance => balance.personId === second.id)?.netCents, -3766);
  assert.equal(report.currencies[0].balances.find(balance => balance.personId === first.id)?.netCents, 12345);
  for (const group of report.currencies) assert.equal(group.balances.reduce((sum, balance) => sum + balance.netCents, 0), 0);
  assert.equal(report.currencies[0].expenses[0].status, "disputed");
  assert.match(moneySummaryAmount(10001, "JPY"), /100\.01/);
});

test("projection and CSV exclude private source fields and all unrelated trip state", () => {
  const snapshot = fixture();
  snapshot.state.messages[0].body = "secret-conversation";
  snapshot.participants[0].sharedPreferences = { dietaryPreferences: "secret-preference" };
  const report = buildMoneySummary(snapshot, when);
  assert.doesNotMatch(JSON.stringify(report) + moneySummaryCsv(report), /secret-|receiptUrl|confirmationCode|sharedPreferences|Budget estimate/);
});

test("family reports omit allocations, payments and balances before serialization", () => {
  const snapshot = fixture();
  snapshot.commons.balancesDisabled = true;
  const report = buildMoneySummary(snapshot, when);
  for (const group of report.currencies) {
    assert.deepEqual(group.balances, []);
    assert.deepEqual(group.payments, []);
    for (const expense of group.expenses) { assert.deepEqual(expense.shares, []); assert.equal(expense.allocated, false); }
  }
  assert.doesNotMatch(moneySummaryCsv(report), /"Allocation"|"Payment"|"Balance"|repayment/);
  assert.equal(report.currencies[1].recordedCents, 12001);
});

test("CSV quotes embedded newlines and neutralizes formulas without corrupting computed negative amounts", () => {
  const snapshot = fixture();
  snapshot.commons.name = '=HYPERLINK("https://example.test")';
  snapshot.state.expenses[0].title = 'Dinner, "outside"\nfor everyone';
  snapshot.participants[0].displayName = " \t+SUM(1,2)";
  const csv = moneySummaryCsv(buildMoneySummary(snapshot, when));
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example.test""\)"/);
  assert.ok(csv.includes('"Dinner, ""outside""\nfor everyone"'));
  assert.ok(csv.includes('"\' \t+SUM(1,2)"'));
  assert.ok(csv.includes(",-37.66,"));
  assert.ok(csv.endsWith("\r\n"));
});

test("open, closed, empty and payment-only ledgers remain truthful", () => {
  const snapshot = fixture();
  assert.equal(buildMoneySummary(snapshot, when).closed, false);
  snapshot.participants.forEach(person => { person.expensesCompleteAt = when; });
  assert.equal(buildMoneySummary(snapshot, when).closed, true);
  snapshot.state.expenses = [];
  assert.equal(buildMoneySummary(snapshot, when).currencies[0].recordedCents, 0);
  snapshot.state.reimbursements = [];
  assert.deepEqual(buildMoneySummary(snapshot, when).currencies, []);
  snapshot.participants = [];
  assert.equal(buildMoneySummary(snapshot, when).closed, false);
  snapshot.commons.expensesClosedAt = when;
  assert.equal(buildMoneySummary(snapshot, when).closed, true);
});

test("generated timestamps use local 12-hour time", () => {
  const snapshot = fixture();
  snapshot.commons.timezone = "America/Denver";
  assert.match(moneySummaryTimestamp(buildMoneySummary(snapshot, when)), /7:12 PM/);
});

test("the same shared URL presents the authenticated person's balance without changing the group export", () => {
  const snapshot = fixture();
  const organizer = buildMoneySummary(snapshot, when);
  assert.deepEqual(moneySummaryViewerBalances(organizer), [{ currency: "EUR", netCents: 12345 }, { currency: "USD", netCents: 3766 }]);
  snapshot.currentActor = { ...snapshot.currentActor, id: second.id, displayName: second.displayName, role: "member" };
  const traveler = buildMoneySummary(snapshot, when);
  assert.deepEqual(moneySummaryViewerBalances(traveler), [{ currency: "EUR", netCents: -12345 }, { currency: "USD", netCents: -3766 }]);
  const link = moneySummaryShareUrl("https://www.commons.travel", traveler.tripId);
  assert.equal(link, moneySummaryShareUrl("https://www.commons.travel", organizer.tripId));
  assert.equal(new URL(link).search, "");
  assert.equal(new URL(link).hash, "");
  assert.doesNotMatch(link, new RegExp(`${first.id}|${second.id}`));
  assert.equal(moneySummaryCsv(organizer), moneySummaryCsv(traveler));
});

test("personal balance is omitted for public samples and family trips, and doesn't imply settlement when absent", () => {
  const snapshot = fixture();
  const sample = buildMoneySummary(snapshot, when, true);
  assert.equal(sample.viewer, null);
  assert.deepEqual(moneySummaryViewerBalances(sample), []);
  snapshot.currentActor.id = "not-allocated";
  assert.deepEqual(moneySummaryViewerBalances(buildMoneySummary(snapshot, when)), []);
  snapshot.commons.balancesDisabled = true;
  const family = buildMoneySummary(snapshot, when);
  assert.equal(family.viewer, null);
  assert.deepEqual(moneySummaryViewerBalances(family), []);
});
