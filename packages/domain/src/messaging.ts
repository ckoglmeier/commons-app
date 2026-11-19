/*
 * Traveler messaging policy (Beta Rework BR-04). Pure and channel-neutral: no database, no provider, no clock except the one passed in.
 * Everything a reply can do is decided here from already-authorized inputs, then executed by the web service against the existing repositories.
 */

export const SMS_CONSENT_WORDING = "sms-v1";
/** A question stays answerable for this long. After it, a reply is stale and gets a clarification, not an action. */
export const QUESTION_TTL_MS = 48 * 60 * 60 * 1000;
/** Without naming a trip, a reply can attach to the one open question only while that question is this fresh. */
export const FRESH_REPLY_MS = 4 * 60 * 60 * 1000;

export type MessageKeyword = "stop" | "start" | "help" | null;
/**
 * Carrier-level keywords. START and UNSTOP re-enroll a number; a bare YES does not: it is the most common answer to a trip question.
 * Only a message that is exactly the keyword counts, so "stop by the market at 5" is never an opt-out.
 */
export function classifyKeyword(body: string): MessageKeyword {
  const word = body.trim().toLowerCase().replace(/[.!\s]+$/g, "");
  if (["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "opt out", "optout"].includes(word)) return "stop";
  if (["start", "unstop", "subscribe"].includes(word)) return "start";
  if (["help", "info"].includes(word)) return "help";
  return null;
}

export function normalizeReply(body: string) {
  return body.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['\u2019]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export type AttendanceReply = "attending" | "declined" | "maybe" | "unclear";
export function parseAttendanceReply(body: string): AttendanceReply {
  const text = normalizeReply(body);
  if (/^(yes|y|yep|yeah|yup|sure|definitely|im in|i am in|in|count me in|were in|we are in|yes im in|yes i can come)$/.test(text)) return "attending";
  if (/^(no|n|nope|nah|cant make it|cannot make it|i cant make it|i cant come|cant come|out|im out|not coming|skip)$/.test(text)) return "declined";
  if (/^(maybe|not sure|unsure|tbd|undecided|i dont know|dont know|probably|possibly)$/.test(text)) return "maybe";
  return "unclear";
}

export function parseYesNo(body: string): "yes" | "no" | "unclear" {
  const text = normalizeReply(body);
  if (/^(yes|y|yep|yeah|yup|confirm|confirmed|sure|ok|okay)$/.test(text)) return "yes";
  if (/^(no|n|nope|nah|keep|cancel|never mind|nevermind|not now)$/.test(text)) return "no";
  return "unclear";
}

const ORDINALS: Record<string, string> = { one: "1", first: "1", two: "2", second: "2", three: "3", third: "3", four: "4", fourth: "4", five: "5", fifth: "5", six: "6", sixth: "6" };
/** Polite wrapping around an answer. Taken off only at the edges, so it can't change what's left. */
function stripOptionWords(text: string) {
  return text.replace(/^(option|number|choice|the|i pick|i choose|i vote for|i vote|id say|lets do|lets go with|go with|pick|definitely)\s+/, "").replace(/^(option|number|choice|the)\s+/, "").replace(/\s+(one|option|please|thanks|thank you|for me|works|works for me)$/, "").replace(/\s+(please|thanks|thank you)$/, "");
}
/** A reply that says no to something is never read as choosing it: "not 2" and "no to saturday" stay unclear. */
const NEGATED = /\b(not|no|nope|never|neither|none|nor|dont|doesnt|cant|couldnt|wont|wouldnt|isnt|except|but|bad|unless)\b/;
const keyFor = (word: string, options: ReadonlyArray<{ key: string }>) => options.find(option => option.key.toLowerCase() === (ORDINALS[word] ?? word))?.key ?? null;

/**
 * A number ("2", "option 2", "the second one"), a letter ("b") or the option's own words. The whole reply must point at exactly one option; anything less
 * certain is null and gets asked again, because an answer recorded by guessing is worse than one more text.
 */
export function parseOptionReply(body: string, options: ReadonlyArray<{ key: string; label: string }>): { key: string } | null {
  const text = normalizeReply(body);
  if (!text) return null;
  const byKey = options.find(option => option.key.toLowerCase() === text);
  if (byKey) return { key: byKey.key };
  const byLabel = options.filter(option => normalizeReply(option.label) === text);
  if (byLabel.length === 1) return { key: byLabel[0]!.key };
  if (NEGATED.test(text)) return null;
  const stripped = stripOptionWords(text);
  const key = keyFor(stripped, options);
  if (key) return { key };
  // The whole reply has to be the option, once polite wrapping is off. A label merely mentioned in a sentence ("what's the plan for Saturday") isn't a vote.
  const named = options.filter(option => normalizeReply(option.label) === stripped);
  return named.length === 1 ? { key: named[0]!.key } : null;
}

/** Every option a reply names, for a question that takes several: "1 and 3", "1, 3", "Saturday and Sunday", "all of them". Null unless every part is clear. */
export function parseMultiOptionReply(body: string, options: ReadonlyArray<{ key: string; label: string; exclusive?: boolean }>): { keys: string[] } | null {
  const text = normalizeReply(body);
  if (!text) return null;
  const selectable = options.filter(option => !option.exclusive);
  if (/^(all|all of them|all of those|all of the above|any|any of them|every one|everything|they all work|all work)$/.test(text)) return selectable.length ? { keys: selectable.map(option => option.key) } : null;
  const whole = parseOptionReply(body, options);
  if (whole) return { keys: [whole.key] };
  if (NEGATED.test(text)) return null;
  const stripped = stripOptionWords(text);
  // Digits and letters may run together with only spaces ("1 3"). Words need a real separator, so a label with a space in it stays whole.
  const parts = (/^[a-z0-9]( [a-z0-9])+$/.test(stripped) ? stripped.split(" ") : body.toLowerCase().normalize("NFKD").split(/\s*(?:,|;|&|\+|\band\b|\bor\b)\s*/)).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const keys: string[] = [];
  for (const part of parts) {
    const one = parseOptionReply(part, options);
    if (!one) return null;
    if (!keys.includes(one.key)) keys.push(one.key);
  }
  // "None of these" can't be chosen alongside anything else.
  if (keys.length > 1 && keys.some(key => options.find(option => option.key === key)?.exclusive)) return null;
  return { keys };
}

/**
 * "SAVE 4K7" saves; "DISCARD" declines. A bare "yes" or "no" is never an approval: it names no version, and it is just as likely to be the answer
 * to another question, so while a review is pending it is not applied to anything.
 */
export function parseApproval(body: string): { action: "save" | "decline" | "none"; code: string | null } {
  const text = normalizeReply(body);
  const save = text.match(/^save(?: it)?(?: ([a-z0-9]{3,6}))?$/);
  if (save) return { action: "save", code: save[1]?.toUpperCase() ?? null };
  if (/^(discard|discard it|dont save|do not save|not right|wrong)$/.test(text)) return { action: "decline", code: null };
  return { action: "none", code: null };
}

const CODE_ALPHABET = "ACDEFGHJKLMNPQRTUVWXY34679";
/** Short, readable and bound to one intake at one version. A different version of the same intake yields a different code. */
export function approvalCode(intakeId: string, version: number) {
  // Pure (no node:crypto) so this module stays importable from client bundles. The code only needs to differ per version; the approving
  // reply must also come from the verified number that holds the pending question.
  let a = 0x9e3779b9, b = 0x85ebca6b;
  for (const char of `${intakeId}:${version}`) { a = Math.imul(a ^ char.charCodeAt(0), 0x01000193) >>> 0; b = Math.imul(b + a, 0xc2b2ae35) >>> 0; b ^= b >>> 13; }
  return [a, a >>> 8, b].map(n => CODE_ALPHABET[(n >>> 0) % CODE_ALPHABET.length]).join("");
}

/** GSM-7 messages hold 160 characters (153 per part when joined); anything else is UCS-2 at 70 (67). Used to measure cost per trip. */
export function smsSegments(body: string) {
  const gsm = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(body);
  const [single, multi] = gsm ? [160, 153] : [70, 67];
  return body.length <= single ? 1 : Math.ceil(body.length / multi);
}

export type QuietHours = { startHour: number; endHour: number };
export const DEFAULT_QUIET_HOURS: QuietHours = { startHour: 21, endHour: 8 };

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(now);
  return { hour: Number(parts.find(p => p.type === "hour")!.value), minute: Number(parts.find(p => p.type === "minute")!.value) };
}
/** True during the recipient's quiet hours in the trip's time zone. An unknown zone is treated as quiet: never guess toward waking someone. */
export function isQuietHours(now: Date, timeZone: string, quiet: QuietHours = DEFAULT_QUIET_HOURS) {
  let hour: number;
  try { hour = localParts(now, timeZone).hour; } catch { return true; }
  return quiet.startHour > quiet.endHour ? hour >= quiet.startHour || hour < quiet.endHour : hour >= quiet.startHour && hour < quiet.endHour;
}
/** The first instant, in whole minutes after `now`, that is outside quiet hours. */
export function quietHoursEnd(now: Date, timeZone: string, quiet: QuietHours = DEFAULT_QUIET_HOURS) {
  let cursor = new Date(Math.ceil(now.getTime() / 60_000) * 60_000);
  for (let step = 0; step < 24 * 60 && isQuietHours(cursor, timeZone, quiet); step++) cursor = new Date(cursor.getTime() + 60_000);
  return cursor;
}

export type CadenceLimits = { minGapMs: number; maxPerDay: number; maxPerWeekPerTrip: number; maxAttemptsPerQuestion: number; reminderAfterMs: number };
export const DEFAULT_CADENCE: CadenceLimits = { minGapMs: 6 * 3_600_000, maxPerDay: 2, maxPerWeekPerTrip: 4, maxAttemptsPerQuestion: 2, reminderAfterMs: 24 * 3_600_000 };
export type ProactiveRecord = { at: Date; commonsId: string | null; questionKey: string | null };

/** Replies to something the person just sent are exempt; only proactive messages count here. */
export function cadenceDecision(input: { now: Date; commonsId: string; questionKey: string; history: readonly ProactiveRecord[]; limits?: CadenceLimits }): { allowed: true } | { allowed: false; reason: string; retryAt: Date | null } {
  const limits = input.limits ?? DEFAULT_CADENCE, now = input.now.getTime();
  const recent = input.history.filter(item => item.at.getTime() <= now);
  const same = recent.filter(item => item.questionKey === input.questionKey).sort((a, b) => b.at.getTime() - a.at.getTime());
  if (same.length >= limits.maxAttemptsPerQuestion) return { allowed: false, reason: "reminder_limit", retryAt: null };
  if (same[0] && now - same[0].at.getTime() < limits.reminderAfterMs) return { allowed: false, reason: "too_soon_for_reminder", retryAt: new Date(same[0].at.getTime() + limits.reminderAfterMs) };
  const last = [...recent].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  if (last && now - last.at.getTime() < limits.minGapMs) return { allowed: false, reason: "minimum_gap", retryAt: new Date(last.at.getTime() + limits.minGapMs) };
  const day = recent.filter(item => now - item.at.getTime() < 86_400_000);
  if (day.length >= limits.maxPerDay) return { allowed: false, reason: "daily_limit", retryAt: new Date(Math.min(...day.map(item => item.at.getTime())) + 86_400_000) };
  const week = recent.filter(item => item.commonsId === input.commonsId && now - item.at.getTime() < 7 * 86_400_000);
  if (week.length >= limits.maxPerWeekPerTrip) return { allowed: false, reason: "weekly_trip_limit", retryAt: new Date(Math.min(...week.map(item => item.at.getTime())) + 7 * 86_400_000) };
  return { allowed: true };
}

// ---- Reply routing ---------------------------------------------------------------------------------------------------------------------------------

export type RoutableTrip = { id: string; name: string; startsOn: string | null; endsOn: string | null };
export type RoutableQuestion = {
  id: string; commonsId: string; kind: "attendance" | "attendance_decline" | "poll" | "arrival" | "trip_choice" | "booking_review" | "money_review" | "money_info";
  version: string; options: ReadonlyArray<{ key: string; label: string; value: string }>; expiresAt: Date; askedAt: Date; approvalCode: string | null; heldMessageId: string | null;
};
export type RouteDecision =
  | { kind: "no_trips" }
  | { kind: "trip_choice_answer"; question: RoutableQuestion; tripId: string }
  | { kind: "clarify_trip"; trips: RoutableTrip[]; reask: RoutableQuestion | null }
  | { kind: "answer"; question: RoutableQuestion }
  | { kind: "stale"; tripId: string; question: RoutableQuestion; reason: "expired" }
  | { kind: "approval_mismatch"; tripId: string; question: RoutableQuestion }
  | { kind: "review_ambiguous"; tripId: string; question: RoutableQuestion }
  | { kind: "no_open_question"; tripId: string };

/** Summaries a person approves with SAVE and a code. A bare yes or no never touches these, or anything else while one is pending. */
const REVIEW_KINDS: ReadonlyArray<RoutableQuestion["kind"]> = ["booking_review", "money_review"];
function words(value: string) { return normalizeReply(value).split(" ").filter(word => word.length > 2 && !["the", "trip", "weekend", "and", "for"].includes(word)); }
/** Trips the message names. A trip is named when any of its distinctive words appears; two trips sharing a word are both named, which forces a clarification. */
export function tripsNamedIn(body: string, trips: readonly RoutableTrip[]) {
  const text = ` ${normalizeReply(body)} `;
  return trips.filter(trip => words(trip.name).some(word => text.includes(` ${word} `)));
}

/** A label that tells two trips apart even when they share a name. */
export function tripLabel(trip: RoutableTrip) {
  const date = trip.startsOn ? ` (${new Date(`${trip.startsOn}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})` : "";
  return `${trip.name}${date}`;
}

/**
 * Decide what a reply is about before anything is read or changed. The person is already identified and `trips` are only the trips this number is
 * enrolled in. Nothing here consults the model, and "latest trip joined", "nearest departure" and confidence are never routing evidence.
 */
export function routeInbound(input: { now: Date; body: string; trips: readonly RoutableTrip[]; open: readonly RoutableQuestion[]; lastOutboundQuestionId: string | null }): RouteDecision {
  const { now, body, trips } = input;
  if (!trips.length) return { kind: "no_trips" };
  const live = input.open.filter(question => trips.some(trip => trip.id === question.commonsId));
  const approval = parseApproval(body);

  // 1. A held request waits for a trip choice, and only a message that identifies a trip releases it.
  const choice = live.find(question => question.kind === "trip_choice");
  if (choice) {
    if (choice.expiresAt <= now) return { kind: "clarify_trip", trips: [...trips], reask: null };
    const picked = parseOptionReply(body, choice.options.map(option => ({ key: option.key, label: option.label })));
    const named = tripsNamedIn(body, trips);
    const tripId = picked ? choice.options.find(option => option.key === picked.key)?.value : named.length === 1 ? named[0]!.id : undefined;
    if (tripId && trips.some(trip => trip.id === tripId)) return { kind: "trip_choice_answer", question: choice, tripId };
    return { kind: "clarify_trip", trips: [...trips], reask: choice };
  }

  // 2. Which trip. An explicit name wins; one enrolled trip is unambiguous; otherwise only a fresh sole open question may attach itself.
  const named = tripsNamedIn(body, trips);
  let tripId: string | null = null;
  if (named.length === 1) tripId = named[0]!.id;
  else if (named.length > 1) return { kind: "clarify_trip", trips: named, reask: null };
  else if (trips.length === 1) tripId = trips[0]!.id;
  else {
    const candidates = live.filter(question => question.expiresAt > now);
    const only = candidates.length === 1 ? candidates[0]! : null;
    // An approval code is itself a reference to one pending review, which is more specific than any trip name.
    const byCode = approval.code ? candidates.find(question => REVIEW_KINDS.includes(question.kind) && question.approvalCode === approval.code) : undefined;
    if (byCode) tripId = byCode.commonsId;
    else if (only && input.lastOutboundQuestionId === only.id && now.getTime() - only.askedAt.getTime() <= FRESH_REPLY_MS) tripId = only.commonsId;
    else return { kind: "clarify_trip", trips: [...trips], reask: null };
  }

  // 3. The question in that trip.
  const inTrip = live.filter(question => question.commonsId === tripId);
  const reviews = inTrip.filter(question => REVIEW_KINDS.includes(question.kind));
  // SAVE names its summary by code. DISCARD names nothing, so it goes to whatever was just asked: a money question offers it too.
  const lastAsked = inTrip.find(question => question.id === input.lastOutboundQuestionId);
  if (approval.action === "decline" && lastAsked?.kind === "money_info") return { kind: "answer", question: lastAsked };
  const review = (approval.code ? reviews.find(question => question.approvalCode === approval.code) : undefined)
    ?? (approval.action === "decline" && lastAsked && reviews.includes(lastAsked) ? lastAsked : undefined)
    ?? reviews[0];
  if (review && approval.action !== "none") {
    if (review.expiresAt <= now) return { kind: "stale", tripId, question: review, reason: "expired" };
    if (approval.action === "save" && approval.code !== review.approvalCode) return { kind: "approval_mismatch", tripId, question: review };
    return { kind: "answer", question: review };
  }
  // A pending booking review makes a bare yes/no ambiguous between that review and any other open question, so it is applied to neither.
  if (review && review.expiresAt > now && approval.action === "none" && ["yes", "y", "yep", "yeah", "yup", "sure", "ok", "okay", "no", "n", "nope", "nah"].includes(normalizeReply(body))) return { kind: "review_ambiguous", tripId, question: review };
  const others = inTrip.filter(question => !reviews.includes(question));
  const question = others.find(item => item.id === input.lastOutboundQuestionId) ?? others.sort((a, b) => b.askedAt.getTime() - a.askedAt.getTime())[0];
  if (!question) return { kind: "no_open_question", tripId };
  if (question.expiresAt <= now) return { kind: "stale", tripId, question, reason: "expired" };
  return { kind: "answer", question };
}
