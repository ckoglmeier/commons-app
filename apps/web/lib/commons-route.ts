export const PUBLIC_DEMO_COMMONS_ID = "10000000-0000-4000-8000-000000000001";

export const eventViews = ["home", "plan", "logistics", "money", "moments"] as const;
export type EventView = typeof eventViews[number];

export function parseEventView(value?: string | null): EventView {
  return eventViews.find(view => view === value) ?? "home";
}

export function commonsViewPath(commonsId: string, view: EventView) {
  return `${commonsWorkspacePath(commonsId)}&view=${view === "logistics" ? "plan&section=travel" : view}`;
}

export function travelReturnView(value?: string | null): "plan" | "logistics" {
  return value === "plan" ? "plan" : "logistics";
}

export function commonsTravelPath(commonsId: string, _from: "plan" | "logistics" = "logistics") {
  void _from; // Retained for existing callers; Travel now has one destination.
  return commonsViewPath(commonsId, "logistics");
}

export function commonsPath(commonsId: string) {
  return `/c/${encodeURIComponent(commonsId)}`;
}

export function commonsWorkspacePath(commonsId: string) {
  return `${commonsPath(commonsId)}?arrival=0`;
}

export function commonsSetupPath(commonsId: string, step = "people") {
  return `${commonsPath(commonsId)}/setup?step=${encodeURIComponent(step)}`;
}

/** Legacy Logistics links and canonical Plan sections share the existing presentation state. */
export function eventLocation(search: URLSearchParams): EventView {
  const view = parseEventView(search.get("view"));
  return view === "plan" && search.get("section") === "travel" ? "logistics" : view;
}
export const planSections = ["schedule", "travel", "ideas", "map", "stays"] as const;
export type PlanSection = typeof planSections[number];

/** One reader for copied links and history: Map needs its flag; anything unknown is Activities. */
export function parsePlanSection(value: string | null | undefined, mapEnabled: boolean): PlanSection {
  if (value === "map") return mapEnabled ? "map" : "schedule";
  return planSections.find(section => section === value) ?? "schedule";
}

/**
 * The persistent shell shows two Plan sections: Activities (schedule, plus undated ideas) and Travel & stays.
 * Map is an action from either, so it has no section link of its own.
 */
export function visiblePlanSection(section: PlanSection): "schedule" | "travel" | null {
  return section === "map" ? null : section === "travel" || section === "stays" ? "travel" : "schedule";
}

export function planSectionPath(id: string, section: PlanSection) {
  return `${commonsViewPath(id, "plan")}&section=${section}`;
}
export function itemDetailPath(id: string, kind: "plan" | "stay", itemId: string, from: EventView = "plan") {
  return `${commonsViewPath(id, from)}&item=${kind}&itemId=${encodeURIComponent(itemId)}`;
}
