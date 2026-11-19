import { z } from "zod";

export const PollAvailabilitySchema = z.object({
  mode: z.enum(["days", "ranges", "times"]),
  timezone: z.string().max(100).refine(value => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid timezone, such as America/Denver."),
});
export const PollScheduleSchema = z.object({
  startsOn: z.iso.date({ message: "Add a valid date for each option." }),
  endsOn: z.iso.date({ message: "Add a valid end date for each option." }),
  startTime: z.string().regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a valid start time."),
  endTime: z.string().regex(/^$|^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use a valid end time."),
});
export type PollAvailability = z.infer<typeof PollAvailabilitySchema>;
export type PollSchedule = z.infer<typeof PollScheduleSchema>;

/** Calendar dates and wall-clock times, never inferred instants or event dates. */
export function formatPollSchedule(schedule: PollSchedule, availability: PollAvailability): string {
  const date = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "Choose a date";
  const time = (value: string) => {
    if (!/^\d{2}:\d{2}$/.test(value)) return "Choose a time";
    const [hour, minute] = value.split(":").map(Number);
    return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  };
  const days = schedule.startsOn === schedule.endsOn ? date(schedule.startsOn) : `${date(schedule.startsOn)} – ${date(schedule.endsOn)}`;
  return availability.mode === "times" ? `${days} · ${time(schedule.startTime)}–${time(schedule.endTime)} · ${availability.timezone}` : days;
}

/** One date range at one place, offered as a single combined choice. */
export const PollAlternativeSchema = z.object({
  startsOn: z.iso.date({ message: "Add a valid start date." }),
  endsOn: z.iso.date({ message: "Add a valid end date." }),
  place: z.string().trim().min(1).max(60),
}).strict();
export type PollAlternative = z.infer<typeof PollAlternativeSchema>;
export function formatAlternativeLabel(alternative: PollAlternative) {
  const days = formatPollSchedule({ startsOn: alternative.startsOn, endsOn: alternative.endsOn, startTime: "", endTime: "" }, { mode: "ranges", timezone: "UTC" });
  return `${days} · ${alternative.place}`;
}
