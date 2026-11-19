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
