import { DatesLocationAlternativesSchema, LodgingPropertiesSchema, type DatesLocationAlternative, type LodgingPropertyInput } from "@commons/contracts";

export type RecipeCall<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; status: number };

/** One place for the wire format. Errors always carry an explanation that says what did and did not change. */
export async function recipeRequest<T>(url: string, method: "GET" | "POST" | "PATCH", body?: unknown): Promise<RecipeCall<T>> {
  try {
    const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
    const json = await response.json().catch(() => ({})) as { error?: string; code?: string };
    if (response.ok) return { ok: true, data: json as T };
    return { ok: false, error: json.error ?? "Commons couldn’t confirm the result. Reload the saved recipe before trying again.", code: json.code, status: response.status };
  } catch {
    return { ok: false, error: "Commons couldn’t confirm the result. Check your connection, then reload the saved recipe before trying again.", status: 0 };
  }
}

export type AlternativeRow = { id: string; startsOn: string; endsOn: string; place: string };
export const newAlternativeRow = (): AlternativeRow => ({ id: globalThis.crypto.randomUUID(), startsOn: "", endsOn: "", place: "" });
export const rowsFromAlternatives = (alternatives: DatesLocationAlternative[]): AlternativeRow[] => alternatives.map(item => ({ ...item }));

/** The first thing wrong with the options, in words a person can act on, or null when they are ready to save. */
export function alternativeRowsError(rows: AlternativeRow[]): string | null {
  const missing = rows.findIndex(row => !row.startsOn || !row.endsOn || !row.place.trim());
  if (missing >= 0) return `Add dates and a place for option ${missing + 1}.`;
  const parsed = DatesLocationAlternativesSchema.safeParse(rows.map(row => ({ ...row, place: row.place.trim() })));
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check the options.");
}
export function cleanAlternativeRows(rows: AlternativeRow[]): DatesLocationAlternative[] { return rows.map(row => ({ ...row, place: row.place.trim() })); }

export function formatDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Not set";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}
export function formatRange(startsOn: string | null, endsOn: string | null) {
  if (!startsOn && !endsOn) return "Not set";
  return startsOn === endsOn || !endsOn ? formatDay(startsOn) : `${formatDay(startsOn)} – ${formatDay(endsOn)}`;
}

/** A command id that stays the same while the content is the same, so a double click or retry replays instead of duplicating. */
export function stableCommand(store: { key: string; id: string } | null, content: unknown) {
  const key = JSON.stringify(content);
  return store && store.key === key ? store : { key, id: globalThis.crypto.randomUUID() };
}

/* ---------- Lodging properties: the form works in dollars and strings; the contract works in cents ---------- */

export type PropertyRow = {
  id: string; name: string; url: string; description: string; rooms: string; beds: LodgingPropertyInput["beds"];
  basis: LodgingPropertyInput["pricing"]["basis"]; period: LodgingPropertyInput["pricing"]["period"]; fees: LodgingPropertyInput["pricing"]["fees"]; currency: string; min: string; max: string;
};
export const newPropertyRow = (): PropertyRow => ({ id: globalThis.crypto.randomUUID(), name: "", url: "", description: "", rooms: "", beds: "unknown", basis: "per_room", period: "nightly", fees: "unknown", currency: "USD", min: "", max: "" });
const dollars = (cents: number | null) => cents === null ? "" : String(cents / 100);
export const rowsFromProperties = (items: LodgingPropertyInput[]): PropertyRow[] => items.map(item => ({ id: item.id, name: item.name, url: item.url, description: item.description ?? "", rooms: item.rooms, beds: item.beds,
  basis: item.pricing.basis, period: item.pricing.period, fees: item.pricing.fees, currency: item.pricing.currency, min: dollars(item.pricing.minCents), max: dollars(item.pricing.maxCents) }));
const cents = (value: string) => value.trim() === "" ? null : Math.round(Number(value) * 100);
export function cleanPropertyRows(rows: PropertyRow[]): LodgingPropertyInput[] {
  return rows.map(row => ({ id: row.id, name: row.name.trim(), url: row.url.trim(), description: row.description.trim() || null, rooms: row.rooms.trim(), beds: row.beds,
    pricing: { basis: row.basis, period: row.period, currency: row.currency.trim().toUpperCase(), minCents: cents(row.min), maxCents: cents(row.max), fees: row.fees } }));
}
export function propertyRowsError(rows: PropertyRow[]): string | null {
  const missing = rows.findIndex(row => !row.name.trim() || !row.url.trim() || !row.rooms.trim());
  if (missing >= 0) return `Add a name, the link you were given and the rooms for place ${missing + 1}.`;
  const bad = rows.findIndex(row => [row.min, row.max].some(value => value.trim() !== "" && !(Number(value) >= 0)));
  if (bad >= 0) return `Use plain amounts for the estimate at place ${bad + 1}, such as 280.`;
  const parsed = LodgingPropertiesSchema.safeParse(cleanPropertyRows(rows));
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Check the places.");
}
