/*
 * Booking intake by message. Pure: classification, uncertainty and the review text. Message content is untrusted data. Nothing in
 * it is ever read as an instruction; the only things taken from it are the supported booking fields, validated against ConfirmationDraftSchema.
 */
import type { ConfirmationDraft, Stay, TravelPlan } from "@commons/contracts";
import { readLocalDate, readLocalTime } from "./flight-itinerary";

/** Controls, bidirectional overrides and zero-width characters are removed; length is bounded. Text stays text. */
export function sanitizeInbound(text: string, max = 20_000) {
  // The pattern is the point: it names exactly the control and invisible characters to strip.
  // eslint-disable-next-line no-control-regex, no-irregular-whitespace
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, "").replace(/\r\n?/g, "\n").slice(0, max);
}

export function extractLinks(text: string) {
  const links: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')]+/gi)) {
    try { const url = new URL(match[0].replace(/[.,;!?]+$/, "")); if (["http:", "https:"].includes(url.protocol)) links.push(url.toString()); } catch { /* not a link */ }
  }
  return [...new Set(links)].slice(0, 3);
}

/** A cheap first screen so ordinary chat never becomes an intake. A false positive costs one clarification, not a saved record. */
export function looksLikeBooking(text: string) {
  const score = (text.match(/\b(confirmation|reservation|booking|itinerary|e-?ticket|record locator|check[- ]?in|check[- ]?out|boarding|flight|airline|departs?|arrives?|rental car|pick[- ]?up|hotel|airbnb|vrbo)\b/gi) ?? []).length;
  const hasDate = /\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2})\b/i.test(text);
  const hasCode = /\b(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{5,8}\b|\b[A-Z]{6}\b/.test(text);
  return text.trim().length >= 40 && score >= 2 && (hasDate || hasCode);
}

export function isCancellationText(text: string) {
  return /\b(has been|is|was|been)\s+cancell?ed\b|\bcancell?ation (confirmation|notice|number)\b|\bwe(?:'ve| have) cancell?ed\b|\byour (?:reservation|booking|flight|stay) (?:is|was|has been) cancell?ed\b/i.test(text);
}

export type SavedTravel = { plans: readonly TravelPlan[]; stays: readonly Stay[] };
export type BookingClassification = {
  classification: "new" | "duplicate" | "change" | "cancellation";
  matchedPlanIds: string[]; matchedStayId: string | null; reason: string;
};

const code = (value: string | null | undefined) => (value ?? "").trim().toUpperCase();
const sameDay = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a === b);

/**
 * Compare a draft with what this person can already see as theirs. A matching confirmation code (or, without one, the same kind and start date)
 * identifies the existing record. The result is a proposal: a change or cancellation is applied only after the person approves that exact version.
 */
export function classifyBooking(draft: ConfirmationDraft, saved: SavedTravel, personId: string, text: string): BookingClassification {
  const own = saved.plans.filter(plan => plan.personId === personId);
  const cancelled = isCancellationText(text);
  const draftCode = code(draft.confirmationCode);
  if (draft.kind === "flight") {
    const legs = (draft.travelSegments ?? []).filter(segment => segment.date);
    const byCode = draftCode ? own.filter(plan => ["arrival", "departure"].includes(plan.kind) && code(plan.confirmationCode) === draftCode) : [];
    // A person has one flight there and one flight home. A different booking of the same kind would replace it, so it is a change, never "new".
    const byKind = own.filter(plan => legs.some(leg => leg.kind === plan.kind));
    const matched = byCode.length ? byCode : byKind;
    if (cancelled && byCode.length) return { classification: "cancellation", matchedPlanIds: byCode.map(plan => plan.id), matchedStayId: null, reason: "The message says this reservation was cancelled and its code matches a saved flight." };
    if (matched.length) {
      const identical = legs.length > 0 && legs.every(leg => matched.some(plan => plan.kind === leg.kind && plan.date === leg.date && (plan.time ?? null) === (leg.time ?? null) && plan.route === (leg.route ?? plan.route)));
      return { classification: identical ? "duplicate" : "change", matchedPlanIds: matched.map(plan => plan.id), matchedStayId: null, reason: identical ? "These flights are already saved." : "You already have a saved flight of this kind. Saving would replace it." };
    }
    return { classification: "new", matchedPlanIds: [], matchedStayId: null, reason: "No saved flight matches." };
  }
  if (draft.kind === "stay") {
    const stays = saved.stays.filter(stay => stay.includedPersonIds.includes(personId));
    const byCode = draftCode ? stays.find(stay => code(stay.confirmationCode) === draftCode) : undefined;
    const byDates = stays.find(stay => stay.startsOn === draft.startsOn && (draft.name ? stay.name.toLowerCase() === draft.name.toLowerCase() : false));
    const match = byCode ?? byDates;
    if (match && cancelled && byCode) return { classification: "cancellation", matchedPlanIds: [], matchedStayId: match.id, reason: "The message says this stay was cancelled and its code matches a saved stay." };
    if (match) {
      const identical = match.startsOn === draft.startsOn && match.endsOn === draft.endsOn && (!draft.name || match.name === draft.name);
      return { classification: identical ? "duplicate" : "change", matchedPlanIds: [], matchedStayId: match.id, reason: identical ? "This stay is already saved." : "A stay with this confirmation code is already saved, with different dates or name." };
    }
    return { classification: "new", matchedPlanIds: [], matchedStayId: null, reason: "No saved stay matches." };
  }
  const rentals = own.filter(plan => plan.kind === "car_rental");
  const byCode = draftCode ? rentals.find(plan => code(plan.confirmationCode) === draftCode) : undefined;
  const match = byCode ?? rentals.find(plan => sameDay(plan.date, draft.startsOn));
  if (match && cancelled && byCode) return { classification: "cancellation", matchedPlanIds: [match.id], matchedStayId: null, reason: "The message says this rental was cancelled and its code matches a saved rental." };
  if (match) {
    const identical = match.date === draft.startsOn && (match.time ?? null) === draft.startTime && (match.returnDate ?? null) === draft.endsOn;
    return { classification: identical ? "duplicate" : "change", matchedPlanIds: [match.id], matchedStayId: null, reason: identical ? "This rental is already saved." : "A rental with this confirmation code is already saved, with different details." };
  }
  return { classification: "new", matchedPlanIds: [], matchedStayId: null, reason: "No saved rental matches." };
}

/** Fields the person should double-check. These travel with the proposal and are shown, never hidden behind a confident summary. */
export function bookingUncertainty(draft: ConfirmationDraft): string[] {
  // A flight carries no cost in Commons, so the missing-total note is irrelevant there and would only add noise.
  const notes = draft.warnings.filter(note => !(draft.kind === "flight" && /booking total/i.test(note)));
  for (const segment of draft.travelSegments ?? []) {
    for (const link of segment.connections ?? []) {
      if (segment.kind === "arrival" && link.arrivalTime && !link.arrivalTimezone) notes.push(`Time zone not stated for the arrival time${link.destination ? ` at ${link.destination}` : ""}. It is shown as local time there.`);
      if (segment.kind === "departure" && link.departureTime && !link.departureTimezone) notes.push(`Time zone not stated for the departure time${link.origin ? ` at ${link.origin}` : ""}. It is shown as local time there.`);
    }
    if ((segment.connections ?? []).length === 0 && segment.time) notes.push(`Time zone not stated for the ${segment.kind === "arrival" ? "flight there" : "flight home"}. It is shown as the local time.`);
  }
  return [...new Set(notes)].slice(0, 8);
}

export type MissingField = { field: "address" | "startsOn" | "endsOn" | "arrivalTime" | "departureTime" | "arrivalDate" | "departureDate" | "route" | "name" | "flights"; question: string };

/** Consequential fields a save cannot do without. Each yields one focused question, asked one at a time. */
export function bookingMissing(draft: ConfirmationDraft): MissingField[] {
  const missing: MissingField[] = [];
  if (draft.kind === "flight") {
    const segments = draft.travelSegments ?? [];
    if (!segments.length) return [{ field: "flights", question: "I couldn't read the flight details. Paste the confirmation text again, or use the review page." }];
    for (const segment of segments) {
      const label = segment.kind === "arrival" ? "your flight there" : "your flight home";
      if (!segment.date) missing.push({ field: segment.kind === "arrival" ? "arrivalDate" : "departureDate", question: `What date is ${label}? Reply with the date, like Jun 12.` });
      else if (!segment.time) missing.push({ field: segment.kind === "arrival" ? "arrivalTime" : "departureTime", question: `What time does ${label} ${segment.kind === "arrival" ? "land" : "leave"}? Local time is fine, like 6:40 PM.` });
      if (!segment.route) missing.push({ field: "route", question: `Which airports is ${label}? Reply like SFO to JFK.` });
    }
  } else if (draft.kind === "stay") {
    if (!draft.name) missing.push({ field: "name", question: "What's the name of the place you're staying?" });
    if (!draft.startsOn) missing.push({ field: "startsOn", question: "What date do you check in? Reply with the date, like Jun 12." });
    if (!draft.endsOn) missing.push({ field: "endsOn", question: "What date do you check out? Reply with the date, like Jun 14." });
    if (!draft.address) missing.push({ field: "address", question: "What's the address of the place you're staying?" });
  } else {
    if (!draft.startsOn) missing.push({ field: "startsOn", question: "What date do you pick up the car? Reply with the date, like Jun 12." });
    if (!draft.route) missing.push({ field: "route", question: "Where do you pick up the car?" });
  }
  return missing;
}

/** Apply one focused answer. A reply that does not parse changes nothing and the question stays open. */
export function applyFocusedAnswer(draft: ConfirmationDraft, field: MissingField["field"], reply: string, referenceDate: string = new Date().toISOString().slice(0, 10)): ConfirmationDraft | null {
  const text = sanitizeInbound(reply, 300).trim();
  if (!text) return null;
  const next: ConfirmationDraft = structuredClone(draft);
  // A date without a year takes the year that lands nearest the trip, so "Jun 11" means the June of the trip, not of today.
  const reference = Date.parse(`${referenceDate}T12:00:00Z`);
  const date = readLocalDate(text) ?? [-1, 0, 1].map(offset => readLocalDate(`${text} ${new Date(reference).getUTCFullYear() + offset}`)).filter((value): value is string => Boolean(value))
    .sort((a, b) => Math.abs(Date.parse(a) - reference) - Math.abs(Date.parse(b) - reference))[0] ?? null;
  const time = readLocalTime(text);
  const segment = (kind: "arrival" | "departure") => (next.travelSegments ??= []).find(item => item.kind === kind);
  switch (field) {
    case "address": next.address = text.slice(0, 240); return next;
    case "name": next.name = text.slice(0, 160); return next;
    case "route": if (next.kind === "flight") { const s = (next.travelSegments ?? []).find(item => !item.route); if (!s) return null; s.route = text.slice(0, 120); delete s.connections; } else next.route = text.slice(0, 120); return next;
    case "startsOn": if (!date) return null; next.startsOn = date; return next;
    case "endsOn": if (!date) return null; next.endsOn = date; return next;
    // A corrected value no longer matches the parsed connections, so they are dropped rather than left contradicting the summary.
    case "arrivalDate": case "departureDate": { if (!date) return null; const s = segment(field === "arrivalDate" ? "arrival" : "departure"); if (!s) return null; s.date = date; delete s.connections; return next; }
    case "arrivalTime": case "departureTime": { if (!time) return null; const s = segment(field === "arrivalTime" ? "arrival" : "departure"); if (!s) return null; s.time = time; delete s.connections; return next; }
    default: return null;
  }
}

const clock = (value: string | null | undefined) => {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! >= 12 ? "PM" : "AM"}`;
};
const day = (value: string | null | undefined) => value ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }) : "date not found";

function flightLines(draft: ConfirmationDraft) {
  return (draft.travelSegments ?? []).map(segment => {
    const link = segment.kind === "arrival" ? segment.connections?.at(-1) : segment.connections?.[0];
    const zone = segment.kind === "arrival" ? link?.arrivalTimezone : link?.departureTimezone;
    const where = (segment.kind === "arrival" ? link?.destination : link?.origin) ?? null;
    const label = segment.kind === "arrival" ? "Flight there" : "Flight home";
    const clockPart = segment.time ? `${clock(segment.time)} ${zone ?? "(time zone not stated)"}${where ? ` at ${where}` : ""}` : "time not found";
    return `${label}: ${segment.route ?? "route not found"}, ${segment.kind === "arrival" ? "lands" : "leaves"} ${day(segment.date)}, ${clockPart}.`;
  });
}

export function bookingSummaryLines(draft: ConfirmationDraft) {
  if (draft.kind === "flight") return flightLines(draft);
  if (draft.kind === "stay") return [`Stay: ${draft.name ?? "name not found"}${draft.address ? `, ${draft.address}` : ""}. Check in ${day(draft.startsOn)}${draft.startTime ? ` at ${clock(draft.startTime)}` : ""}, check out ${day(draft.endsOn)}${draft.endTime ? ` at ${clock(draft.endTime)}` : ""}.`];
  return [`Car rental${draft.name ? ` with ${draft.name}` : ""}: pick up ${day(draft.startsOn)}${draft.startTime ? ` at ${clock(draft.startTime)}` : ""}${draft.route ? ` at ${draft.route}` : ""}${draft.endsOn ? `, return ${day(draft.endsOn)}` : ""}.`];
}

/** Exactly what will be visible to others if this is saved. Stated plainly, before the person approves. */
export function sharingLine(draft: ConfirmationDraft) {
  if (draft.kind === "flight") return "Your route and local times will show to the trip. Your confirmation code and the original message stay private.";
  if (draft.kind === "stay") return "This is saved for you only. You can add travelers on the Travel page. The confirmation code stays private.";
  return "This is saved for you only. The confirmation code stays private.";
}
