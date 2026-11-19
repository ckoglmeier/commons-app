import { calculateBudget, type BudgetInputs } from "./marketing/budget/budget-calculations";

type CostedPlan = {
  mealType?: string | null;
  id: string;
  expectedCostCurrency?: string;
  expectedCostCents?: number;
  expectedCostBasis?: "total" | "per_person";
  expectedParticipantIds?: string[];
};

type RecordedExpense = {
  category?: string;
  currency?: string;
  amountCents: number;
  balanceMode?: "allocated" | "tracking_only" | "budget_only";
  itineraryItemId?: string;
  stayId?: string;
  travelPlanId?: string;
};

type CostedStay = {
  id: string;
  currency?: string;
  totalCents?: number;
  costSource?: "estimate" | "confirmation" | "expense";
};

type SharedTravelEstimate = {
  id: string;
  currency?: string;
  totalCents?: number;
  visibility?: "private" | "basic" | "all";
};

export function calculateExpectedPlanCosts(
  plans: CostedPlan[],
  expenses: RecordedExpense[],
  currency = "USD",
) {
  const actualByPlan = new Map<string, number>();
  expenses.filter((expense) => expense.balanceMode !== "budget_only" && (expense.currency ?? "USD") === currency).forEach((expense) => {
    if (!expense.itineraryItemId) return;
    actualByPlan.set(
      expense.itineraryItemId,
      (actualByPlan.get(expense.itineraryItemId) ?? 0) + expense.amountCents,
    );
  });

  return plans.flatMap((plan) => {
    if (currency !== (plan.expectedCostCurrency ?? "USD") || !plan.expectedCostCents) return [];
    const estimatedCents = plan.expectedCostBasis === "per_person"
      ? plan.expectedCostCents * (plan.expectedParticipantIds?.length ?? 0)
      : plan.expectedCostCents;
    const recordedCents = actualByPlan.get(plan.id) ?? 0;
    return [{
      planId: plan.id,
      estimatedCents,
      recordedCents,
      remainingExpectedCents: Math.max(estimatedCents - recordedCents, 0),
    }];
  });
}

export function calculateExpectedTripCost(
  plans: CostedPlan[],
  expenses: RecordedExpense[],
  stays: CostedStay[] = [],
  travelPlans: SharedTravelEstimate[] = [],
  currency = "USD",
  worksheet?: BudgetInputs | null,
) {
  const actualExpenses = expenses.filter((expense) => expense.balanceMode !== "budget_only" && (expense.currency ?? "USD") === currency);
  const budgetExpenses = expenses.filter((expense) => expense.balanceMode === "budget_only" && (expense.currency ?? "USD") === currency);
  const budgetPlanIds = new Set(budgetExpenses.flatMap((expense) => expense.itineraryItemId ? [expense.itineraryItemId] : []));
  const budgetStayIds = new Set(budgetExpenses.flatMap((expense) => expense.stayId ? [expense.stayId] : []));
  const budgetTravelIds = new Set(budgetExpenses.flatMap((expense) => expense.travelPlanId ? [expense.travelPlanId] : []));
  const recordedCents = actualExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const planCosts = calculateExpectedPlanCosts(plans.filter((plan) => !budgetPlanIds.has(plan.id)), actualExpenses, currency);
  const stayCosts = calculateExpectedStayCosts(stays.filter((stay) => !budgetStayIds.has(stay.id)), actualExpenses, currency);
  const sharedTravelCosts = calculateExpectedTravelCosts(travelPlans.filter((travel) => !budgetTravelIds.has(travel.id)), actualExpenses, currency);
  const budgetedCents = budgetExpenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const estimatedCents = planCosts.reduce((sum, plan) => sum + plan.estimatedCents, 0)
    + stayCosts.reduce((sum, stay) => sum + stay.estimatedCents, 0)
    + sharedTravelCosts.reduce((sum, travel) => sum + travel.estimatedCents, 0)
    + budgetedCents;
  const remainingExpectedCents = planCosts.reduce((sum, plan) => sum + plan.remainingExpectedCents, 0)
    + stayCosts.reduce((sum, stay) => sum + stay.remainingExpectedCents, 0)
    + sharedTravelCosts.reduce((sum, travel) => sum + travel.remainingExpectedCents, 0)
    + budgetedCents;

  const adjustment = worksheet ? calculateBudgetForecastAdjustment(plans, expenses, stays, travelPlans, currency, worksheet).additionalCents : 0;
  return {
    estimatedCents: estimatedCents + adjustment,
    recordedCents,
    remainingExpectedCents: remainingExpectedCents + adjustment,
    expectedTotalCents: recordedCents + remainingExpectedCents + adjustment,
  };
}

export function calculateExpectedTravelCosts(
  travelPlans: SharedTravelEstimate[],
  expenses: RecordedExpense[],
  currency = "USD",
) {
  return travelPlans.flatMap((travelPlan) => {
    if (travelPlan.visibility !== "all" || !travelPlan.totalCents || (travelPlan.currency ?? "USD") !== currency) return [];
    const recordedCents = expenses
      .filter((expense) => expense.balanceMode !== "budget_only" && (expense.currency ?? "USD") === currency)
      .filter((expense) => expense.travelPlanId === travelPlan.id)
      .reduce((sum, expense) => sum + expense.amountCents, 0);
    return [{ travelPlanId: travelPlan.id, estimatedCents: travelPlan.totalCents, recordedCents, remainingExpectedCents: Math.max(travelPlan.totalCents - recordedCents, 0) }];
  });
}

export function calculateExpectedStayCosts(
  stays: CostedStay[],
  expenses: RecordedExpense[],
  currency = "USD",
) {
  const actualByStay = new Map<string, number>();
  expenses.filter((expense) => expense.balanceMode !== "budget_only" && (expense.currency ?? "USD") === currency).forEach((expense) => {
    if (!expense.stayId) return;
    actualByStay.set(expense.stayId, (actualByStay.get(expense.stayId) ?? 0) + expense.amountCents);
  });

  return stays.flatMap((stay) => {
    if (!stay.totalCents || (stay.currency ?? "USD") !== currency) return [];
    const recordedCents = actualByStay.get(stay.id) ?? 0;
    return [{
      stayId: stay.id,
      estimatedCents: stay.totalCents,
      recordedCents,
      remainingExpectedCents: stay.costSource === "expense" ? 0 : Math.max(stay.totalCents - recordedCents, 0),
    }];
  });
}


type BudgetCategory = "lodging" | "meals" | "transport" | "activities" | "other";
export type BudgetForecastAdjustment = {
  additionalCents: number;
  categories: { key: string; label: string; estimateCents: number; coveredCents: number; remainingCents: number }[];
};
/** Saved worksheet categories cover existing plans and spending, never add to them twice.
 * The ledger uses hundredths for every currency; estimates round to that display precision only here.
 * Source worksheet values and native currency precision remain unchanged.
 */
export function calculateBudgetForecastAdjustment(
  plans: CostedPlan[], expenses: RecordedExpense[], stays: CostedStay[] = [],
  travelPlans: SharedTravelEstimate[] = [], currency = "USD", worksheet?: BudgetInputs | null,
): BudgetForecastAdjustment {
  if (!worksheet || worksheet.currency !== currency) return { additionalCents: 0, categories: [] };
  const result = calculateBudget(worksheet);
  if (!result.ready) return { additionalCents: 0, categories: [] };
  const cents = (minor: number) => Math.round(minor * 100 / (10 ** result.minorDigits));
  const planCategory = new Map(plans.map(plan => [plan.id, plan.mealType ? "meals" as const : "activities" as const]));
  const expenseCategory = (expense: RecordedExpense): BudgetCategory => {
    if (expense.stayId) return "lodging";
    if (expense.travelPlanId) return "transport";
    if (expense.itineraryItemId && planCategory.has(expense.itineraryItemId)) return planCategory.get(expense.itineraryItemId)!;
    if (expense.category === "Lodging") return "lodging";
    if (["Food & drink", "Groceries"].includes(expense.category ?? "")) return "meals";
    if (expense.category === "Transportation") return "transport";
    if (["Activity", "Golf"].includes(expense.category ?? "")) return "activities";
    return "other";
  };
  const amounts: Record<BudgetCategory, number> = { lodging: 0, meals: 0, transport: 0, activities: 0, other: 0 };
  const entered = new Set<BudgetCategory>();
  for (const line of result.lines) {
    if (line.amountMinor === null) continue;
    const key: BudgetCategory = line.key === "travel" ? "transport" : line.key;
    amounts[key] += cents(line.amountMinor); entered.add(key);
  }
  const labels: Record<BudgetCategory, string> = { lodging: "Lodging", meals: "Meals", transport: "Transport and getting there", activities: "Shared activities", other: "Other" };
  const categories: BudgetForecastAdjustment["categories"] = [...entered].map(key => {
    const covered = calculateExpectedTripCost(plans.filter(plan => planCategory.get(plan.id) === key), expenses.filter(expense => expenseCategory(expense) === key), key === "lodging" ? stays : [], key === "transport" ? travelPlans : [], currency);
    return { key, label: labels[key], estimateCents: amounts[key], coveredCents: covered.expectedTotalCents, remainingCents: Math.max(0, amounts[key] - covered.expectedTotalCents) };
  });
  if (result.bufferMinor > 0) categories.push({ key: "cushion", label: "Cushion", estimateCents: cents(result.bufferMinor), coveredCents: 0, remainingCents: cents(result.bufferMinor) });
  return { additionalCents: categories.reduce((sum, category) => sum + category.remainingCents, 0), categories };
}
