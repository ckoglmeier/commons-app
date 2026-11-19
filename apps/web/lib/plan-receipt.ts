import type { ItineraryItem, Stay, TravelPlan } from "@commons/contracts";
import { planSectionPath } from "./commons-route";

/**
 * What a successful canonical Plan save reports: the saved record, the state it is actually in, and the exact place in Plan to see it.
 * Only built from a server-confirmed snapshot; a private draft or failed save never produces one.
 */
export type PlanReceipt = {
  kind: "activity" | "stay" | "transport";
  id: string;
  title: string;
  /** Ideas, scheduled items and confirmed arrangements stay distinct. A date is not a booking. */
  status: string;
  section: "schedule" | "ideas" | "travel";
  day: string | null;
  href: string;
};

function localDateKey(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

export function activityReceipt(commonsId: string, item: ItineraryItem, timeZone: string): PlanReceipt {
  const day = item.scheduledDate ?? (item.startsAt ? localDateKey(item.startsAt, timeZone) : null);
  const section = day ? "schedule" : "ideas";
  const status = item.status === "confirmed" ? `Confirmed${day ? ` · ${dayLabel(day)}` : ""}` : day ? `Scheduled · ${dayLabel(day)}` : "No day yet";
  return { kind: "activity", id: item.id, title: item.title, status, section, day, href: `${planSectionPath(commonsId, section)}&item=plan&itemId=${encodeURIComponent(item.id)}` };
}

export function stayReceipt(commonsId: string, stay: Stay): PlanReceipt {
  const status = stay.status === "considering" ? "Option we’re considering" : stay.status === "confirmed" ? "Confirmed stay" : "Planned stay";
  return { kind: "stay", id: stay.id, title: stay.name, status, section: "travel", day: null, href: `${planSectionPath(commonsId, "travel")}&item=stay&itemId=${encodeURIComponent(stay.id)}` };
}

export function travelReceipt(commonsId: string, plan: TravelPlan): PlanReceipt {
  const status = plan.status === "confirmed" ? "Marked confirmed" : plan.status === "booked" ? "Marked booked" : "Considering";
  return { kind: "transport", id: plan.id, title: plan.route || (plan.kind === "transport" ? "Transport" : "Travel"), status, section: "travel", day: plan.date || null, href: planSectionPath(commonsId, "travel") };
}

/**
 * The record a create added: new since the IDs this tab last knew, and matching what was submitted. Someone else may have
 * added records meanwhile, so anything but exactly one match gives no receipt rather than pointing at the wrong record.
 */
export function addedRecord<T extends { id: string }>(before: ReadonlySet<string>, records: readonly T[], matches: (record: T) => boolean): T | null {
  const added = records.filter(record => !before.has(record.id) && matches(record));
  return added.length === 1 ? added[0] : null;
}

/** Same text as submitted, ignoring surrounding space and case. */
export const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLocaleLowerCase("en-US") === (b ?? "").trim().toLocaleLowerCase("en-US");

/**
 * One command ID per open Add form and unchanged input: a retry after an uncertain failure reuses it, so the server's
 * command deduplication returns the first result instead of adding a duplicate. Changed input is a new command.
 */
export function stableCommandId(store: Map<string, { fingerprint: string; id: string }>, scope: string, input: unknown, create: () => string = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify(input);
  const existing = store.get(scope);
  if (existing?.fingerprint === fingerprint) return existing.id;
  const id = create();
  store.set(scope, { fingerprint, id });
  return id;
}
