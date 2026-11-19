import type { DecisionSource, WineryFinding } from "@commons/contracts";
import { sonomaWineryBrief, decisionFixture } from "./research-decision-fixture";

/** Manually selected SHORT primary-page captures, checked 2026-10-03. Not a live
 * extractor run, booking inventory, an availability check, or a complete page.
 * The fixture observations are deliberately separate from the synthetic prices
 * in research-decision-fixture.ts. No inferred currency or nine-person capacity.
 */
export const wineryExperienceSources: DecisionSource[] = [
  { runId: decisionFixture.sourceRun, sourceId: "flowers-primary", url: "https://www.flowerswinery.com/visit-flowers-healdsburg-2-2/",
    title: "Flowers visit experiences — short manual capture", provider: "manual-primary-page", coverage: "page", retrievedAt: "2026-10-04T02:14:46.000Z",
    excerpt: "ESTATE VINEYARD IMMERSION\nNon-Members | $130 per person\ngroups larger than six\nSONOMA COAST JOURNEY\nNon-Members | $75 per person" },
  { runId: decisionFixture.sourceRun, sourceId: "schramsberg-primary", url: "https://www.schramsberg.com/visit-schramsberg/",
    title: "Schramsberg visit experiences — short manual capture", provider: "manual-primary-page", coverage: "page", retrievedAt: "2026-10-04T02:14:46.000Z",
    excerpt: "PRIVATE TOUR & TASTING\nAvailable Sunday – Thursday Mornings Only\nTASTING ONLY EXPERIENCES\n(Maximum of Six People)" },
  { runId: decisionFixture.sourceRun, sourceId: "davero-primary", url: "https://davero.com/experience/tours-tastings/",
    title: "DaVero tasting experiences — short manual capture", provider: "manual-primary-page", coverage: "page", retrievedAt: "2026-10-04T02:14:46.000Z",
    excerpt: "The Pairing Experience\nLarge Group $65 per guest + 20% gratuity\nBottle Service\nGuests of all ages welcome" },
];
export function wineryExperienceBrief(day: "Friday" | "Saturday" = "Friday") {
  const brief = sonomaWineryBrief();
  return { ...brief, startsOn: "2026-11-05", endsOn: "2026-11-07", requestedWeekdays: [day],
    nominated: brief.nominated.filter(n => ["flowers", "schramsberg", "davero"].includes(n.id)) };
}
export function primaryWineryFinding(candidateId: string, sourceId: string, experienceId: string, experienceName: string,
  field: WineryFinding["field"], value: WineryFinding["value"], quote: string): WineryFinding {
  return { candidateId, field, value, quote, source: { runId: decisionFixture.sourceRun, sourceId },
    experience: { id: experienceId, name: experienceName, kind: "regular_in_person", quote: experienceName } };
}
