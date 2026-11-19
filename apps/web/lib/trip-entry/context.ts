import { TripEntryContextSchema } from "@commons/contracts";

/** Public acquisition identifiers only. Never put pasted plans or contacts in these URLs or in analytics. */
export type TripEntryContext = { template?: string; destination?: string; source?: string };

/** The website thread fills this in from its catalog. Until then, well-formed slugs are kept and nothing is claimed about them. */
export type TripEntryCatalog = { isTemplate(slug: string): boolean; isDestination(slug: string): boolean };
export const openTripEntryCatalog: TripEntryCatalog = { isTemplate: () => true, isDestination: () => true };

export function parseTripEntryContext(query: Record<string, unknown>, catalog: TripEntryCatalog = openTripEntryCatalog): TripEntryContext {
  const result: TripEntryContext = {};
  for (const key of ["template", "destination", "source"] as const) {
    const value = query[key];
    if (typeof value !== "string") continue;
    const parsed = TripEntryContextSchema.safeParse({ [key]: value });
    if (!parsed.success) continue;
    if (key === "template" && !catalog.isTemplate(value)) continue;
    if (key === "destination" && !catalog.isDestination(value)) continue;
    result[key] = value;
  }
  return result;
}

const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tripEntryPath(context: TripEntryContext, draftId?: string | null): string {
  const query = new URLSearchParams(parseTripEntryContext(context));
  if (draftId && DRAFT_ID.test(draftId)) query.set("draft", draftId);
  return `/new${query.size ? `?${query}` : ""}`;
}

export function tripEntrySignInPath(context: TripEntryContext, draftId?: string | null): string {
  return `/sign-in?${new URLSearchParams({ next: tripEntryPath(context, draftId), intent: "create" })}`;
}
