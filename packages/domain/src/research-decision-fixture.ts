import { ResearchDecisionBriefSchema, type DecisionSource, type DecisionExtraction, type ResearchDecisionBrief } from "@commons/contracts";

/** Synthetic reference pages/rates ONLY. These are not supplier research or historical offers. */
export const decisionFixture = {
  actor: "97000000-0000-4000-8000-000000000001", thread: "97000000-0000-4000-8000-000000000002",
  task: "97000000-0000-4000-8000-000000000003", artifact: "97000000-0000-4000-8000-000000000004",
  sourceRun: "97000000-0000-4000-8000-000000000005",
};
const nominees = ["Flowers", "Peay", "Hirsch", "DaVero", "Merry Edwards", "Porter Creek", "Kosta Browne", "Schramsberg", "Hanzell"];
export function sonomaWineryBrief(): ResearchDecisionBrief {
  return ResearchDecisionBriefSchema.parse({ schemaVersion: 1, kind: "winery", taskId: decisionFixture.task,
    threadId: decisionFixture.thread, ownerId: decisionFixture.actor, revision: 1, contextRevision: "sonoma-context-1",
    recipe: { key: "winery-decision-v1", version: 1 }, title: "Which wineries fit our group?", partySize: 9,
    startsOn: null, endsOn: null, requestedWeekdays: ["Thursday", "Friday", "Saturday"],
    nominated: nominees.map(name => ({ id: name.toLowerCase().replace(/ /g, "-"), name, priority: name === "Schramsberg", memberConnection: name === "Hanzell" })),
    legs: [], luggagePieces: null, willingDrivers: null,
    queries: [{ id: "group-policies", text: "Sonoma Napa winery group tasting policies", followUpFor: null },
      { id: "schramsberg-group", text: "Schramsberg private group tasting policy", followUpFor: "schramsberg" }],
    factRefs: [{ id: "party", version: 1 }, { id: "trip-days", version: 1 }, { id: "winery-nominations", version: 1 }] });
}
export function sonomaTransportBrief(): ResearchDecisionBrief {
  const base = sonomaWineryBrief();
  return ResearchDecisionBriefSchema.parse({ ...base, kind: "transport", recipe: { key: "transport-decision-v1", version: 1 },
    title: "Compare transport for the whole Sonoma trip", nominated: [],
    legs: [
      { id: "arrival", label: "Thursday: SFO to Lodge at Sonoma", origin: "SFO", destination: "Lodge at Sonoma", requirementVersion: "sfo-lodge-v1", date: null, partySize: 9, needsLuggage: true },
      { id: "wineries", label: "Friday: lodge to selected wineries and back", origin: "Lodge at Sonoma", destination: "Lodge at Sonoma", requirementVersion: "winery-route-unselected-v1", date: null, partySize: 9, needsLuggage: false },
      { id: "return", label: "Saturday: Lodge at Sonoma to SFO", origin: "Lodge at Sonoma", destination: "SFO", requirementVersion: "lodge-sfo-v1", date: null, partySize: 9, needsLuggage: true },
    ], queries: [{ id: "transport-policies", text: "SFO Sonoma group airport transfer winery driver rental capacity", followUpFor: null }],
    factRefs: [...base.factRefs, { id: "airport", version: 1 }, { id: "lodging", version: 1 }, { id: "winery-route", version: 1 }] });
}
export function decisionSources(): DecisionSource[] {
  return [{ runId: decisionFixture.sourceRun, sourceId: "policies", url: "https://example.com/synthetic-travel-reference",
    title: "Synthetic winery and vehicle policies", provider: "fixture", coverage: "page", retrievedAt: "2026-10-03T12:00:00.000Z",
    excerpt: "SYNTHETIC ONLY. Flowers: maximum 12, nonmembers welcome, Thursday, Friday, Saturday, USD 130 per person. " +
      "DaVero: maximum 12, nonmembers welcome, Friday, USD 65 per person. Schramsberg: maximum 8, nonmembers welcome, Friday, Saturday. " +
      "Hanzell: maximum 12, members only, Thursday, Friday. Vehicles: synthetic two-car reference 720 USD; all hired 1450 USD; airport transfers 750 USD; winery driver 450 USD. " +
      "Vehicle and pricing values exist only to exercise calculations, not to assert real supplier rates or availability." }];
}
export function wineryFixtureExtraction(source = decisionSources()[0]): DecisionExtraction {
  const ref = { runId: source.runId, sourceId: source.sourceId };
  const findings: DecisionExtraction["findings"] = [];
  const add = (candidateId: string, maximum: number, members: boolean, days: string, price?: number) => {
    for (const [field, value] of [["maximumParty", maximum], ["membersOnly", members], ["visitDays", days], ...(price === undefined ? [] : [["pricePerPersonCents", price], ["currency", "USD"]])] as Array<[DecisionExtraction["findings"][number]["field"], number | boolean | string]>) {
      findings.push({ candidateId, field, value, source: { ...ref }, quote: source.excerpt });
    }
  };
  add("flowers", 12, false, "Thursday, Friday, Saturday", 13000);
  add("davero", 12, false, "Friday", 6500);
  add("schramsberg", 8, false, "Friday, Saturday");
  add("hanzell", 12, true, "Thursday, Friday");
  return { findings, components: [], packages: [] };
}
export function transportFixtureExtraction(brief = sonomaTransportBrief(), source = decisionSources()[0]): DecisionExtraction {
  const component = (id: string, mode: "rental" | "hired", legs: string[], amount: string, vehicles = 1, seats = 9, luggage = 10): DecisionExtraction["components"][number] => ({
    id, supplier: `Synthetic ${id}`, mode, covers: brief.legs.filter(l => legs.includes(l.id)).map(l => ({ legId: l.id, requirementVersion: l.requirementVersion, partySize: l.partySize })),
    vehicleCount: vehicles, seatsPerVehicle: seats, luggagePieces: luggage, pricedUnits: null, quoteState: "fixture",
    price: { amount, currency: "USD", basis: "total", taxes: "included", fees: "included", coversAllRequestedComponents: true },
    sources: [{ runId: source.runId, sourceId: source.sourceId }], evidenceQuote: source.excerpt,
  });
  return { findings: [], components: [component("rental-all", "rental", ["arrival", "wineries", "return"], "720", 2, 5),
    component("hired-all", "hired", ["arrival", "wineries", "return"], "1450"),
    component("transfers", "hired", ["arrival", "return"], "750"), component("winery-driver", "hired", ["wineries"], "450", 1, 9, 0),
    component("rental-airports", "rental", ["arrival", "return"], "720", 2, 5)],
  packages: [
    { id: "self-drive", label: "Rent and self-drive all three days", family: "self_drive", componentIds: ["rental-all"] },
    { id: "all-hired", label: "Hire transport for all legs", family: "all_hired", componentIds: ["hired-all"] },
    { id: "transfers-driver", label: "Airport transfers plus winery driver", family: "transfers_and_driver", componentIds: ["transfers", "winery-driver"] },
    { id: "rental-driver", label: "Rental for airports plus winery driver", family: "rental_and_driver", componentIds: ["rental-airports", "winery-driver"] },
  ] };
}

/** Sparse holdouts from imported summaries, NOT recovered historic inventory. */
export function retrospectiveDecisionBrief(which: "sea-island" | "hawaiifest"): ResearchDecisionBrief {
  const base = sonomaTransportBrief();
  const hawaii = which === "hawaiifest";
  return ResearchDecisionBriefSchema.parse({ ...base, title: hawaii ? "Hawaiifest 2K25 — Bardstown, Kentucky" : "Sea Island 2026 — Georgia",
    partySize: hawaii ? 7 : 6, startsOn: hawaii ? "2025-05-15" : "2026-06-04", endsOn: hawaii ? "2025-05-18" : "2026-06-07",
    contextRevision: `${which}-summary-1`, requestedWeekdays: [], legs: [{ id: "arrival", label: "Arrival airport and lodging are unknown", origin: null, destination: null, requirementVersion: `${which}-unknown-1`,
      date: null, partySize: hawaii ? 7 : 6, needsLuggage: true }], queries: [], factRefs: [{ id: "imported-summary", version: 1 }] });
}
