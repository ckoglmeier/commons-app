/** Format a stored local clock without changing its timezone or inventing a time. */
export function clockTime(value: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value ?? "");
  if (!match) return value || "Time not set";
  const hour = Number(match[1]);
  if (hour > 23 || Number(match[2]) > 59) return value!;
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}
