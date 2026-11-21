/*
 * Answering "what's next?" and "what's the address for dinner?" by text. Pure and deterministic: no model, no guessing. It reads only the records it is
 * given, which are the person's own permission-filtered view of the trip. A question it recognizes but can't answer from saved records is "unknown",
 * never a nearby fact. Anything it doesn't recognize as a question about the plan is "none", and it stays the caller's to handle.
 */
import type { ItineraryItem, Stay, TravelPlan } from "@commons/contracts";
import { normalizeReply } from "./messaging";

export type PlanQuestionInput = {
  body: string; now: Date; timezone: string; tripName: string; startsOn: string | null; endsOn: string | null; personId: string;
  itinerary: readonly ItineraryItem[]; stays: readonly Stay[]; travelPlans: readonly TravelPlan[];
};
/** `not_on_stay`: the person is on no stay, but the group has a booked one they can see. Only its name and how many people are on it are given. */
export type PlanAnswer = { kind: "none" } | { kind: "unknown" } | { kind: "answer"; text: string } | { kind: "not_on_stay"; stayName: string; people: number };

const LIST_LIMIT = 4;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT_WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NOISE = new Set(["the", "and", "for", "are", "our", "you", "your", "what", "whats", "where", "wheres", "when", "whens", "which", "time", "how", "does", "did", "address", "location", "place", "plan", "planned", "plans", "schedule", "itinerary", "agenda", "today", "tomorrow", "tonight", "start", "starts", "begin", "begins", "going", "get", "there", "this", "that", "with", "next", "have", "has", "was", "will", "can", "trip", "weekend", "day", "morning", "afternoon", "evening", "night", "doing", "happening", "meet", "meeting", "need", "should", "from", "again", "about", "know", "tell", "please", "first", "after", "then", "now", "directions", "activity", "activities", "event", "thing", "here", "hey", "any", "all", "out", "stay", "staying", "date", "dates", ...WEEKDAYS, ...SHORT_WEEKDAYS, ...MONTHS]);
const STAY_WORDS = /\b(stay|staying|lodging|hotel|airbnb|vrbo|house|cabin|rental|sleep|sleeping|check in|checkin|check out|checkout)\b/;
const WHERE_WORDS = /\b(where|wheres|address|location|directions|how do i get|how do we get)\b/;
const WHEN_WORDS = /\b(when|whens|what time|time)\b/;
const QUESTION_START = /^(where|wheres|when|whens|what|whats|which|how|is|are|do|does|did|can|could|time|address|any)\b/;

const dayLabel = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const localDate = (date: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const localHour = (iso: string, timeZone: string) => Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(new Date(iso)));
const clock = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const wallClock = (value: string) => { const [hour, minute] = value.split(":").map(Number) as [number, number]; return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`; };
const addDays = (value: string, days: number) => new Date(Date.parse(`${value}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const stem = (word: string) => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
const wordsOf = (value: string) => normalizeReply(value).split(" ").filter(word => word.length > 2 && !NOISE.has(word)).map(stem);

const itemDate = (item: ItineraryItem, timeZone: string) => item.startsAt ? localDate(new Date(item.startsAt), timeZone) : item.scheduledDate ?? null;
/** What this person can be told is on: scheduled or confirmed, and not a subgroup activity they aren't part of. An idea isn't a plan. */
const relevant = (item: ItineraryItem, personId: string) => ["planned", "confirmed"].includes(item.status) && (item.participantScope !== "subgroup" || (item.participantIds ?? []).includes(personId));
const byTime = (a: ItineraryItem, b: ItineraryItem) => (a.startsAt ?? `${a.scheduledDate}T23:59`).localeCompare(b.startsAt ?? `${b.scheduledDate}T23:59`);

/** A meal saved under a restaurant's name has no "dinner" in its title, so a meal also answers to the time it happens. */
function mealWord(item: ItineraryItem, timeZone: string) {
  if (!item.mealType || !item.startsAt) return null;
  const hour = localHour(item.startsAt, timeZone);
  return hour < 11 ? ["breakfast", "brunch"] : hour < 16 ? ["lunch", "brunch"] : ["dinner", "supper"];
}

function matchingItems(items: readonly ItineraryItem[], asked: readonly string[], timeZone: string, tripWords: ReadonlySet<string>) {
  const wanted = asked.filter(word => !tripWords.has(word));
  if (!wanted.length) return [];
  const scored = items.map(item => {
    const title = new Set(wordsOf(item.title));
    const meal = mealWord(item, timeZone) ?? [];
    return { item, score: wanted.filter(word => title.has(word) || meal.includes(word)).length };
  }).filter(entry => entry.score > 0);
  const best = Math.max(0, ...scored.map(entry => entry.score));
  return scored.filter(entry => entry.score === best).map(entry => entry.item);
}

/** The date a message refers to. A weekday means that day on the trip if the trip has one, otherwise the next one coming. */
export function askedDate(text: string, input: Pick<PlanQuestionInput, "now" | "timezone" | "startsOn" | "endsOn">) {
  const today = localDate(input.now, input.timezone);
  if (/\b(today|tonight)\b/.test(text)) return today;
  if (/\btomorrow\b/.test(text)) return addDays(today, 1);
  const words = text.split(" ");
  const weekday = words.findIndex(word => WEEKDAYS.includes(word) || SHORT_WEEKDAYS.includes(word));
  if (weekday >= 0) {
    const word = words[weekday]!, target = WEEKDAYS.includes(word) ? WEEKDAYS.indexOf(word) : SHORT_WEEKDAYS.indexOf(word);
    const weekdayOf = (value: string) => new Date(`${value}T12:00:00Z`).getUTCDay();
    if (input.startsOn && input.endsOn) for (let cursor = input.startsOn; cursor <= input.endsOn; cursor = addDays(cursor, 1)) if (weekdayOf(cursor) === target) return cursor;
    for (let offset = 0; offset < 7; offset++) { const candidate = addDays(today, offset); if (weekdayOf(candidate) === target) return candidate; }
  }
  const named = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* (\d{1,2})\b/);
  if (named) {
    const month = String(MONTHS.indexOf(named[1]!) + 1).padStart(2, "0"), day = String(Number(named[2])).padStart(2, "0"), year = (input.startsOn ?? today).slice(0, 4), candidate = `${year}-${month}-${day}`;
    return Number.isNaN(Date.parse(candidate)) ? null : candidate;
  }
  return null;
}

function describe(item: ItineraryItem, timeZone: string, options: { place?: boolean } = {}) {
  const date = itemDate(item, timeZone);
  const when = item.startsAt ? `${dayLabel(date!)}, ${clock(item.startsAt, timeZone)}` : date ? `${dayLabel(date)}, time not set` : "day not set";
  return `${when}: ${item.title}${options.place !== false && item.location ? ` at ${item.location}` : ""}`;
}
const list = (items: readonly ItineraryItem[], timeZone: string) => {
  const shown = items.slice(0, LIST_LIMIT).map(item => describe(item, timeZone)).join(". ");
  return items.length > LIST_LIMIT ? `${shown}. And ${items.length - LIST_LIMIT} more on the trip page.` : `${shown}.`;
};

function answerAboutItem(item: ItineraryItem, text: string, timeZone: string): string {
  const wantsPlace = WHERE_WORDS.test(text), wantsTime = WHEN_WORDS.test(text);
  if (wantsPlace && !wantsTime) return item.location ? `${item.title}: ${item.location}.` : `${item.title} is saved, but it has no place yet.`;
  if (wantsTime && !wantsPlace && !item.startsAt) {
    const date = itemDate(item, timeZone);
    return date ? `${item.title} is on ${dayLabel(date)}. It has no time yet.` : `${item.title} is saved, but it has no day yet.`;
  }
  return `${describe(item, timeZone)}.`;
}

function answerAboutStay(text: string, input: PlanQuestionInput): PlanAnswer {
  const saved = input.stays.filter(stay => stay.status !== "considering");
  const stays = saved.filter(stay => stay.includedPersonIds.includes(input.personId)).slice(0, 2);
  if (!stays.length) {
    const today = localDate(input.now, input.timezone);
    const booked = saved.filter(stay => stay.status === "confirmed" && stay.includedPersonIds.length > 0 && stay.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
    return booked ? { kind: "not_on_stay", stayName: booked.name, people: booked.includedPersonIds.length } : { kind: "unknown" };
  }
  const wantsIn = /\b(check in|checkin)\b/.test(text), wantsOut = /\b(check out|checkout)\b/.test(text);
  const parts = stays.map(stay => {
    if (wantsIn) return `${stay.name}: check-in is ${dayLabel(stay.startsOn)}${stay.checkInTime ? ` at ${wallClock(stay.checkInTime)}` : ". No time is saved"}.`;
    if (wantsOut) return `${stay.name}: check-out is ${dayLabel(stay.endsOn)}${stay.checkOutTime ? ` at ${wallClock(stay.checkOutTime)}` : ". No time is saved"}.`;
    return `${stay.name}${stay.address ? `, ${stay.address}` : ""}. ${dayLabel(stay.startsOn)} to ${dayLabel(stay.endsOn)}.`;
  });
  return { kind: "answer", text: parts.join(" ") };
}

function answerAboutOwnTravel(input: PlanQuestionInput): PlanAnswer {
  const own = input.travelPlans.filter(plan => ["arrival", "departure"].includes(plan.kind) && (plan.personIds ?? [plan.personId]).includes(input.personId))
    .sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
  if (!own.length) return { kind: "unknown" };
  return { kind: "answer", text: own.slice(0, 2).map(plan => `${plan.kind === "arrival" ? "Getting there" : "Heading home"}: ${dayLabel(plan.date)}${plan.time ? ` at ${wallClock(plan.time)}` : ""}, ${plan.route}.`).join(" ") };
}

export function answerPlanQuestion(input: PlanQuestionInput): PlanAnswer {
  const text = normalizeReply(input.body), raw = input.body.trim();
  const timeZone = input.timezone, today = localDate(input.now, timeZone);
  if (!text) return { kind: "none" };
  const items = input.itinerary.filter(item => relevant(item, input.personId) && itemDate(item, timeZone)).sort(byTime);
  const tripWords = new Set(wordsOf(input.tripName));
  const asked = wordsOf(text);
  const isQuestion = raw.endsWith("?") || QUESTION_START.test(text) || /\b(whats|where|when) /.test(text);
  const day = askedDate(text, input);

  // Their own travel, before item matching so "my flight" never reads as a shared activity.
  if (/\b(my flight|my flights|i land|i arrive|i fly|i leave|i depart|my arrival|my departure)\b/.test(text) && isQuestion) return answerAboutOwnTravel(input);

  const matched = isQuestion ? matchingItems(items, asked, timeZone, tripWords) : [];
  if (matched.length) {
    const onDay = day ? matched.filter(item => itemDate(item, timeZone) === day) : matched;
    if (day && !onDay.length) return { kind: "answer", text: `Nothing like that is saved for ${dayLabel(day)}.` };
    const upcoming = onDay.filter(item => item.startsAt ? new Date(item.startsAt) >= input.now : itemDate(item, timeZone)! >= today);
    return { kind: "answer", text: answerAboutItem(upcoming[0] ?? onDay.at(-1)!, text, timeZone) };
  }

  if (STAY_WORDS.test(text) && isQuestion) return answerAboutStay(text, input);

  if (day && (isQuestion || /\b(plan|schedule|happening)\b/.test(text))) {
    const onDay = items.filter(item => itemDate(item, timeZone) === day && (!/\btonight\b/.test(text) || !item.startsAt || localHour(item.startsAt, timeZone) >= 16));
    return { kind: "answer", text: onDay.length ? list(onDay, timeZone) : `Nothing is saved for ${dayLabel(day)} yet.` };
  }

  if (/\b(next|up next|now)\b/.test(text) && (isQuestion || /^(next|up next)$/.test(text))) {
    const next = items.find(item => item.startsAt ? new Date(item.startsAt) > input.now : itemDate(item, timeZone)! > today);
    return next ? { kind: "answer", text: `Next up: ${describe(next, timeZone)}.` } : { kind: "unknown" };
  }

  if (/\b(plan|plans|planned|schedule|itinerary|agenda|activities|happening|doing)\b/.test(text) && (isQuestion || text.split(" ").length <= 3)) {
    const upcoming = items.filter(item => item.startsAt ? new Date(item.startsAt) > input.now : itemDate(item, timeZone)! >= today);
    return upcoming.length ? { kind: "answer", text: list(upcoming, timeZone) } : { kind: "unknown" };
  }

  // About the trip itself. "When is the hike?" names something else, so it isn't answered with the trip's dates.
  const aboutTrip = /\b(what dates?|the dates|trip dates|when (is|does|do|are) (the trip|it|this|we)|start|starts|begin|begins|when do we (leave|go))\b/.test(text);
  const unknownThing = asked.some(word => !tripWords.has(word));
  if (isQuestion && aboutTrip && !unknownThing) {
    if (!input.startsOn) return { kind: "unknown" };
    return { kind: "answer", text: `${dayLabel(input.startsOn)}${input.endsOn && input.endsOn !== input.startsOn ? ` to ${dayLabel(input.endsOn)}` : ""} (${timeZone}).` };
  }

  // "Where's the hike?" with no hike saved, or a bare "what's the address?" with no stay: asked about the plan, and it isn't there.
  if (isQuestion && (WHERE_WORDS.test(text) || WHEN_WORDS.test(text))) return /\baddress\b/.test(text) && !unknownThing ? answerAboutStay(text, input) : { kind: "unknown" };
  return { kind: "none" };
}
