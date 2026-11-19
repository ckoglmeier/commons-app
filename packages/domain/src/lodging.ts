import { BookingBriefSchema, type BookingBrief, type ResearchBrief, type SpecialistResearch } from "@commons/contracts";

/*
 * Lodging preparation rules that do not depend on any execution runtime: the research provider seam with its labeled fixture, the comparison that decides
 * whether a saved stay is still what was approved, and the preparation-only booking brief. The Commons-native lodging journey
 * (packages/database/src/lodging-continuation.ts) calls these from committed records only.
 */

// --- Research provider seam ------------------------------------------------------------------------------------------

/*
 * Only the labeled fixture is implemented: it is deterministic, free, and every item it returns says it is synthetic. A real provider would implement this
 * interface and be selected by server configuration, never by model output. This port does not establish production research or booking readiness.
 */
export type LodgingSearchInput = { locationName: string | null; maxNightlyCents: number | null; minBedrooms: number | null; nights: number };
export interface LodgingResearchAdapter {
  id: string;
  synthetic: boolean;
  search(input: LodgingSearchInput): Promise<Pick<SpecialistResearch, "options" | "evidence">>;
}

const CATALOG = [
  { id: "harbor-house", name: "Synthetic Harbor House", address: "12 Fixture Quay", bedrooms: 5, nightlyCents: 56_000 },
  { id: "dune-lodge", name: "Synthetic Dune Lodge", address: "4 Fixture Dunes Road", bedrooms: 4, nightlyCents: 41_000 },
  { id: "pine-cabin", name: "Synthetic Pine Cabin", address: "9 Fixture Pines", bedrooms: 3, nightlyCents: 29_500 },
  { id: "cove-cottage", name: "Synthetic Cove Cottage", address: "2 Fixture Cove", bedrooms: 3, nightlyCents: 24_000 },
  { id: "bluff-villa", name: "Synthetic Bluff Villa", address: "88 Fixture Bluff", bedrooms: 6, nightlyCents: 71_000 },
  { id: "inn-annex", name: "Synthetic Inn Annex", address: "1 Fixture Main Street", bedrooms: 2, nightlyCents: 18_500 },
] as const;

export const fixtureLodgingAdapter: LodgingResearchAdapter = {
  id: "fixture", synthetic: true,
  async search({ maxNightlyCents, minBedrooms, nights }) {
    const fits = CATALOG.filter(item => (maxNightlyCents === null || item.nightlyCents <= maxNightlyCents) && (minBedrooms === null || item.bedrooms >= minBedrooms))
      .sort((a, b) => b.bedrooms - a.bedrooms || b.nightlyCents - a.nightlyCents).slice(0, 3);
    return {
      options: fits.map(item => ({ optionId: item.id, name: item.name, address: item.address, bedrooms: item.bedrooms, nightlyCents: item.nightlyCents, totalCents: item.nightlyCents * Math.max(nights, 1),
        evidenceIds: [`ev-${item.id}`], caveats: ["Synthetic fixture listing; price and availability are not real."] })),
      evidence: fits.map(item => ({ id: `ev-${item.id}`, title: `${item.name} (synthetic listing)`, url: `https://fixture.invalid/lodging/${item.id}`,
        excerpt: `Synthetic fixture: ${item.bedrooms} bedrooms at $${(item.nightlyCents / 100).toFixed(0)} a night. Not a real supplier.`, synthetic: true })),
    };
  },
};

/** Server configuration chooses the provider. Only the labeled fixture exists; anything else is refused rather than silently substituted. */
export function lodgingAdapterFor(id: string | undefined): LodgingResearchAdapter {
  if (!id || id === "fixture") return fixtureLodgingAdapter;
  throw new Error(`Lodging research provider "${id}" is not available.`);
}

export function searchInputFromBrief(brief: ResearchBrief): LodgingSearchInput {
  const nightly = brief.constraints.filter(item => item.kind === "max_nightly_cents" && item.value !== null).map(item => item.value as number);
  const bedrooms = brief.constraints.filter(item => item.kind === "min_bedrooms" && item.value !== null).map(item => item.value as number);
  const nights = Math.max(Math.round((Date.parse(brief.endsOn) - Date.parse(brief.startsOn)) / 86_400_000), 1);
  return { locationName: brief.locationName, maxNightlyCents: nightly.length ? Math.min(...nightly) : null, minBedrooms: bedrooms.length ? Math.max(...bedrooms) : null, nights };
}

/** Lodging is compared for a stay, so it needs both saved trip dates, in order. Anything less is a question for the organizer, never a guess. */
export function lodgingDatesComplete(trip: { startsOn: string | null; endsOn: string | null }): trip is { startsOn: string; endsOn: string } {
  return Boolean(trip.startsOn && trip.endsOn && trip.startsOn <= trip.endsOn);
}

// --- Approved records -------------------------------------------------------------------------------------------------

/** The exact saved records a person approved. A brief is built from this and is out of date as soon as the saved stay no longer matches it. */
export type ApprovedStaySnapshot = { stay: { id: string; name: string; address: string; startsOn: string; endsOn: string; totalCents: number | null; /** Legacy snapshots were always USD. */ currency?: string }; travelerIds: string[] };

// Compared field by field: a snapshot read back from jsonb does not preserve key order.
export function sameApprovedSnapshot(a: ApprovedStaySnapshot, b: ApprovedStaySnapshot | null): boolean {
  return Boolean(b) && a.stay.id === b!.stay.id && a.stay.name === b!.stay.name && a.stay.address === b!.stay.address && a.stay.startsOn === b!.stay.startsOn
    && a.stay.endsOn === b!.stay.endsOn && a.stay.totalCents === b!.stay.totalCents && (a.stay.currency ?? "USD") === (b!.stay.currency ?? "USD") && a.travelerIds.length === b!.travelerIds.length && a.travelerIds.every((id, index) => id === b!.travelerIds[index]);
}

export type PreparedStay = { name: string; address: string; startsOn: string; endsOn: string; totalCents: number };
/** Whether the reviewed stay is still the option that was prepared. Travelers and status may change in review; the option's identity, dates and price may not. */
export function stayMatchesPrepared(stay: { name: string; address: string; startsOn: string | null; endsOn: string | null; totalCents: number | null } | null | undefined, prepared: PreparedStay): boolean {
  return Boolean(stay) && stay!.name === prepared.name && stay!.address === prepared.address && stay!.startsOn === prepared.startsOn && stay!.endsOn === prepared.endsOn && stay!.totalCents === prepared.totalCents;
}

// --- Booking brief (preparation only) -----------------------------------------------------------------------------------

export const BOOKING_BRIEF_STATEMENT = "Preparation only. Nothing has been booked, held, paid for, or sent to a supplier. Someone still has to make the booking.";

export type LodgingBriefInput = {
  tripName: string; locationName: string | null;
  snapshot: ApprovedStaySnapshot;
  /** The prepared option's total, used only if the approved stay has none. */
  fallbackTotalCents: number;
  travelers: Array<{ personId: string; name: string }>;
  /** The shortlist the option came from; null when it can no longer be found (the brief then treats its evidence as synthetic). */
  research: { synthetic: boolean; evidenceUrls: string[] } | null;
  /** Shared constraints the research was briefed with, and shared constraints added after it. Private constraints never reach this function. */
  constraintsApplied: string[]; constraintsAddedLater: string[];
  /** Active travelers who have not said whether they are attending. */
  attendanceUnconfirmed: string[];
  approval: { proposalTurnId: string; version: number; approvedByPersonId: string; approvedByName: string; approvedAt: string };
};

/** Structured saved data and what is still unknown. Never model prose, never a supplier action. */
export function buildLodgingBrief(input: LodgingBriefInput): BookingBrief {
  const missing = ["Who will make and pay for the booking has not been decided.", "No confirmation code or cancellation terms exist because nothing has been booked."];
  for (const name of input.attendanceUnconfirmed) missing.push(`${name} has not said whether they are attending.`);
  for (const text of input.constraintsAddedLater) missing.push(`Added after the research this choice was based on, and not reflected in it: ${text}`);
  const synthetic = input.research?.synthetic ?? true;
  if (synthetic) missing.push("The options come from synthetic fixture evidence, not a live supplier search. Check price and availability with the supplier.");
  const approved = input.snapshot.stay;
  return BookingBriefSchema.parse({
    preparationOnly: true, statement: BOOKING_BRIEF_STATEMENT, tripName: input.tripName, locationName: input.locationName,
    selectedOption: { name: approved.name, address: approved.address, startsOn: approved.startsOn, endsOn: approved.endsOn, totalCents: approved.totalCents ?? input.fallbackTotalCents,
      evidenceUrls: (input.research?.evidenceUrls ?? []).slice(0, 5), synthetic },
    travelers: input.travelers, constraintsApplied: input.constraintsApplied, approvalBasis: input.approval, missingInformation: missing.slice(0, 20),
  });
}
