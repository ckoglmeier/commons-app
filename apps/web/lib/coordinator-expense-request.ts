import type { TripContextSnapshot } from "@commons/contracts";

/** Only a current, explicit named request prepares a review; questions and quoted reports do not. */
export function expenseConversionRequest(text: string) {
  const normalized = text.trim().replace(/[’‘]/g, "'");
  const match = normalized.match(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:convert|turn|change)\s+(.{1,200}?)\s+(?:to|into)\s+(?:an?\s+)?(?:recorded\s+)?expense[.!?]?$/i)
    ?? normalized.match(/^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:prepare|record)\s+(?:an?\s+)?expense\s+for\s+(.{1,200}?)[.!?]?$/i);
  if (!match || /\b(?:don't|do not|not yet|later|maybe|if|after|when)\b/i.test(normalized)) return null;
  return match[1].trim().replace(/^(?:the\s+)?budget (?:line )?item\s+(?:for\s+)?/i, "").replace(/^["“]|["”]$/g, "");
}

export function resolveExpenseActivity(text: string, plans: TripContextSnapshot["plans"]) {
  const title = expenseConversionRequest(text);
  if (!title) return [];
  const normalize = (value: string) => value.trim().toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ");
  return plans.filter(plan => normalize(plan.value.title) === normalize(title)).map(plan => plan.value);
}
