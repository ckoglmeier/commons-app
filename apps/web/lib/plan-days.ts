export type DayOption = { id: string; day: string; date: string; outsideTrip?: boolean };

export function tripDays(startsOn: string | null, endsOn: string | null): DayOption[] {
  const firstKnownDay = startsOn ?? endsOn;
  const lastKnownDay = endsOn ?? startsOn;
  if (!firstKnownDay || !lastKnownDay) return [];

  const start = new Date(`${firstKnownDay}T12:00:00Z`);
  const end = new Date(`${lastKnownDay}T12:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return [];

  const days: DayOption[] = [];
  for (let current = start; current <= end && days.length < 31; current = new Date(current.valueOf() + 86_400_000)) {
    days.push({
      id: current.toISOString().slice(0, 10),
      day: new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(current),
      date: new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(current),
    });
  }
  return days;
}

export function selectedPlanDay(days: DayOption[], selectedDay: string) {
  return days.find((day) => day.id === selectedDay) ?? null;
}

/** Activity dates do not silently become event dates, but must remain reachable. */
export function planDays(startsOn: string | null, endsOn: string | null, activityDates: string[]): DayOption[] {
  const days = new Map(tripDays(startsOn, endsOn).map(day => [day.id, day]));
  for (const date of activityDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) continue;
    if (!days.has(date)) days.set(date, { ...tripDays(date, date)[0], outsideTrip: Boolean(startsOn || endsOn) });
  }
  return [...days.values()].sort((a, b) => a.id.localeCompare(b.id));
}
