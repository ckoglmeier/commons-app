/** Elapsed minutes, independent of an activity's date or timezone. */
export function itineraryDurationMinutes(item: { durationMinutes?: number | null; startsAt?: string | null; endsAt?: string | null }): number | null {
  if (item.durationMinutes != null) return item.durationMinutes;
  if (!item.startsAt || !item.endsAt) return null;
  const minutes = (Date.parse(item.endsAt) - Date.parse(item.startsAt)) / 60_000;
  return Number.isFinite(minutes) && minutes > 0 ? Math.max(1, Math.round(minutes)) : null;
}

export function itineraryEndTime(startsAt: string | null, durationMinutes: number | null): string | undefined {
  return startsAt && durationMinutes != null
    ? new Date(Date.parse(startsAt) + durationMinutes * 60_000).toISOString()
    : undefined;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} hr` : "", remainder ? `${remainder} min` : ""].filter(Boolean).join(" ");
}
