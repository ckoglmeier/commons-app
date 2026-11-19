type StructuredObject = Record<string, unknown>;
type Resolve = (value: unknown) => StructuredObject | undefined;
type Text = (value: string | undefined, limit: number) => string | undefined;
const days: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun", PublicHolidays: "Public holidays" };
const shortDays: Record<string, string> = { Mo: "Mon", Tu: "Tue", We: "Wed", Th: "Thu", Fr: "Fri", Sa: "Sat", Su: "Sun", PH: "Public holidays" };
const array = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
function clock(value: unknown) {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}
function day(value: unknown) {
  const name = typeof value === "string" ? value : value && typeof value === "object" ? (value as StructuredObject)["@id"] : undefined;
  return typeof name === "string" ? days[name.replace(/^https?:\/\/schema\.org\//, "")] : undefined;
}
function date(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value) || !Number.isFinite(Date.parse(value))) return undefined;
  const calendarDate = value.slice(0, 10);
  if (new Date(calendarDate).toISOString().slice(0, 10) !== calendarDate) return undefined;
  return value;
}

/** Publisher facts only. No trip-date availability calculation or inferred closed days. */
export function publishedVenueDetails(venue: StructuredObject | undefined, resolve: Resolve, text: Text, visiblePolicy?: string): string | undefined {
  if (!venue) return undefined;
  function specification(value: unknown) {
    const item = resolve(value);
    if (!item) return undefined;
    const rawDays = array(item.dayOfWeek), labels = rawDays.map(day);
    const from = item.validFrom === undefined ? undefined : date(item.validFrom);
    const through = item.validThrough === undefined ? undefined : date(item.validThrough);
    if (labels.some(label => !label) || (item.validFrom !== undefined && !from) || (item.validThrough !== undefined && !through)) return undefined;
    if (!labels.length && !from && !through) return undefined;
    if (from && through && Date.parse(through) < Date.parse(from)) return undefined;
    const opens = clock(item.opens), closes = clock(item.closes);
    // Incomplete/equal endpoints have inconsistent publisher meanings. Do not infer closure or 24-hour access.
    if (!opens || !closes || opens === closes) return undefined;
    const dates = [from ? `from ${from}` : "", through ? `through ${through}` : ""].filter(Boolean).join(" ");
    const overnight = String(item.closes) < String(item.opens) ? " (next day)" : "";
    return `${labels.join(", ")}${labels.length && dates ? " " : ""}${dates}: ${opens}–${closes}${overnight}`;
  }
  function rawHours(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const match = value.trim().match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:[,-](?:Mo|Tu|We|Th|Fr|Sa|Su|PH))*)\s+((?:[01]\d|2[0-3]):[0-5]\d)-((?:[01]\d|2[0-3]):[0-5]\d)$/);
    if (!match) return text(value, 2000);
    const names = match[1].replace(/Mo|Tu|We|Th|Fr|Sa|Su|PH/g, token => shortDays[token]);
    return `${names}: ${clock(match[2])}–${clock(match[3])}${match[3] < match[2] ? " (next day)" : ""}`;
  }
  const raw = array(venue.openingHours).map(rawHours);
  const regular = array(venue.openingHoursSpecification).map(specification);
  const special = array(venue.specialOpeningHoursSpecification).map(specification);
  const pieces: string[] = [];
  if (raw.length || regular.length || special.length) {
    // Never present a partial schedule after dropping an unrepresentable restriction/exception.
    if ([...raw, ...regular, ...special].some(value => !value)) {
      pieces.push("Published hours: See website for the full schedule and exceptions.");
    } else {
      const normal = [...new Set([...raw, ...regular])].join("; ");
      const exceptions = [...new Set(special)].join("; ");
      const hours = [normal ? `Published hours (local): ${normal}` : "", exceptions ? `Special hours: ${exceptions}` : ""].filter(Boolean).join("\n");
      pieces.push(hours.length <= 400 ? hours : "Published hours: See website for the full schedule and exceptions.");
    }
  }
  const phone = typeof venue.telephone === "string" ? text(venue.telephone, 100) : undefined;
  if (phone && [...pieces, `Venue phone: ${phone}`].join("\n").length <= 500) pieces.push(`Venue phone: ${phone}`);
  const reservation = venue.acceptsReservations;
  const accepted = reservation === true || typeof reservation === "string" && /^(yes|true)$/i.test(reservation.trim());
  const refused = reservation === false || typeof reservation === "string" && /^(no|false)$/i.test(reservation.trim());
  let reservationInfo = accepted ? "Reservations: Accepted, as published." : refused ? "Reservations: Not accepted, as published." : undefined;
  if (typeof reservation === "string" && /^https?:\/\//i.test(reservation)) {
    try { const link = new URL(reservation); if (!link.username && !link.password) reservationInfo = link.href.length <= 160 ? `Reservation link: ${link.href}` : "Reservation link: See website."; } catch { /* Malformed publisher URL. */ }
  }
  const policy = visiblePolicy ? `Published reservation policy: ${visiblePolicy.length <= 210 ? visiblePolicy : "See website for the full policy."}` : undefined;
  const reservationParts = [reservationInfo, policy].filter((value): value is string => Boolean(value));
  if (reservationParts.length) {
    if ([...pieces, ...reservationParts].join("\n").length > 500 && pieces.some(value => /^(Published hours|Special hours)/.test(value))) {
      const hoursIndex = pieces.findIndex(value => /^(Published hours|Special hours)/.test(value));
      pieces[hoursIndex] = "Published hours: See website for the full schedule and exceptions.";
    }
    if ([...pieces, ...reservationParts].join("\n").length > 500) reservationParts.splice(0, reservationParts.length, "Reservations: See website for booking details and the full policy.");
    pieces.push(...reservationParts);
  }
  return pieces.length ? pieces.join("\n") : undefined;
}

export function descriptionWithVenueDetails(description: string | undefined, details: string | undefined) {
  if (!details) return description;
  if (!description) return details.slice(0, 500);
  const remaining = 500 - details.length - 2;
  if (remaining < 2) return details.slice(0, 500);
  const summary = description.length <= remaining ? description : `${description.slice(0, remaining - 1).trimEnd()}…`;
  return `${summary}\n\n${details}`;
}
