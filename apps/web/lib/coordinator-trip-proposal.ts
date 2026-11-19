import { z } from "zod";
import { TripChangeProposalSchema, type TripChangeProposal } from "@commons/contracts";
import { buildPlanChange, isPlanReport, namedPlans, planGapReply, planReport, redactContactDetails, resolvePlanFollowUp, routesAsPlanFollowUp, type PlanContextItem, type PlanFollowUp, type PlanReferent, type PlanThreadContext } from "@/lib/coordinator-plan-proposal";

// The model can suggest only these fields. The server supplies all base values and
// resolves record identity; a suggestion is never an authorization to write.
export const TripSuggestionSchema = z.object({
  operations: z.array(z.enum(["budget", "dates", "destination", "stay", "plan"])).max(5),
  budgetCents: z.number().int().positive().max(100_000_000).nullable(),
  startsOn: z.string().date().nullable(), endsOn: z.string().date().nullable(),
  locationName: z.string().trim().min(1).max(160).nullable(),
  stayId: z.string().uuid().nullable(), stayName: z.string().trim().min(1).max(160).nullable(),
  stayAddress: z.string().trim().min(1).max(240).nullable(),
  stayStartsOn: z.string().date().nullable(), stayEndsOn: z.string().date().nullable(),
  stayTotalCents: z.number().int().positive().max(100_000_000).nullable(),
  stayBookingUrl: z.string().url().max(2048).nullable(),
  stayStatus: z.enum(["considering", "planned", "confirmed"]).nullable(),
  // One existing plan item. The id may only be one from the supplied plans; the server re-checks it against the organizer's words. Contact details are never a field:
  // the server finds a phone number or email in the message itself, and the model may only say who it belongs to.
  planId: z.string().max(80).nullable(), planTitle: z.string().trim().min(1).max(200).nullable(),
  planStatus: z.enum(["planned", "confirmed", "cancelled"]).nullable(),
  planStartsOn: z.string().date().nullable(), planStartsTime: z.string().max(5).nullable(),
  planNote: z.string().trim().min(1).max(500).nullable(), planContactLabel: z.string().trim().min(1).max(60).nullable(),
}).strict();
export type TripSuggestion = z.infer<typeof TripSuggestionSchema>;
const PLAN_KEYS = ["planId", "planTitle", "planStatus", "planStartsOn", "planStartsTime", "planNote", "planContactLabel"] as const;
/** A provider that leaves the plan fields out means "no plan update", as it does for every other field it does not fill. */
export function withPlanFieldDefaults<T>(suggestion: T): T {
  return suggestion && typeof suggestion === "object" && !Array.isArray(suggestion) ? { ...Object.fromEntries(PLAN_KEYS.map(key => [key, null])), ...suggestion } as T : suggestion;
}
/** Applies the plan-field defaults inside a whole provider reply, before its strict schema runs. */
export function withPlanFieldDefaultsInReply(reply: unknown) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply) || !("tripSuggestion" in reply)) return reply;
  return { ...reply, tripSuggestion: withPlanFieldDefaults((reply as { tripSuggestion: unknown }).tripSuggestion) };
}
export function parseTripSuggestion(raw: unknown) { return TripSuggestionSchema.safeParse(withPlanFieldDefaults(raw)); }
export type TripProposalContext = {
  name: string; startsOn: string | null; endsOn: string | null; locationName: string | null; targetBudgetCents: number | null;
  stays: Array<{ id: string; name: string; address: string; startsOn: string; endsOn: string; status: "considering" | "planned" | "confirmed"; totalCents: number | null; currency: string; bookingUrl: string | null; updatedAt: string; includedPersonIds: string[] }>;
  travelers: Array<{ id: string; name: string }>;
  /** Saved plan items that are not cancelled, with the details a review needs. Server-only; never sent to a model. */
  plans?: PlanContextItem[];
};

/** "Do we have our dates and lodging set?" asks about records; "Can you update the budget?" asks Commons to act. */
const QUESTION_ABOUT_RECORDS = /^\s*(?:do|does|did|is|are|was|were|have|has|had|what|what's|when|where|which|who|how|why)\b/i;
const ASKS_COMMONS_TO_ACT = /\b(?:can|could|would|will) you\b|\bplease\b/i;

export function isTripRecordRequest(prompt: string) {
  if (/\b(poll|draft|question|wording|message|option|copy)\b/i.test(prompt)) return false;
  if ((QUESTION_ABOUT_RECORDS.test(prompt) || prompt.trim().endsWith("?")) && !ASKS_COMMONS_TO_ACT.test(prompt)) return false;
  return /\b(update|change|set|raise|lower|increase|decrease|adjust|save|record|add|put|correct|edit|booked)\b/i.test(prompt)
    && /\b(budget|ceiling|trip dates?|destination|location|lodging|stay|hotel|airbnb|address|check-?in|check-?out)\b/i.test(prompt);
}

export type TripRecordRequest = { source: string; /** Set when the plan came from the thread rather than from the message (see resolvePlanFollowUp). */ followUp: PlanFollowUp | null };

export function tripRecordRequest(prompt: string, previousUserText?: string, plans?: Array<{ id?: string; title: string; status: PlanContextItem["status"] }>, thread?: PlanThreadContext): TripRecordRequest | null {
  if (isTripRecordRequest(prompt)) return { source: prompt, followUp: null };
  // A bare acceptance prepares only the immediately preceding unresolved user request.
  // Assistant prose never supplies evidence; an existing review is still approved only on screen.
  if (/^(?:yes|yeah|yep|sure|ok(?:ay)?|go ahead)[.!\s]*$/i.test(prompt.trim()) && plans && thread) {
    const last = thread.messages.at(-1);
    if (last && !last.settled && last.text === previousUserText && isPlanReport(last.text, plans)) {
      const accepted = resolvePlanFollowUp("Prepare the review card", plans, { ...thread, messages: [last] });
      if (accepted && routesAsPlanFollowUp(accepted)) return { source: `${last.text}\n${prompt}`, followUp: accepted.kind === "unique" ? { ...accepted, source: `${last.text}\n${prompt}` } : accepted };
    }
  }
  // "Mark it confirmed", "yes, update the status", "where is the card?": the plan comes from the thread (see resolvePlanFollowUp).
  const followUp = plans && thread ? resolvePlanFollowUp(prompt, plans, thread) : null;
  const viaThread = (): TripRecordRequest | null => routesAsPlanFollowUp(followUp) ? { source: followUp.kind === "unique" ? followUp.source : prompt, followUp } : null;
  const namesPlan = Boolean(plans && namedPlans(prompt, plans).length);
  if (!namesPlan && viaThread()) return viaThread();
  // A confirmation, cancellation or time change reported about a saved plan (not a question, hedge or wish) is a plan update to review.
  if (plans && isPlanReport(prompt, plans)) return { source: prompt, followUp: null };
  if (viaThread()) return viaThread();
  if (!previousUserText || !isTripRecordRequest(previousUserText)) return null;
  if (/\b(?:don't|do not|never|stop|cancel|instead|poll|draft|question|wording|message|option|copy)\b/i.test(prompt)) return null;
  if (!/\b(?:do|make|prepare|go ahead|try again|can you)\b/i.test(prompt)
    || !/\b(?:edit|edits|update|updates|change|changes|save|record)\b/i.test(prompt)) return null;
  return { source: `${previousUserText}\n${prompt}`, followUp: null };
}

// A short follow-up can refer to the immediately preceding request in this
// Workspace topic. Keep the original wording for provenance and never infer an
// edit from another topic or an older, superseded request.
export function tripRecordRequestSource(prompt: string, previousUserText?: string, plans?: Array<{ id?: string; title: string; status: PlanContextItem["status"] }>, thread?: PlanThreadContext): string | null {
  return tripRecordRequest(prompt, previousUserText, plans, thread)?.source ?? null;
}

export function savedTripFactsReply(prompt: string, context: TripProposalContext): string | null {
  if (!/\b(what(?:'s| is| are)?|show|tell|current|saved|now)\b/i.test(prompt)
    || !/\b(current|saved|now|on (?:the|our) trip|in commons)\b/i.test(prompt)) return null;
  const wantsBudget = /\b(budget|ceiling)\b/i.test(prompt);
  const wantsStay = /\b(lodging|stay|hotel|airbnb|address)\b/i.test(prompt);
  const wantsDates = /\b(trip dates?|destination)\b/i.test(prompt);
  if (!wantsBudget && !wantsStay && !wantsDates) return null;
  const parts: string[] = [];
  if (wantsBudget) parts.push(context.targetBudgetCents === null ? "No target trip budget is saved." : `The saved target trip budget is ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(context.targetBudgetCents / 100)} total.`);
  if (wantsDates) parts.push(`Saved trip dates: ${context.startsOn ?? "not set"} to ${context.endsOn ?? "not set"}. Destination: ${context.locationName ?? "not set"}.`);
  if (wantsStay) {
    if (context.stays.length === 0) parts.push("No lodging is saved on this trip.");
    else if (context.stays.length > 1) parts.push(`There are ${context.stays.length} saved stays: ${context.stays.map(stay => stay.name).join(", ")}. Which one would you like details for?`);
    else {
      const stay = context.stays[0];
      parts.push(`The saved stay is ${stay.name} at ${stay.address}, ${stay.startsOn} to ${stay.endsOn}. Its status is ${stay.status === "confirmed" ? "booked as reported by an organizer" : stay.status}. ${stay.totalCents === null ? "No lodging cost is saved." : `The reported lodging cost is ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(stay.totalCents / 100)}; this is not a recorded payment.`}`);
    }
  }
  return parts.join(" ").slice(0, 4000);
}

function organizerMentionedAmounts(texts: string[]) {
  const amounts = new Set<number>();
  for (const text of texts) {
    for (const match of text.matchAll(/(?:\$|\bUSD\s*|\b(?:budget|ceiling|cost|price|total)\s+(?:to|is|of|at)?\s*)(\d[\d,]*(?:\.\d{1,2})?)(k)?\b/gi)) {
      const amount = Number(match[1].replaceAll(",", "")) * (match[2] ? 1000 : 1);
      if (Number.isFinite(amount)) amounts.add(Math.round(amount * 100));
    }
  }
  return amounts;
}

function usdCents(value: string): number | null {
  const amount = Number(value.replaceAll(",", ""));
  const cents = Math.round(amount * 100);
  return Number.isFinite(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

function reportedStayTotal(text: string): number | null {
  // A nightly rate, another currency, or multiple different totals is not a
  // supported USD stay total. The organizer can still enter it in the review.
  if (/\b(?:CAD|EUR|GBP)\b|[€£]/i.test(text)) return null;
  const amount = String.raw`(?:\$|USD\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)`;
  const expressions = [
    new RegExp(`${amount}\\s*(?:USD\\s*)?(?:total\\s+(?:cost|price)|(?:lodging|stay|rental|booking)\\s+(?:cost|total|price))\\b`, "gi"),
    new RegExp(`\\b(?:total\\s+(?:lodging\\s+|stay\\s+|rental\\s+)?(?:cost|price)|(?:lodging|stay|rental|booking)\\s+(?:total|cost|price))\\s*(?:is|was|of|at|:|=)?\\s*${amount}`, "gi"),
    new RegExp(`\\b(?:stay|lodging|rental|booking)\\s+for\\s+${amount}`, "gi"),
  ];
  const values = new Set<number>();
  for (const expression of expressions) {
    for (const match of text.matchAll(expression)) {
      const nearby = text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 18);
      if (/\b(?:per\s+night|nightly|per\s+person|per\s+day)\b|\/night\b/i.test(nearby)
        || /\btrip\s+$/i.test(text.slice(Math.max(0, match.index - 12), match.index))
        || /^(?:\s*(?:for|of)\s+(?:the\s+)?trip\b)/i.test(text.slice(match.index + match[0].length))) continue;
      const cents = usdCents(match[1]);
      if (cents !== null) values.add(cents);
    }
  }
  return values.size === 1 ? [...values][0] : null;
}

/**
 * The provider's structured stay total, accepted only when the organizer's own message contains exactly that amount, exactly one dollar amount
 * appears, and nothing near it says it is a rate, a deposit or a per-person figure. "The total is now $2,100" carries no lodging word next to the
 * amount, so the phrase matcher above cannot read it, but the organizer clearly stated it.
 */
function suggestedStayTotal(text: string, suggestion: TripSuggestion): number | null {
  if (suggestion.stayTotalCents === null || /\b(?:CAD|EUR|GBP)\b|[€£]/i.test(text)) return null;
  const amounts = organizerMentionedAmounts([text]);
  if (amounts.size !== 1 || !amounts.has(suggestion.stayTotalCents)) return null;
  const pattern = /(?:\$|\bUSD\s*)(\d[\d,]*(?:\.\d{1,2})?)(k)?\b/gi;
  let found = false;
  for (const match of text.matchAll(pattern)) {
    const cents = Math.round(Number(match[1].replaceAll(",", "")) * (match[2] ? 1000 : 1) * 100);
    if (cents !== suggestion.stayTotalCents) continue;
    found = true;
    const nearby = text.slice(Math.max(0, match.index - 24), match.index + match[0].length + 28);
    if (/\b(?:per\s+night|nightly|per\s+person|per\s+day|a\s+night|each|deposit|down\s+payment|per\s+head|pp)\b|\/night\b/i.test(nearby)) return null;
  }
  return found ? suggestion.stayTotalCents : null;
}

/** Honest, code-authored text for a suggestion that could not become a reviewable proposal: never model prose that implies one exists. */
export function tripProposalGap(suggestion: TripSuggestion | null | undefined, context: TripProposalContext, source?: string, referent?: PlanReferent | null): string {
  if (source && suggestion?.operations.includes("plan")) {
    const build = buildPlanChange(suggestion ?? emptyPlanSuggestion, context.plans ?? [], source, referent);
    if (build.kind === "gap") return planGapReply(build, { contact: /\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}|@/.test(source) });
  }
  const opening = "I couldn’t prepare a trip update from that, so there is nothing to review and nothing was saved.";
  if (suggestion?.operations.includes("stay") && context.stays.length > 1) {
    return `${opening} There are ${context.stays.length} saved stays (${context.stays.slice(0, 4).map(stay => stay.name).join(", ")}). Tell me which one to update and the exact amount or detail to record.`;
  }
  if (suggestion?.operations.includes("stay") && context.stays.length === 0) return `${opening} No stay is saved yet. Tell me the stay’s name, address, and dates to record it for review.`;
  return `${opening} Tell me the exact detail to record, such as “the lodging total is $2,100”, and which stay if there is more than one.`;
}

/**
 * A message that clearly reports a confirmation or cancellation of a plan is prepared for review even when the model left the plan fields out (or the
 * whole suggestion): the status comes from the words, and every value is still checked against them when the proposal is built.
 */
export function withReportedPlan(suggestion: TripSuggestion | null, source: string): TripSuggestion | null {
  const report = planReport(source);
  if (!report || (!report.status && !report.reschedule)) return suggestion;
  if (suggestion?.operations.some(operation => operation !== "plan")) return suggestion;
  const base: TripSuggestion = suggestion ?? { operations: [], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: null, stayAddress: null,
    stayStartsOn: null, stayEndsOn: null, stayTotalCents: null, stayBookingUrl: null, stayStatus: null, ...emptyPlanSuggestion };
  return { ...base, operations: ["plan"], planStatus: base.planStatus ?? report.status };
}

/** A follow-up whose plan the thread established: the suggestion is exactly that plan and status, plus whatever note or time the model read from the organizer's words. */
export function withPlanReferent(suggestion: TripSuggestion | null, referent: PlanReferent): TripSuggestion {
  const base: TripSuggestion = suggestion ?? { operations: [], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: null, stayAddress: null,
    stayStartsOn: null, stayEndsOn: null, stayTotalCents: null, stayBookingUrl: null, stayStatus: null, ...emptyPlanSuggestion };
  // Only the plan operation: a follow-up about a plan never carries a budget, date, destination or stay change the model may have guessed.
  return { ...base, operations: ["plan"], planId: referent.planId, planStatus: referent.status ?? base.planStatus, budgetCents: null, startsOn: null, endsOn: null, locationName: null,
    stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: null, stayBookingUrl: null, stayStatus: null };
}

const emptyPlanSuggestion = { planId: null, planTitle: null, planStatus: null, planStartsOn: null, planStartsTime: null, planNote: null, planContactLabel: null };

function sameStayEvidence(text: string, address: string | null, bookingUrl: string | null): boolean {
  if (address && address.includes(",") && address.length >= 12 && text.toLocaleLowerCase().includes(address.toLocaleLowerCase())) return true;
  if (bookingUrl) {
    try {
      const url = new URL(bookingUrl);
      if (url.pathname.length > 3 && text.toLocaleLowerCase().includes(`${url.host}${url.pathname}`.toLocaleLowerCase())) return true;
    } catch { /* Domain validation rejects an invalid suggestion. */ }
  }
  return false;
}

function defaultStayName(address: string, tripLocation: string | null): string | null {
  const parts = address.split(",").map(part => part.trim());
  const locality = parts.length >= 3 && /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/i.test(parts.at(-1) ?? "")
    ? parts.at(-2) : tripLocation?.split(",")[0].trim();
  return locality ? `${locality.replace(/\s+/g, " ").trim().slice(0, 154)} House` : null;
}

export function buildTripChangeProposal(suggestion: TripSuggestion | null | undefined, context: TripProposalContext, source: string, organizerMessages: string[] = [source], referent?: PlanReferent | null): TripChangeProposal | null {
  if (!suggestion?.operations.length) return null;
  const wanted = new Set(suggestion.operations);
  const mentionedAmounts = organizerMentionedAmounts([source]);
  const base = {
    budgetCents: context.targetBudgetCents, startsOn: context.startsOn, endsOn: context.endsOn, locationName: context.locationName,
    stay: null as TripChangeProposal["base"]["stay"], includedPersonIds: [] as string[], plan: null as TripChangeProposal["base"]["plan"],
  };
  const changes: TripChangeProposal["changes"] = { ...base };
  const operations: TripChangeProposal["operations"] = [];
  if (wanted.has("budget") && suggestion.budgetCents !== null && mentionedAmounts.has(suggestion.budgetCents) && suggestion.budgetCents !== base.budgetCents) {
    changes.budgetCents = suggestion.budgetCents; operations.push("budget");
  }
  if (wanted.has("dates") && (suggestion.startsOn || suggestion.endsOn)) {
    changes.startsOn = suggestion.startsOn ?? base.startsOn;
    changes.endsOn = suggestion.endsOn ?? base.endsOn;
    if (changes.startsOn && changes.endsOn && changes.endsOn < changes.startsOn) return null;
    if (changes.startsOn !== base.startsOn || changes.endsOn !== base.endsOn) operations.push("dates");
  }
  if (wanted.has("destination") && suggestion.locationName && suggestion.locationName !== base.locationName) {
    changes.locationName = suggestion.locationName; operations.push("destination");
  }
  if (wanted.has("stay")) {
    const explicitlyNew = /\b(?:another|additional|second)\s+(?:lodging|stay|hotel|rental)\b|\bnew\s+(?:stay|hotel|rental)\b|\b(?:add|create|record)\s+(?:a\s+)?new\s+lodging\b|\badd\s+(?:a|the|this|my)\s+(?:booked\s+)?(?:stay|lodging|hotel|rental)\b/i.test(source);
    if (explicitlyNew && suggestion.stayId) return null;
    let selected = suggestion.stayId ? context.stays.find(stay => stay.id === suggestion.stayId) : undefined;
    if (suggestion.stayId && !selected) return null;
    if (!selected && !explicitlyNew && suggestion.stayName) {
      const matches = context.stays.filter(stay => stay.name.toLocaleLowerCase() === suggestion.stayName?.toLocaleLowerCase());
      if (matches.length === 1) selected = matches[0];
      if (matches.length > 1) return null;
    }
    if (!selected && context.stays.length === 1 && !explicitlyNew) selected = context.stays[0];
    if (!selected && context.stays.length > 1 && !explicitlyNew) return null;
    if (selected && selected.currency !== "USD") return null;
    const address = suggestion.stayAddress ?? selected?.address ?? "";
    const bookingUrl = suggestion.stayBookingUrl ?? selected?.bookingUrl ?? null;
    const relatedMessages = organizerMessages.filter(message => message === source || sameStayEvidence(message, address, bookingUrl));
    const explicitName = suggestion.stayName && relatedMessages.some(message => message.toLocaleLowerCase().includes(suggestion.stayName!.toLocaleLowerCase()));
    const name = selected ? suggestion.stayName ?? selected.name
      : explicitName ? suggestion.stayName! : defaultStayName(address, context.locationName) ?? suggestion.stayName ?? "";
    if (!name) return null;
    const currentTotal = reportedStayTotal(source) ?? suggestedStayTotal(source, suggestion);
    const earlierTotal = selected || currentTotal !== null ? null : relatedMessages.reduce<number | null>((latest, message) => reportedStayTotal(message) ?? latest, null);
    const stayTotal = currentTotal ?? earlierTotal ?? selected?.totalCents ?? null;
    base.stay = selected ? { id: selected.id, name: selected.name, address: selected.address, startsOn: selected.startsOn, endsOn: selected.endsOn,
      status: selected.status, totalCents: selected.totalCents, currency: "USD", bookingUrl: selected.bookingUrl, updatedAt: selected.updatedAt } : null;
    base.includedPersonIds = selected?.includedPersonIds ?? [];
    changes.stay = {
      id: selected?.id ?? null, name, address,
      startsOn: suggestion.stayStartsOn ?? selected?.startsOn ?? context.startsOn,
      endsOn: suggestion.stayEndsOn ?? selected?.endsOn ?? context.endsOn,
      status: suggestion.stayStatus ?? selected?.status ?? "planned", totalCents: stayTotal,
      currency: "USD", bookingUrl, updatedAt: selected?.updatedAt ?? null,
    };
    changes.includedPersonIds = [...base.includedPersonIds];
    if (!selected || JSON.stringify(changes.stay) !== JSON.stringify(base.stay)) operations.push("stay");
  }
  if (wanted.has("plan")) {
    const built = buildPlanChange(suggestion, context.plans ?? [], source, referent);
    if (built.kind === "proposal") { base.plan = built.base; changes.plan = built.changes; operations.push("plan"); }
  }
  if (!operations.length) return null;
  const costFromEarlier = operations.includes("stay") && !base.stay && changes.stay?.totalCents !== null && reportedStayTotal(source) === null && suggestedStayTotal(source, suggestion) === null;
  const costNote = costFromEarlier ? ` · Lodging total ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(changes.stay!.totalCents! / 100)} from an earlier organizer message in this topic.` : "";
  // A phone number or email the organizer typed stays in the conversation; it is never stored beside the proposal.
  const shownSource = redactContactDetails(source);
  const sourceLabel = costNote ? `${shownSource.slice(0, 240 - costNote.length)}${costNote}` : shownSource;
  return TripChangeProposalSchema.parse({ version: 1, state: "pending", source: sourceLabel.slice(0, 240), base, changes, operations, travelers: context.travelers, receipt: null });
}
