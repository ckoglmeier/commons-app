import type { CommonsSummary, ItineraryItem, Stay } from "@commons/contracts";
import { stayComparison } from "./stay-compare";
import { researchSourceHandoff } from "./research-decision-view";

export const stayComparisonFocuses = ["overview", "price", "location", "notes"] as const;
export type StayComparisonFocus = typeof stayComparisonFocuses[number];
export type ComparedStay = {
  id: string; name: string; address: string; startsOn: string; endsOn: string;
  people: number; nights: number; price: string[]; distance: string;
  notes: string | null; sourceLabel: string; sourceUrl: string | null;
  unknowns: string[];
};
export type CompareStaysSnapshot = { tripId: string; options: ComparedStay[]; revision: string };

/** Explicit projection: never pass booking codes, documents, traveler identities or the whole trip to OpenUI. */
export function compareStaysSnapshot(commons: Pick<CommonsSummary, "id" | "timezone">, stays: Stay[], itinerary: ItineraryItem[]): CompareStaysSnapshot {
  const considered = stays.filter(stay => stay.status === "considering");
  const facts = stayComparison(considered, itinerary, commons.timezone);
  const options = considered.map(stay => {
    const fact = facts.get(stay.id)!;
    return {
      id: stay.id, name: stay.name, address: stay.address, startsOn: stay.startsOn, endsOn: stay.endsOn,
      people: fact.people, nights: fact.nights,
      price: fact.price ? [fact.price.total, fact.price.perRoomPerNight, fact.price.perPersonPerNight].filter((value): value is string => Boolean(value)) : [],
      distance: fact.distance, notes: stay.details ?? null, sourceLabel: stay.sourceLabel,
      sourceUrl: stay.bookingUrl ? researchSourceHandoff(stay.bookingUrl) : null,
      unknowns: [
        ...(!fact.price ? ["Price not recorded"] : []),
        ...(stay.includesTaxesAndFees === undefined ? ["Taxes and fees not specified"] : []),
        ...(stay.roomPriceCents && !stay.roomCount ? ["Rooms needed not set"] : []),
        "Availability and cancellation terms need checking with the property",
      ],
    };
  });
  // A content pin, not a timestamp or a claim of supplier freshness. Only projected fields affect it.
  return { tripId: commons.id, options, revision: JSON.stringify([commons.timezone, options]) };
}

export type StayComparisonDraft = { revision: string; selectedIds: string[]; focus: StayComparisonFocus };
export function recoverStayComparisonDraft(raw: string | null, snapshot: CompareStaysSnapshot): StayComparisonDraft {
  const empty: StayComparisonDraft = { revision: snapshot.revision, selectedIds: [], focus: "overview" };
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object") return empty;
    const draft = value as Partial<StayComparisonDraft>;
    if (typeof draft.revision !== "string" || !Array.isArray(draft.selectedIds) || !stayComparisonFocuses.includes(draft.focus as StayComparisonFocus)) return empty;
    return { revision: draft.revision, focus: draft.focus as StayComparisonFocus,
      selectedIds: [...new Set(draft.selectedIds.filter((id): id is string => typeof id === "string" && snapshot.options.some(option => option.id === id)))].slice(0, 24) };
  } catch { return empty; }
}

export function compareStaysPollPath(snapshot: CompareStaysSnapshot, draft: StayComparisonDraft): string | null {
  if (snapshot.revision !== draft.revision) return null;
  const selected = snapshot.options.filter(option => draft.selectedIds.includes(option.id));
  if (selected.length < 2 || selected.length > 24) return null;
  return `/c/${encodeURIComponent(snapshot.tripId)}/polls/new?${new URLSearchParams({ stayIds: selected.map(option => option.id).join(",") })}`;
}

/** Grounded pilot program: OpenUI carries IDs/layout only; React resolves facts from the authorized snapshot. */
export function compareStaysProgram(snapshot: CompareStaysSnapshot, focus: StayComparisonFocus): string {
  return `root = StayComparison([${snapshot.options.map((_, i) => `stay${i}`).join(", ")}])\n` +
    snapshot.options.map((option, i) => `stay${i} = StayOption(${JSON.stringify(option.id)}, ${JSON.stringify(focus)})`).join("\n");
}
