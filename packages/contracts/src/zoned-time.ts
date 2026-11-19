/*
 * Local wall-clock time in an IANA zone <-> an instant. Pure and browser-safe so the plan review (which shows and edits an item's own local
 * date and time) and the server apply use one conversion. Null (never a guess) when the zone or the value is not valid.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" });
    formatters.set(timeZone, cached);
  }
  return cached;
}

function localFields(instantMs: number, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(new Date(instantMs)).reduce<Record<string, number>>((all, part) => (part.type === "literal" ? all : { ...all, [part.type]: Number(part.value) }), {});
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour === 24 ? 0 : parts.hour, minute: parts.minute };
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** The date ("YYYY-MM-DD") and clock time ("HH:MM") an instant has in a zone. */
export function instantToZonedLocal(instant: string | Date, timeZone: string): { date: string; time: string } | null {
  const ms = new Date(instant).getTime();
  if (!Number.isFinite(ms)) return null;
  try {
    const local = localFields(ms, timeZone);
    return { date: `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`, time: `${pad(local.hour)}:${pad(local.minute)}` };
  } catch { return null; }
}

/** The instant (ISO string) at which a zone's wall clock reads `date` "YYYY-MM-DD" and `time` "HH:MM". Null when either is invalid. */
export function zonedLocalToInstant(date: string, time: string, timeZone: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date), timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day, hour, minute] = [...dateMatch.slice(1), ...timeMatch.slice(1)].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(wanted).getUTCDate() !== day) return null;
  try {
    let instant = wanted;
    // Two passes settle across a daylight-saving change.
    for (let pass = 0; pass < 2; pass += 1) {
      const local = localFields(instant, timeZone);
      instant -= Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - wanted;
    }
    const check = localFields(instant, timeZone);
    if (Date.UTC(check.year, check.month - 1, check.day, check.hour, check.minute) !== wanted) return null;
    return new Date(instant).toISOString();
  } catch { return null; }
}
