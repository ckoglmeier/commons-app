import assert from "node:assert/strict";
import test from "node:test";
import type { CommonsState } from "@commons/contracts";
import { activityExpenseConversion } from "./activity-expense";
import { calculateExpectedTripCost } from "./expected-trip-cost";
const plan: CommonsState["itinerary"][number] = { id: "balloons", title: "Balloon Fiesta Kids’ Day", startsAt: null, status: "planned", participantScope: "everyone", expectedCostCents: 5000, expectedCostCurrency: "EUR", provenanceLabel: "Added by organizer" };
const expense = (amountCents: number, extra = {}): CommonsState["expenses"][number] => ({ id: "expense", title: plan.title, amountCents, currency: "EUR", itineraryItemId: plan.id, paidByPersonId: "me", paidByName: "Me", occurredOn: "2026-10-09", category: "Activity", balanceMode: "tracking_only", splitMethod: "equal", status: "confirmed", receiptStatus: "not_attached", sourceLabel: "Saved", shares: [{ personId: "me", amountCents: 0 }], ...extra });
test("activity expense review keeps currency and uses the total per-person estimate", () => {
  assert.deepEqual(activityExpenseConversion(plan, []), { currency: "EUR", amountCents: 5000, expenseId: undefined });
  assert.equal(activityExpenseConversion({ ...plan, expectedCostBasis: "per_person", expectedParticipantIds: ["me", "child"] }, [])?.amountCents, 10000);
  assert.equal(activityExpenseConversion({ ...plan, expectedCostBasis: "per_person", expectedParticipantIds: [] }, []), undefined);
});
test("review uses only the remaining same-currency estimate and does not record anything", () => {
  const expenses = [expense(2000), expense(8000, { id: "foreign", currency: "USD" })];
  const before = structuredClone({ plan, expenses });
  assert.equal(activityExpenseConversion(plan, expenses)?.amountCents, 3000);
  assert.deepEqual({ plan, expenses }, before);
  assert.equal(activityExpenseConversion(plan, [expense(5000)]), undefined);
  assert.equal(activityExpenseConversion(plan, [expense(6000)]), undefined);
  const cost = calculateExpectedTripCost([plan], [expense(5000)], [], [], "EUR");
  assert.equal(cost.recordedCents, 5000);
  assert.equal(cost.remainingExpectedCents, 0);
  assert.equal(cost.expectedTotalCents, 5000);
});
test("an existing linked budget expense is converted in place", () => {
  assert.deepEqual(activityExpenseConversion(plan, [expense(7500, { balanceMode: "budget_only" })]), { currency: "EUR", amountCents: 7500, expenseId: "expense" });
});
