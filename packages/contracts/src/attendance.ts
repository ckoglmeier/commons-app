import { z } from "zod";

export const SetEventAttendanceSchema = z.object({
  commandId: z.string().uuid(),
  state: z.enum(["helping", "attending", "declined"]),
  reviewedDates: z.string().max(100),
});

export const EventAttendanceSchema = z.object({
  dates: z.string(),
  startsOn: z.string().nullable(),
  endsOn: z.string().nullable(),
  currentPersonId: z.string().uuid(),
  reportedAttendance: z.object({ turnId: z.string().uuid(), source: z.string().max(240) }).nullable().optional(),
  people: z.array(z.object({
    personId: z.string().uuid(),
    displayName: z.string(),
    state: z.enum(["helping", "attending", "declined", "needs_confirmation"]),
  })),
});
export type EventAttendance = z.infer<typeof EventAttendanceSchema>;

// Dates are the evidence being approved, not the mutable event update timestamp.
export function eventAttendanceDates(startsOn: string | null, endsOn: string | null) {
  return `${startsOn ?? "unset"}/${endsOn ?? "unset"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) } : null;
}
/**
 * Trip dates are calendar dates in the trip's own timezone (no time of day), so they format without any timezone shift:
 * "Feb 12–15, 2027", "Feb 28 – Mar 2, 2027", "Dec 30, 2026 – Jan 2, 2027". Anything that is not a plain date is returned as given.
 */
export function formatTripDateRange(startsOn: string, endsOn: string) {
  const start = dateParts(startsOn), end = dateParts(endsOn);
  if (!start || !end) return `${startsOn} – ${endsOn}`;
  const first = `${MONTHS[start.month]} ${start.day}`, last = `${MONTHS[end.month]} ${end.day}`;
  if (start.year !== end.year) return `${first}, ${start.year} – ${last}, ${end.year}`;
  if (start.month === end.month && start.day === end.day) return `${first}, ${start.year}`;
  return start.month === end.month ? `${first}–${end.day}, ${start.year}` : `${first} – ${last}, ${start.year}`;
}

// A statement about the speaker. Beyond "I'm attending", only phrasings that name the WHOLE trip are accepted ("I'll be there for the whole
// trip", "Count me in for the whole trip", "I'm coming on the trip"); a bare "I'm coming" or "I'll be there" could mean dinner and stays unmatched.
const ATTENDANCE_STATEMENT = /^(?:yes[,!]?\s+)?(?:I(?:'m| am)\s+(?:definitely\s+)?attending|we(?:'re| are)\s+(?:both\s+|all\s+)?attending|both of us are attending|[\p{L}][\p{L} '-]{0,60} and I are\s+(?:both\s+)?attending|(?:confirm|save|record|mark) my attendance(?: as attending)?|I(?:'ll| will) be there for (?:the|this) whole trip|count me in for (?:the|this) whole trip|I(?:'m| am) coming (?:on|for) (?:the|this) (?:whole )?trip)(?:\s+(?:the (?:whole )?trip|this (?:whole )?trip|for (?:the|this) (?:whole )?trip))?[.!]?$/iu;

/** A narrow, explicit statement about the speaker. Never infer an RSVP from a question or an activity. */
export function reportsOwnAttendance(text: string): boolean {
  const value = text.trim().replace(/[’‘]/g, "'");
  if (value.length > 240 || /[?"\n]|\b(if|might|maybe|not|n't|unless|probably|hope|said|says|would|could)\b/i.test(value)) return false;
  return ATTENDANCE_STATEMENT.test(value);
}

/** Newer uncertainty or an explicit response supersedes an earlier conversational report. */
export function latestOwnAttendanceReport(turns: Array<{ id: string; userText: string; createdAt: Date }>, responseUpdatedAt: Date) {
  const latest = turns.find(turn => /\b(?:attend\w*|coming|going|rsvp)\b|\bcount me in for (?:the|this) whole trip\b|\bbe there for (?:the|this) whole trip\b/i.test(turn.userText));
  return latest && latest.createdAt > responseUpdatedAt && reportsOwnAttendance(latest.userText)
    ? { turnId: latest.id, source: latest.userText } : null;
}

/** Resolve only explicit attendance language against the active trip roster. */
export function attendanceStatementTargets(text: string, actorId: string, people: Array<{ personId: string; displayName: string }>): string[] | null {
  if (!reportsOwnAttendance(text)) return null;
  const value = text.trim().replace(/[’‘]/g, "'").replace(/^yes[,!]?\s+/i, "");
  if (/^I(?:'m| am| will)\b|^I'll\b|^count me in\b|^(?:confirm|save|record|mark) my attendance/i.test(value)) return [actorId];
  if (/^(?:we(?:'re| are)\s+both|both of us)/i.test(value)) return people.length === 2 ? people.map(p => p.personId) : null;
  if (/^we(?:'re| are)\s+all/i.test(value)) return people.map(p => p.personId);
  const named = value.match(/^(.+?) and I are\s+(?:both\s+)?attending/i)?.[1].toLowerCase();
  if (named) {
    const matches = people.filter(p => p.personId !== actorId && (p.displayName.toLowerCase() === named || p.displayName.split(/\s+/)[0].toLowerCase() === named));
    return matches.length === 1 ? [actorId, matches[0].personId] : null;
  }
  return null;
}
