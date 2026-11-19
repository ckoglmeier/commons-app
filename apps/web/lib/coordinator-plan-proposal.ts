import { instantToZonedLocal, zonedLocalToInstant, type TripPlanReview } from "@commons/contracts";

/*
 * Plan-item updates prepared from chat (docs/COORDINATOR-WORKSPACE-DESIGN.md §20). Pure. The organizer's own message is the evidence: the model may only
 * suggest a plan id (from the supplied plans), a status, a local date and time, and a short note, and each of those is accepted only when the message
 * supports it. A reported confirmation is recorded as "confirmed as reported by an organizer", never as verified. A phone number or email in the message is
 * never placed in the proposal; it is offered on the review card as an unchecked option that puts it on the plan note (which every traveler can read).
 */

export type PlanContextItem = {
  id: string; title: string; status: "idea" | "planned" | "confirmed" | "cancelled"; timezone: string;
  startsAt: string | null; endsAt: string | null; note: string | null; updatedAt: string;
};
export type PlanSuggestion = {
  planId: string | null; planTitle: string | null; planStatus: "planned" | "confirmed" | "cancelled" | null;
  planStartsOn: string | null; planStartsTime: string | null; planNote: string | null; planContactLabel: string | null;
};

// ---------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------

const PHONE_NANP = /(?<![\w.])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
const PHONE_INTL = /(?<![\w.])\+(?!1\b)\d{1,3}[\s.-]?\d[\d\s().-]{6,14}\d(?!\d)/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Phone numbers and emails as the organizer typed them, in order, without duplicates. */
export function findContactDetails(text: string): string[] {
  const found: Array<{ index: number; value: string }> = [];
  for (const pattern of [PHONE_NANP, PHONE_INTL, EMAIL]) for (const match of text.matchAll(pattern)) found.push({ index: match.index ?? 0, value: match[0].trim() });
  const seen = new Set<string>(), values: string[] = [];
  for (const item of found.sort((a, b) => a.index - b.index)) {
    const key = item.value.replace(/[^\w@.+]/g, "").toLowerCase();
    if (!seen.has(key)) { seen.add(key); values.push(item.value); }
  }
  return values.slice(0, 2);
}

/** The text with every phone number and email replaced, for anything stored beside a proposal or sent anywhere else. */
export function redactContactDetails(text: string): string {
  return text.replace(EMAIL, "[contact detail]").replace(PHONE_INTL, "[contact detail]").replace(PHONE_NANP, "[contact detail]");
}

const wordsOf = (text: string) => text.toLowerCase().replace(/[’']s\b/g, "").split(/[^a-z0-9]+/).filter(Boolean);

/** "Guide James, 505-412-7380". The digits come from the organizer's message by code; the model may only name who the contact is, and only with words the organizer used. */
export function planContactOption(source: string, label: string | null): string | null {
  const values = findContactDetails(source);
  if (!values.length) return null;
  const said = new Set(wordsOf(source));
  const safeLabel = label && !/[\d@]/.test(label) && label.length <= 60 && wordsOf(label).length > 0 && wordsOf(label).every(word => said.has(word)) ? label.trim() : null;
  return `${safeLabel ?? "Contact"}, ${values.join(", ")}`.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Which saved plan a message is about
// ---------------------------------------------------------------------------

// Words that describe the kind of activity or the time of day rather than name it: "Fly-fishing lesson" is matched by "fly fishing".
const GENERIC = new Set(["the", "and", "for", "with", "our", "from", "into", "lesson", "class", "tour", "trip", "activity", "reservation", "booking", "time", "plan", "group", "day", "night", "morning", "afternoon", "evening", "session", "experience", "guided"]);
const singular = (word: string) => word.length > 4 && word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
const distinctive = (text: string) => [...new Set(wordsOf(text).filter(word => word.length >= 3 && !GENERIC.has(word)).map(singular))];

export type PlanResolution = { kind: "unique"; plan: PlanContextItem } | { kind: "ambiguous"; plans: PlanContextItem[] } | { kind: "none" };

function scorePlans<T extends { title: string; status: PlanContextItem["status"] }>(text: string, plans: T[]) {
  const said = new Set(distinctive(text));
  return plans.filter(plan => plan.status !== "cancelled").map(plan => {
    const title = distinctive(plan.title), hits = title.filter(word => said.has(word)).length;
    return { plan, score: title.length && hits >= Math.max(1, Math.ceil(title.length / 2)) ? hits : 0 };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
}

/** Every saved, non-cancelled plan the text names (at least half of its distinctive title words), best match first. */
export function namedPlans<T extends { title: string; status: PlanContextItem["status"] }>(text: string, plans: T[]): T[] {
  return scorePlans(text, plans).map(item => item.plan);
}

/** The saved plan a message names. A plan matches when the message contains at least half of its distinctive title words; one plan wins only when it clearly beats every other. */
export function resolvePlan(text: string, plans: PlanContextItem[], hintedId?: string | null): PlanResolution {
  const scored = scorePlans(text, plans);
  if (!scored.length) return { kind: "none" };
  // The model's id is a hint that the text must corroborate; it can break a tie but never point at a plan the message does not name.
  const hinted = hintedId ? scored.find(item => item.plan.id === hintedId) : undefined;
  if (hinted) return { kind: "unique", plan: hinted.plan };
  if (scored.length === 1 || scored[0].score >= scored[1].score * 2) return { kind: "unique", plan: scored[0].plan };
  return { kind: "ambiguous", plans: scored.filter(item => item.score * 2 >= scored[0].score).slice(0, 4).map(item => item.plan) };
}

/** A model-supplied id, accepted as a bare uuid or as the "plan:<uuid>" the model sees. */
export function normalizePlanId(value: string | null | undefined): string | null {
  const bare = value?.trim().replace(/^plan:/i, "") ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bare) ? bare.toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Reports about a plan: "we've confirmed fly fishing", "the sleigh ride is cancelled", "fly fishing moved to 10 AM"
// ---------------------------------------------------------------------------

export type PlanReport = { status: "confirmed" | "cancelled" | null; reschedule: boolean; clause: string };

const SCOPE_WORDS = /\b(?:poll|draft|wording|copy|question|message|option)\b/i;
const INTERROGATIVE = /^(?:(?:ok(?:ay)?|so|and|hey|now|then)[,\s]+)*(?:have|has|had|did|do|does|is|are|was|were|should|can|could|would|will|shall|what|when|where|why|how|which|who|whether|any|isn't|aren't|wasn't)\b/i;
const HEDGE = /\b(?:later|eventually|someday|maybe|perhaps|probably|possibly|might|if|whether|once|when we|after we|before we|not yet|hope|hoping|trying|try to|need to|needs to|want to|wants to|going to|gonna|plan(?:ning)? to|will|should|would|could|let's|thinking|considering|tentative(?:ly)?|pending|almost|about to|supposed to|unconfirmed|instead|whenever|in case)\b|\b\w+'ll\b/i;
const NEGATION = /\b(?:not|never|no|without|neither|nor)\b|n't\b/i;
const LEAD = String.raw`^(?:(?:ok(?:ay)?|hey|so|and|now|please|then|alright)[,\s]+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|go ahead and\s+|i need you to\s+|let's\s+|please\s+)?`;
const CONFIRM = /\b(?:confirmed|booked|reserved|locked in|all set|(?:is|are) set for)\b/i;
const CANCEL = /\b(?:cancell?ed|called off|scrapped|scratched)\b/i;
const RESCHEDULE = /\b(?:moved|rescheduled|pushed(?: back| up)?|shifted|bumped|changed)\b[^.?!]{0,80}\b(?:to|until|for)\b[^.?!]{0,20}(?:\d|noon|midnight)/i;
const IMPERATIVE_CANCEL = new RegExp(`${LEAD}cancel\\b`, "i");
const IMPERATIVE_MOVE = new RegExp(`${LEAD}(?:move|reschedule|push|shift|bump|change)\\b[^.?!]{0,80}\\b(?:to|until)\\b[^.?!]{0,20}(?:\\d|noon|midnight)`, "i");
const IMPERATIVE_MARK = new RegExp(`${LEAD}(?:mark|set|update|change)\\b[^.?!]{0,80}\\b(?:as|to)\\s+(?:confirmed|cancell?ed)\\b`, "i");

/** A bounded calendar-day shift, anchored to the saved plan in its own timezone. */
export function requestedPlanDayShift(rawText: string): number | null {
  const text = rawText.replace(/[’‘]/g, "'");
  if (text.length > 700 || SCOPE_WORDS.test(text) || NEGATION.test(text)
    || /\b(?:maybe|perhaps|might|if|should|thinking|considering|instead|eventually)\b/i.test(text)) return null;
  const rest = text.replace(/^(?:(?:please|ok(?:ay)?)[,\s]+)*(?:(?:i(?:'d| would) like(?: you)? to|i want(?: you)? to|(?:can|could|would|will) you(?: please)?|please|go ahead and)\s+)?/i, "");
  const match = rest.match(/^(?:move|shift|push|bump|reschedule)\b[^.!?;\n]{1,160}?\b(up|earlier|back|later)\s+by\s+(a|one|[1-9]\d?)\s+days?[.!?\s]*$/i);
  if (!match) return null;
  const count = /^(?:a|one)$/i.test(match[2]) ? 1 : Number(match[2]);
  return count <= 31 ? count * (/^(?:up|earlier)$/i.test(match[1]) ? -1 : 1) : null;
}

function shiftedPlanDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The clause of the message that reports a confirmation, cancellation or time change of a plan, or null. Questions, hedges, future wishes and negations never count. */
export function planReport(rawText: string): PlanReport | null {
  const text = rawText.replace(/[’‘]/g, "'").replace(/\b([ap])\.m\b\.?/gi, "$1m");
  if (SCOPE_WORDS.test(text) || text.length > 700) return null;
  if (requestedPlanDayShift(text) !== null) return { status: null, reschedule: true, clause: text };
  for (const segment of text.match(/[^.!?;\n]+[.!?;]*/g) ?? []) {
    const clause = segment.replace(/[.!?;]+$/, "").trim();
    if (!clause || segment.includes("?") || INTERROGATIVE.test(clause) || HEDGE.test(clause) || NEGATION.test(clause)) continue;
    const cancelled = CANCEL.test(clause) || IMPERATIVE_CANCEL.test(clause);
    const confirmed = CONFIRM.test(clause) || IMPERATIVE_MARK.test(clause) && /\bconfirmed\b/i.test(clause);
    const reschedule = RESCHEDULE.test(clause) || IMPERATIVE_MOVE.test(clause);
    if (cancelled && confirmed) continue; // Contradictory in one clause: ask instead of guessing.
    if (cancelled || confirmed || reschedule) return { status: cancelled ? "cancelled" : confirmed ? "confirmed" : null, reschedule, clause };
  }
  return null;
}

/**
 * A confirmation, cancellation or time change reported about a saved plan: the message routes to a reviewable plan update. A confirmation or cancellation that
 * carries a date or clock time but names no saved plan routes too, so the answer can say plainly that no saved plan matches (and that a new plan cannot be
 * created from chat) instead of leaving the organizer with generic prose.
 */
export function isPlanReport(text: string, plans: Array<{ title: string; status: PlanContextItem["status"]; id?: string }>): boolean {
  const report = planReport(text);
  if (!report) return false;
  if (report.status && hasScheduleEvidence(text)) return true;
  const asContext = plans.map((plan, index) => ({ id: plan.id ?? String(index), title: plan.title, status: plan.status, timezone: "", startsAt: null, endsAt: null, note: null, updatedAt: "" }));
  return resolvePlan(report.clause, asContext).kind !== "none";
}

// ---------------------------------------------------------------------------
// Follow-ups that name no plan: "change the activity status to confirmed", "mark it confirmed", "yes, update the status", "where is the card?"
// The plan comes from the thread, never from a guess: the plans named in the last few organizer messages, then the thread title. Only a unique
// result is used; an ambiguous one is one clarification. The status must be explicit in the request or in the earlier report it refers to.
// ---------------------------------------------------------------------------

export type PlanThreadContext = {
  /** Completed organizer messages of this thread, oldest first, without the current one. `settled` = its review was already applied or dismissed. */
  messages: Array<{ text: string; settled?: boolean }>;
  threadTitle: string | null;
};
export type PlanFollowUpRequest = { status: "confirmed" | "cancelled" | null; wantsCard: boolean; explicit: boolean };
type FollowUpPlan = { id?: string; title: string; status: PlanContextItem["status"] };
export type PlanFollowUp = { request: PlanFollowUpRequest } & (
  | { kind: "unique"; plan: FollowUpPlan; status: "confirmed" | "cancelled" | null; reschedule: boolean; source: string; via: "current" | "message" | "title" }
  | { kind: "ambiguous"; plans: FollowUpPlan[] }
  | { kind: "status_missing"; plan: FollowUpPlan }
  | { kind: "none" }
);

const REQUEST_LEAD = /^(?:(?:yes|yeah|yep|yup|sure|ok(?:ay)?|hey|so|and|now|then|alright|right|great|thanks|thank you)[,.!\s]+)*(?:(?:i(?:'d| would) like(?: you)? to|i want(?: you)? to|i need(?: you)? to|we want to|we need to|(?:can|could|would|will) you(?: please)?|go ahead and|please|let's|you should|just)\s+)*/i;
const OTHER_RECORDS = /\b(?:stay|lodging|hotel|airbnb|rental|house|budget|ceiling|dates?|destination|poll|draft|group|message|option|question|wording)\b/i;
const FOLLOW_STATUS = String.raw`(confirmed|cancell?ed)\b`;
const STATUS_PATTERNS: Array<{ pattern: RegExp; status: (m: RegExpMatchArray) => "confirmed" | "cancelled" | null }> = [
  { pattern: new RegExp(String.raw`^(?:mark|set|change|update|switch|move|flip)\b[^.?!]{0,60}?\b(?:as|to)\s+(?:being\s+)?${FOLLOW_STATUS}`, "i"), status: m => /^cancel/i.test(m[1]) ? "cancelled" : "confirmed" },
  { pattern: new RegExp(String.raw`^mark\s+(?:it|that|this|them|the\s+[\w -]{1,40}?|[\w -]{1,40}?)\s+(?:as\s+)?${FOLLOW_STATUS}`, "i"), status: m => /^cancel/i.test(m[1]) ? "cancelled" : "confirmed" },
  { pattern: /^(confirm|cancel)\s+(?:it|that|this|the\s+(?:activity|plan|lesson|booking|reservation|item)\b[\w -]{0,30})\s*$/i, status: m => /^cancel/i.test(m[1]) ? "cancelled" : "confirmed" },
  // The status is in the earlier report this refers to.
  { pattern: /^(?:update|change|set|save|record|apply)\s+(?:the\s+|its\s+)?(?:(?:activity|plan)\s+)?status(?:\s+(?:for|of)\s+(?:it|that|this))?\s*$/i, status: () => null },
  { pattern: /^(?:update|change|mark|save|record)\s+(?:it|that|this)(?:\s+(?:now|accordingly))?\s*$/i, status: () => null },
];
// Tested against the clause as written.
const CARD_PATTERNS = [
  /\bwhere(?:'s| is| are| did| has| have)\b[^.?!]{0,30}\b(?:card|suggestion|proposal|suggested update|review)\b/i,
  /\b(?:i|we)\s+(?:still\s+)?(?:don't|do not|can't|cannot|couldn't)\s+(?:see|find)\s+(?:the|a|any|that)\s+(?:review\s+)?(?:card|proposal|update|suggestion)\b|\bthere(?:'s| is) no (?:review )?(?:card|proposal|suggestion)\b/i,
];
// Tested after "can you", "please" and similar leads.
const CARD_REQUEST = /^(?:make|create|prepare|show|give|bring up|put up|generate)(?:\s+(?:me|us))?\s+(?:the|a|that|my|an)\s+(?:review\s+)?(?:card|proposal|update|suggestion)\b/i;

/** Is this message a request to update "the" plan the thread has been about, without naming it? Questions, hedges, wishes about the future and other records never are. */
export function planFollowUpRequest(rawText: string): PlanFollowUpRequest | null {
  const text = rawText.replace(/[’‘]/g, "'");
  if (text.length > 240) return null;
  for (const segment of text.match(/[^.!?;\n]+[.!?;]*/g) ?? []) {
    const clause = segment.replace(/[.!?;]+$/, "").trim();
    if (!clause) continue;
    const explicit = /\b(?:activity|plan|itinerary|card|item|lesson)\b/i.test(clause);
    if (CARD_PATTERNS.some(pattern => pattern.test(clause))) return { status: null, wantsCard: true, explicit };
    const rest = clause.slice(clause.match(REQUEST_LEAD)?.[0].length ?? 0);
    if (rest && CARD_REQUEST.test(rest) && !HEDGE.test(rest) && !NEGATION.test(rest)) return { status: null, wantsCard: true, explicit };
    if (!rest || OTHER_RECORDS.test(rest) || HEDGE.test(rest) || NEGATION.test(rest)) continue;
    for (const entry of STATUS_PATTERNS) {
      const match = rest.match(entry.pattern);
      if (match) return { status: entry.status(match), wantsCard: false, explicit };
    }
  }
  return null;
}

const RECENT_MESSAGES = 3;
const planKey = (plan: FollowUpPlan, index = 0) => plan.id ?? `${plan.title}#${index}`;

/**
 * The plan a follow-up refers to, or null when the message is not such a follow-up. Candidates come, in order, from the plans the message itself names, the
 * plans named in the last few organizer messages, and the thread title; the first source with any candidate decides, and it must be unique.
 */
export function resolvePlanFollowUp(prompt: string, plans: FollowUpPlan[], context: PlanThreadContext): PlanFollowUp | null {
  const request = planFollowUpRequest(prompt);
  if (!request) return null;
  const items = plans.filter(plan => plan.status !== "cancelled");
  const recent = context.messages.slice(-RECENT_MESSAGES);
  const named = recent.map(message => ({ message, plans: namedPlans(message.text, items) }));
  const unique = (list: FollowUpPlan[]) => { const seen = new Set<string>(); return list.filter(plan => { const key = planKey(plan, items.indexOf(plan)); return seen.has(key) ? false : (seen.add(key), true); }); };
  const fromPrompt = unique(namedPlans(prompt, items)), fromMessages = unique(named.flatMap(item => item.plans)), fromTitle = unique(namedPlans(context.threadTitle ?? "", items));
  const via = fromPrompt.length ? "current" : fromMessages.length ? "message" : "title";
  const candidates = fromPrompt.length ? fromPrompt : fromMessages.length ? fromMessages : fromTitle;
  if (!candidates.length) return { request, kind: "none" };
  if (candidates.length > 1) return { request, kind: "ambiguous", plans: candidates.slice(0, 4) };
  const plan = candidates[0], key = planKey(plan, items.indexOf(plan));
  // The most recent unresolved report about this plan supplies the status when the request has none, and its wording (with any contact in it) as evidence.
  let report: { text: string; status: "confirmed" | "cancelled" | null; reschedule: boolean } | null = null;
  for (const item of [...named].reverse()) {
    if (item.message.settled || !item.plans.some(candidate => planKey(candidate, items.indexOf(candidate)) === key)) continue;
    const found = planReport(item.message.text);
    if (found && (found.status || found.reschedule)) { report = { text: item.message.text, status: found.status, reschedule: found.reschedule }; break; }
  }
  const status = request.status ?? report?.status ?? null;
  if (!status && !report?.reschedule) return { request, kind: "status_missing", plan };
  const consistent = report && (!report.status || report.status === status);
  return { request, kind: "unique", plan, status, reschedule: Boolean(consistent && report?.reschedule), via, source: consistent ? `${report!.text}\n${prompt}` : prompt };
}

/** Whether a follow-up should route to a plan update (or, with trip changes off, to the honest "turned off right now" text). */
export function routesAsPlanFollowUp(followUp: PlanFollowUp | null): followUp is PlanFollowUp {
  return followUp !== null && (followUp.kind !== "none" || followUp.request.explicit && !followUp.request.wantsCard);
}

// ---------------------------------------------------------------------------
// Evidence in the message for a date or a time
// ---------------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** Explicit month/day pairs the message names ("10/12", "Oct 12", "12th of October"), as "MM-DD". */
function statedMonthDays(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/(?<![\d/-])(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?(?![\d/-])/g)) {
    const [month, day] = [Number(match[1]), Number(match[2])];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) found.add(`${pad(month)}-${pad(day)}`);
  }
  const names = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  for (const match of text.matchAll(new RegExp(String.raw`\b${names}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`, "gi"))) found.add(`${pad(MONTHS.indexOf(match[1].slice(0, 3).toLowerCase()) + 1)}-${pad(Number(match[2]))}`);
  for (const match of text.matchAll(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${names}\b`, "gi"))) found.add(`${pad(MONTHS.indexOf(match[2].slice(0, 3).toLowerCase()) + 1)}-${pad(Number(match[1]))}`);
  return [...found];
}
const RELATIVE_DAY = /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|the\s+\d{1,2}(?:st|nd|rd|th))\b/i;

/** Clock times the message names, as "HH:MM". A bare hour ("for 9") could be morning or evening, so both are accepted and the review shows the result. */
function statedTimes(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?/gi)) {
    const hour = Number(match[1]) % 12 + (match[3].toLowerCase() === "p" ? 12 : 0);
    if (Number(match[1]) >= 1 && Number(match[1]) <= 12) found.add(`${pad(hour)}:${match[2] ?? "00"}`);
  }
  if (/\bnoon\b/i.test(text)) found.add("12:00");
  if (/\bmidnight\b/i.test(text)) found.add("00:00");
  for (const match of text.matchAll(/(?<![\d/:-])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])(?!\s*[ap]\.?m)/gi)) found.add(`${pad(Number(match[1]))}:${match[2]}`);
  for (const match of text.matchAll(/\b(?:at|for|to|until|@)\s+(\d{1,2})(?![\d:/-])(?!\s*(?:people|persons?|guests?|adults?|kids?|children|nights?|days?|hours?|hrs?|minutes?|mins?|of us|travelers?|pax|[ap]\.?m))/gi)) {
    const hour = Number(match[1]);
    if (hour >= 1 && hour <= 12) { found.add(`${pad(hour % 12)}:00`); found.add(`${pad(hour % 12 + 12)}:00`); }
  }
  return [...found];
}

/** The message names a month and day or a clock time. */
export function hasScheduleEvidence(text: string): boolean {
  const plain = redactContactDetails(text);
  return statedMonthDays(plain).length > 0 || statedTimes(plain).length > 0;
}

// ---------------------------------------------------------------------------
// Building the review
// ---------------------------------------------------------------------------

export type PlanBuild =
  | { kind: "proposal"; base: TripPlanReview; changes: TripPlanReview; changed: { status: boolean; time: boolean; note: boolean } }
  | { kind: "gap"; reason: "none" | "ambiguous" | "unchanged" | "unsupported"; plans: PlanContextItem[] };

const STATUS_EVIDENCE: Record<"planned" | "confirmed" | "cancelled", RegExp> = {
  confirmed: /\b(?:confirm(?:ed|s)?|booked|reserved|locked in|all set|set for)\b/i,
  cancelled: /\b(?:cancell?ed|cancel|called off|scrapped|scratched)\b/i,
  planned: /\b(?:planned|scheduled|penciled|pencilled)\b/i,
};

function reviewOf(plan: PlanContextItem): TripPlanReview | null {
  const local = plan.startsAt ? instantToZonedLocal(plan.startsAt, plan.timezone) : null;
  if (plan.startsAt && !local) return null;
  if ((plan.note?.length ?? 0) > 4000 || plan.title.length > 200) return null;
  return { id: plan.id, title: plan.title, status: plan.status, timezone: plan.timezone, startsOn: local?.date ?? null, startsTime: local?.time ?? null, note: plan.note, updatedAt: plan.updatedAt, contact: null };
}

/** A plan the thread established for a follow-up (see resolvePlanFollowUp), with the status the organizer stated or reported. Server-derived, never from the model. */
export type PlanReferent = { planId: string; status: "confirmed" | "cancelled" | null };

export function buildPlanChange(suggestion: PlanSuggestion, plans: PlanContextItem[], source: string, referent?: PlanReferent | null): PlanBuild {
  const report = referent ? null : planReport(source);
  const known = referent ? plans.find(plan => plan.id === referent.planId && plan.status !== "cancelled") : undefined;
  const resolved: PlanResolution = referent ? known ? { kind: "unique", plan: known } : { kind: "none" } : resolvePlan(report?.clause ?? source, plans, requestedPlanDayShift(source) !== null ? null : normalizePlanId(suggestion.planId));
  if (resolved.kind === "none") return { kind: "gap", reason: "none", plans };
  if (resolved.kind === "ambiguous") return { kind: "gap", reason: "ambiguous", plans: resolved.plans };
  const base = reviewOf(resolved.plan);
  if (!base) return { kind: "gap", reason: "unsupported", plans: [resolved.plan] };
  const changes: TripPlanReview = { ...base };
  const evidenceText = redactContactDetails(source);
  const shift = requestedPlanDayShift(source.split("\n")[0]);

  if (referent) { if (referent.status && referent.status !== base.status) changes.status = referent.status; }
  else if (suggestion.planStatus && suggestion.planStatus !== base.status && STATUS_EVIDENCE[suggestion.planStatus].test(report?.clause ?? evidenceText)) changes.status = suggestion.planStatus;

  // A time is accepted only when the organizer's words name it; a date only when they name that month and day, or a relative day the model resolved.
  if (base.startsOn || (suggestion.planStartsOn && suggestion.planStartsTime)) {
    let date = shift !== null && base.startsOn ? shiftedPlanDate(base.startsOn, shift) : base.startsOn, time = base.startsTime;
    const days = statedMonthDays(evidenceText), times = statedTimes(evidenceText);
    if (shift === null && suggestion.planStartsOn && (days.length ? days.includes(suggestion.planStartsOn.slice(5)) : RELATIVE_DAY.test(evidenceText))) {
      // The year is the model's inference; a date that names the saved day is the saved day.
      date = base.startsOn && suggestion.planStartsOn.slice(5) === base.startsOn.slice(5) ? base.startsOn : suggestion.planStartsOn;
    }
    if (shift === null && suggestion.planStartsTime && /^\d{2}:\d{2}$/.test(suggestion.planStartsTime) && times.includes(suggestion.planStartsTime)) time = suggestion.planStartsTime;
    if (date && time && (date !== base.startsOn || time !== base.startsTime) && zonedLocalToInstant(date, time, base.timezone)) { changes.startsOn = date; changes.startsTime = time; }
  }

  const addition = suggestion.planNote?.replace(/\s+/g, " ").trim();
  if (addition && addition.length <= 500 && findContactDetails(addition).length === 0 && !base.note?.includes(addition)) changes.note = base.note ? `${base.note}\n${addition}` : addition;

  const changed = { status: changes.status !== base.status, time: changes.startsOn !== base.startsOn || changes.startsTime !== base.startsTime, note: changes.note !== base.note };
  if (!changed.status && !changed.time && !changed.note) return { kind: "gap", reason: "unchanged", plans: [resolved.plan] };
  const contact = planContactOption(source, suggestion.planContactLabel);
  if (contact) changes.contact = { text: contact, include: false };
  return { kind: "proposal", base, changes, changed };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const clock = (time: string, timezone: string, date: string) => {
  try {
    const instant = zonedLocalToInstant(date, time, timezone);
    return instant ? new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(instant)) : `${date} ${time}`;
  } catch { return `${date} ${time}`; }
};

/** The local time as a person reads it, in the item's own zone: "Oct 12, 9:00 AM". */
export function planLocalTimeLabel(plan: Pick<TripPlanReview, "startsOn" | "startsTime" | "timezone">): string {
  return plan.startsOn && plan.startsTime ? clock(plan.startsTime, plan.timezone, plan.startsOn) : "No time set";
}

/** The same time as a one-line headline reads it, without empty minutes: "Oct 12, 9 AM" or "Feb 13, 3:30 PM". Empty when the item has no time. */
export function planShortTimeLabel(plan: Pick<TripPlanReview, "startsOn" | "startsTime" | "timezone">): string {
  return plan.startsOn && plan.startsTime ? planLocalTimeLabel(plan).replace(/:00(?=\s)/, "") : "";
}

/**
 * A status-only plan proposal (design §22): one plan item, its status moving to confirmed or cancelled, and nothing else different from the saved item
 * (time, date and note are as saved). The contact option does not count as a change. These get the compact confirmation card; anything else keeps the full form.
 */
export function isCompactPlanProposal(proposal: { operations: readonly string[]; base: { plan?: TripPlanReview | null }; changes: { plan?: TripPlanReview | null } }): boolean {
  if (proposal.operations.length !== 1 || proposal.operations[0] !== "plan") return false;
  const base = proposal.base.plan, changed = proposal.changes.plan;
  if (!base || !changed || base.id !== changed.id) return false;
  if (changed.status !== "confirmed" && changed.status !== "cancelled") return false;
  return changed.status !== base.status && changed.startsOn === base.startsOn && changed.startsTime === base.startsTime && (changed.note ?? null) === (base.note ?? null) && changed.timezone === base.timezone;
}

export const PLAN_STATUS_LABEL: Record<TripPlanReview["status"], string> = { idea: "Idea", planned: "Planned", confirmed: "Confirmed as reported", cancelled: "Cancelled" };

/** Whose contact a shared "Guide James, 505-412-7380" is, as a possessive subject: "James’s number", or "The number you shared" when the organizer gave no name. */
function contactSubject(contact: string): string {
  const kind = findContactDetails(contact)[0]?.includes("@") ? "email" : "number";
  const label = contact.split(",")[0].trim();
  if (!label || label === "Contact" || findContactDetails(label).length) return `The ${kind} you shared`;
  const words = label.split(/\s+/), name = /^[A-Z]/.test(words.at(-1)!) ? words.at(-1)! : label;
  return `${name}’s ${kind}`;
}

/**
 * Code-authored answer for a plan update that is ready for review. A status-only proposal (compact card) gets one short sentence, plus one about a shared
 * contact; the card already shows provenance and that nothing changes until it is approved. Never repeats a contact detail.
 */
export function planProposalReply(base: TripPlanReview, changes: TripPlanReview): string {
  if (isCompactPlanProposal({ operations: ["plan"], base: { plan: base }, changes: { plan: changes } })) {
    const contact = changes.contact ? ` ${contactSubject(changes.contact.text)} stays in this conversation unless you add it to the plan note.` : "";
    return `Ready to mark “${base.title}” ${changes.status} — check the card below.${contact}`;
  }
  const parts: string[] = [];
  if (changes.status !== base.status) parts.push(changes.status === "confirmed" ? "mark it confirmed, as you reported" : changes.status === "cancelled" ? "mark it cancelled, as you reported" : `mark it ${changes.status}`);
  if (changes.startsOn !== base.startsOn || changes.startsTime !== base.startsTime) parts.push(`move it to ${planLocalTimeLabel(changes)}`);
  if (changes.note !== base.note) parts.push("add a plan note");
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  const contact = changes.contact ? " The contact you shared stays in this organizer conversation, and goes on the plan note, where travelers can read it, only if you check that option." : "";
  return `I’ve prepared an update to “${base.title}” to ${list}. Nothing is saved until you approve it on screen.${contact}`;
}

/** What Commons says aloud for a plan update: one sentence, approval on screen, never the contact. */
export function planProposalSpokenReply(base: TripPlanReview): string {
  return `I’ve prepared that plan update for “${base.title}”, and approval happens on screen.`;
}

/** Honest, code-authored text when a plan report could not become a reviewable update. */
export function planGapReply(build: Extract<PlanBuild, { kind: "gap" }>, options: { contact: boolean; status?: "confirmed" | "cancelled" | "planned" | null }): string {
  const opening = "I couldn’t prepare a plan update from that, so there is nothing to review and nothing was saved.";
  const kept = options.contact ? " The contact you shared is kept only in this organizer conversation; I did not add it to any plan." : "";
  const titles = build.plans.slice(0, 4).map(plan => `“${plan.title}”`);
  if (build.reason === "ambiguous") return `${opening} More than one saved plan could match (${titles.join(", ")}). Tell me which one, and I’ll prepare it for review.${kept}`;
  if (build.reason === "unchanged") return `${opening} “${build.plans[0].title}” already matches what you told me, so there is nothing to change.${kept}`;
  if (build.reason === "unsupported") return `${opening} “${build.plans[0].title}” has details I can’t update from chat; use Plan to edit it.${kept}`;
  const listed = titles.length ? ` The saved plans are ${titles.join(", ")}${build.plans.length > 4 ? " and more" : ""}.` : " No plans are saved yet.";
  return `${opening} I couldn’t find a saved plan that matches.${listed} I can’t create a new plan from chat yet; add it in Plan, then tell me to update it.${kept}`;
}

const NOTHING_SAVED = "I couldn’t prepare a plan update from that, so there is nothing to review and nothing was saved.";

/** Code-authored text for a follow-up that could not become a review: which plan or which status is missing. */
export function planFollowUpGapReply(followUp: Exclude<PlanFollowUp, { kind: "unique" }>, savedPlans: Array<{ title: string }>): string {
  if (followUp.kind === "ambiguous") {
    return `${NOTHING_SAVED} More than one saved plan could match (${followUp.plans.slice(0, 4).map(plan => `“${plan.title}”`).join(", ")}). Tell me which one, and I’ll prepare it for review.`;
  }
  if (followUp.kind === "status_missing") {
    return `${NOTHING_SAVED} I can’t tell what status you want for “${followUp.plan.title}”. Say “mark it confirmed” or “mark it cancelled”, and I’ll prepare it for review.`;
  }
  const titles = savedPlans.slice(0, 4).map(plan => `“${plan.title}”`);
  return `${NOTHING_SAVED} I can’t tell which plan you mean.${titles.length ? ` The saved plans are ${titles.join(", ")}${savedPlans.length > 4 ? " and more" : ""}.` : " No plans are saved yet."} Name the plan and the status, such as “mark the fly-fishing lesson confirmed”.`;
}

/** Trip changes are switched off globally: say so plainly, and where the organizer can make the change themselves. */
export function planUpdatesOffReply(status: "confirmed" | "cancelled" | null): string {
  return `Plan updates from chat are turned off right now. You can ${status ? `mark it ${status}` : "change it"} in Plan. Nothing was changed.`;
}

/** A review for this plan is already waiting in the conversation: point to it instead of creating a second one. */
export function existingPlanReviewReply(title: string, status: "confirmed" | "cancelled" | null): string {
  return `A review ${status ? `to mark “${title}” ${status}` : `for “${title}”`} is already waiting — check the card on your earlier message.`;
}
