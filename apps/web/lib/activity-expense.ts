import type { CommonsState } from "@commons/contracts";
import { calculateExpectedPlanCosts } from "./expected-trip-cost";

/** A review handoff only. The existing expense command records the cost after confirmation. */
export function activityExpenseConversion(item: CommonsState["itinerary"][number], expenses: CommonsState["expenses"]) {
  const currency = item.expectedCostCurrency ?? "USD";
  const budget = expenses.find(expense => expense.itineraryItemId === item.id && expense.currency === currency && expense.balanceMode === "budget_only");
  if (budget) return { currency, amountCents: budget.amountCents, expenseId: budget.id };
  const cost = calculateExpectedPlanCosts([item], expenses, currency)[0];
  return cost?.remainingExpectedCents ? { currency, amountCents: cost.remainingExpectedCents, expenseId: undefined } : undefined;
}
