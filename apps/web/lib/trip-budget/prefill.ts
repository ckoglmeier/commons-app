import { CITY_LODGING_BASE_RATES, type CityLodgingBaseRate } from "@/lib/marketing/budget/city-lodging-rates";
import { BUDGET_LIMITS, startingBudgetInputs, type BudgetInputs } from "@/lib/marketing/budget/budget-calculations";

/** Match a supplied city or city, region; never infer a destination from prose or a partial word. */
export function tripBudgetLodgingReference(destinationName?: string): CityLodgingBaseRate | undefined {
  if (!destinationName) return undefined;
  const normalized = (value: string) => value.trim().toLocaleLowerCase("en-US").replace(/[’']/g, "").replace(/[-_]/g, " ").replace(/\s+/g, " ");
  const candidates = [normalized(destinationName), normalized(destinationName.split(",")[0])];
  return CITY_LODGING_BASE_RATES.find(rate => candidates.includes(normalized(rate.name)) || candidates.includes(normalized(rate.slug)));
}

/** Saved values always win. Known dates/counts only seed a new worksheet. */
export function prefillTripBudget(input: { destinationName?: string; currency?: string; startsOn?: string | null; endsOn?: string | null; travelerCount?: number; optionalLabels?: string[] }): BudgetInputs {
  const result = startingBudgetInputs(input.currency ?? "USD", tripBudgetLodgingReference(input.destinationName)?.nightlyUsd);
  if (Number.isInteger(input.travelerCount) && input.travelerCount! > 0 && input.travelerCount! <= BUDGET_LIMITS.travelers) result.travelers = String(input.travelerCount);
  if (input.startsOn && input.endsOn && /^\d{4}-\d{2}-\d{2}$/.test(input.startsOn) && /^\d{4}-\d{2}-\d{2}$/.test(input.endsOn)) {
    const nights = (Date.parse(`${input.endsOn}T00:00:00Z`) - Date.parse(`${input.startsOn}T00:00:00Z`)) / 86_400_000;
    if (Number.isInteger(nights) && nights > 0 && nights <= BUDGET_LIMITS.nights) result.nights = String(nights);
  }
  // A plan template can name the extras people usually opt into. Amounts stay blank; only a new worksheet is seeded.
  const labels = (input.optionalLabels ?? []).slice(0, BUDGET_LIMITS.optionalExtras);
  if (labels.length) result.optional = labels.map((label, index) => ({ id: `extra-${index + 1}`, label, perPerson: "", participants: "" }));
  return result;
}
