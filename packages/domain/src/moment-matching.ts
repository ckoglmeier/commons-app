export type MomentMatchCandidate = {
  occurredAt: string;
  caption: string;
  altText: string;
};

export type ItineraryMatchCandidate = {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string;
  location?: string;
};

export type SuggestedMomentMatch = {
  itineraryItemId: string;
  itineraryItemTitle: string;
  source: "automatic";
  confidence: number;
  reason: string;
};

const canonicalTerms: Record<string, string> = {
  air: "travel",
  airport: "travel",
  arrival: "arrival",
  arrivals: "arrival",
  arriving: "arrival",
  beach: "shore",
  check: "arrival",
  course: "golf",
  depart: "travel",
  departure: "travel",
  departures: "travel",
  dinner: "meal",
  fairway: "golf",
  flight: "travel",
  fly: "travel",
  flying: "travel",
  golf: "golf",
  golfer: "golf",
  green: "golf",
  lunch: "meal",
  ocean: "shore",
  pickle: "pickleball",
  pickleball: "pickleball",
  pool: "pool",
  porch: "porch",
  restaurant: "meal",
  round: "golf",
  shore: "shore",
  table: "meal",
};

const ignoredTerms = new Set([
  "and",
  "for",
  "from",
  "into",
  "island",
  "sea",
  "the",
  "with",
]);

function terms(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 2)
      .map((term) => canonicalTerms[term] ?? term)
      .filter((term) => !ignoredTerms.has(term)),
  );
}

function sharedTerms(left: Set<string>, right: Set<string>) {
  return [...left].filter((term) => right.has(term));
}

function timeScore(momentTime: number, item: ItineraryMatchCandidate) {
  const startsAt = new Date(item.startsAt).getTime();
  const explicitEnd = item.endsAt ? new Date(item.endsAt).getTime() : undefined;
  const endsAt = explicitEnd ?? startsAt + 2 * 60 * 60 * 1000;
  const earlyWindow = startsAt - 30 * 60 * 1000;
  const lateWindow = endsAt + 90 * 60 * 1000;

  if (momentTime >= startsAt && momentTime <= endsAt) return 45;
  if (momentTime >= earlyWindow && momentTime <= lateWindow) return 35;
  return 0;
}

/**
 * Suggests an itinerary event only when timing and trip context agree. A photo
 * that merely happened near an event is intentionally left unmatched.
 */
export function suggestMomentEventMatch(
  moment: MomentMatchCandidate,
  itinerary: ItineraryMatchCandidate[],
): SuggestedMomentMatch | undefined {
  const momentTime = new Date(moment.occurredAt).getTime();
  const momentTerms = terms(`${moment.caption} ${moment.altText}`);

  const ranked = itinerary
    .map((item) => {
      const overlaps = sharedTerms(
        momentTerms,
        terms(`${item.title} ${item.location ?? ""}`),
      );
      const contextScore = overlaps.length ? Math.min(60, 50 + overlaps.length * 5) : 0;
      const timingScore = timeScore(momentTime, item);
      return { item, overlaps, confidence: contextScore + timingScore };
    })
    .sort((left, right) => right.confidence - left.confidence);

  const best = ranked[0];
  if (!best || best.confidence < 75 || best.overlaps.length === 0) return undefined;

  return {
    itineraryItemId: best.item.id,
    itineraryItemTitle: best.item.title,
    source: "automatic",
    confidence: Math.min(best.confidence, 100),
    reason: `Matched from photo timing and ${best.overlaps.slice(0, 2).join(" + ")} context`,
  };
}
