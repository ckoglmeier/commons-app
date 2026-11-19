import {
  DecisionExtractionSchema, ResearchDecisionBriefSchema, ResearchDecisionComparisonSchema,
  type DecisionCandidate, type DecisionExtraction, type DecisionSource,
  type ResearchDecisionBrief, type ResearchDecisionComparison, type WineryFinding,
} from "@commons/contracts";

export const decisionSourceKey = (source: { runId: string; sourceId: string }) => `${source.runId}:${source.sourceId}`;
const distinct = <T>(items: T[]) => [...new Set(items)];
const unknownPrice = (): DecisionCandidate["price"] => ({ subtotalCents: null, perPersonCents: null,
  currency: null, completeness: "unknown", kind: "reference" });
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function typedFinding(f: WineryFinding) {
  if (f.field === "maximumParty" || f.field === "inquiryAboveParty") return typeof f.value === "number" && f.value > 0 && f.value <= 100;
  if (f.field === "pricePerPersonCents") return typeof f.value === "number";
  if (f.field === "membersOnly") return typeof f.value === "boolean";
  if (f.field === "currency") return typeof f.value === "string" && /^[A-Z]{3}$/.test(f.value);
  if (f.field === "visitDays") return typeof f.value === "string" && f.value.split(/[,;]\s*/).every(x => weekdays.includes(x));
  return typeof f.value === "string" && f.value.trim().length > 0;
}

/** Narrow deterministic support for a hard capacity exclusion. A contact
 * threshold, ticket allotment or number elsewhere in a quote is not a maximum.
 * Unrecognized language is held, never converted to a guessed capacity. This
 * does not qualify product identity, translated terms or current availability.
 */
function explicitWineryMaximum(f: WineryFinding): boolean {
  if (f.field !== "maximumParty") return true;
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
  const amount = typeof f.value === "number" ? `(?:${f.value}${words[f.value] ? `|${words[f.value]}` : ""})` : "(?!)";
  const quote = f.quote.replace(/[–—]/g, "-");
  if (/\b(?:no|not|without|contact|inquir\w*|call|larger than|more than)\b/i.test(quote)) return false;
  return new RegExp(`\\b(?:max(?:imum)?(?:\\s+(?:of|party size|group size))?|up to|at most|limited to|limit of)\\s*:?\\s*${amount}\\s+(?:people|persons?|guests?|visitors?|adults?|participants?)\\b`, "i").test(quote)
    || new RegExp(`\\b(?:max(?:imum)?\\s+(?:party|group)(?:\\s+size)?|(?:party|group)\\s+(?:size\\s+)?limit)\\s*(?:of\\s*|:\\s*)?${amount}\\b`, "i").test(quote);
}

/** Fail closed on malformed or ungrounded extraction. A quote match is NOT semantic verification. */
export function normalizeDecisionExtraction(brief: ResearchDecisionBrief, sources: DecisionSource[], raw: unknown,
  options: { requireWineryExperience?: boolean } = {}): {
  extraction: DecisionExtraction; limitations: string[];
} {
  const parsed = DecisionExtractionSchema.safeParse(raw);
  if (!parsed.success) return { extraction: { findings: [], components: [], packages: [] }, limitations: ["The extraction was malformed; no extracted claims were accepted."] };
  const bySource = new Map(sources.map(s => [decisionSourceKey(s), s]));
  const limitations: string[] = [];
  const grounded = (refs: Array<{ runId: string; sourceId: string }>, quote: string) => refs.length > 0
    && refs.every(r => bySource.has(decisionSourceKey(r)))
    && refs.some(r => bySource.get(decisionSourceKey(r))!.excerpt.includes(quote));
  const findings = brief.kind === "winery" ? parsed.data.findings.filter(f => {
    const scoped = !f.experience ? !options.requireWineryExperience
      : f.experience.kind === "regular_in_person" && grounded([f.source], f.experience.quote)
        && f.experience.quote.toLowerCase().includes(f.experience.name.toLowerCase());
    const capacitySupported = !options.requireWineryExperience || explicitWineryMaximum(f);
    const keep = brief.nominated.some(n => n.id === f.candidateId) && typedFinding(f) && grounded([f.source], f.quote) && scoped && capacitySupported;
    if (!keep) limitations.push("An unknown candidate, mistyped field or unsupported quote was discarded.");
    if (!scoped) limitations.push("A winery claim without a captured regular in-person experience was held for review.");
    if (!capacitySupported) limitations.push("A claimed group maximum was held for review because the quote did not state a clear capacity limit.");
    return keep;
  }) : [];
  const components = brief.kind === "transport" ? parsed.data.components.filter(c => {
    const keep = grounded(c.sources, c.evidenceQuote) && c.covers.every(x => brief.legs.some(l => l.id === x.legId));
    if (!keep) limitations.push("A transport component with unknown legs or unsupported evidence was discarded.");
    return keep;
  }) : [];
  // Conflicting identities must not silently replace an earlier offer or charge it twice.
  const ids = components.map(c => c.id);
  const uniqueComponents = components.filter(c => ids.filter(id => id === c.id).length === 1);
  const packages = brief.kind === "transport" ? parsed.data.packages.filter(p => p.componentIds.every(id => uniqueComponents.some(c => c.id === id))) : [];
  if (uniqueComponents.length !== components.length) limitations.push("Conflicting transport component identities were discarded.");
  return { extraction: { findings, components: uniqueComponents, packages: packages.filter(p => packages.filter(x => x.id === p.id).length === 1) }, limitations: distinct(limitations) };
}

/** Exact decimal conversion for reference arithmetic; unsupported fractions/currencies stay unknown. */
export function referenceAmountCents(amount: string | null, currency: string | null): number | null {
  // These currencies use two minor-unit digits. Never assume that for JPY/KWD/etc.
  if (!amount || !currency || !["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "CHF"].includes(currency) || !/^\d{1,12}(?:\.\d{1,2})?$/.test(amount)) return null;
  const [whole, decimals = ""] = amount.split(".");
  const cents = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function wineryCandidates(brief: ResearchDecisionBrief, extraction: DecisionExtraction): DecisionCandidate[] {
  return brief.nominated.map(n => {
    const rows = extraction.findings.filter(f => f.candidateId === n.id);
    const reasons: string[] = [];
    // Never create an imaginary product from one experience's price and another's
    // capacity/day/access rule. A source URL or winery name is not a product key.
    const experiences = distinct(rows.map(f => f.experience ? `${f.experience.id}:${f.experience.name}` : "legacy-fixture"));
    if (experiences.length > 1) return { id: n.id, label: n.name, kind: "winery" as const, fit: "conditional" as const,
      reasons: ["Choose a single tasting experience before comparing its group rules and price.", ...(n.priority ? ["Organizer priority."] : [])],
      sources: rows.map(f => f.source).filter((r, i, all) => all.findIndex(x => decisionSourceKey(x) === decisionSourceKey(r)) === i), price: unknownPrice(), coverage: [] };
    const get = (field: WineryFinding["field"]) => {
      const matches = rows.filter(f => f.field === field);
      const values = distinct(matches.map(f => JSON.stringify(f.value)));
      if (values.length > 1) { reasons.push(`Conflicting ${field} information needs checking.`); return undefined; }
      return matches[0]?.value;
    };
    const maximum = get("maximumParty"), inquiry = get("inquiryAboveParty"), members = get("membersOnly"), days = get("visitDays"), rate = get("pricePerPersonCents"), currency = get("currency");
    let fit: DecisionCandidate["fit"] = "supported";
    if (typeof maximum !== "number") { fit = "conditional"; reasons.push(`Group capacity for ${brief.partySize} needs checking.`); }
    else if (maximum < brief.partySize) { fit = "unsuitable"; reasons.push(`Published group limit ${maximum} is below ${brief.partySize}.`); }
    else reasons.push(`Published group limit accommodates ${brief.partySize}.`);
    if (typeof inquiry === "number" && brief.partySize > inquiry) {
      if (fit !== "unsuitable") fit = "conditional";
      reasons.push(`Groups larger than ${inquiry} must ask the winery; that is not a hard capacity limit.`);
    }
    if (members === true) {
      if (!n.memberConnection) { fit = "unsuitable"; reasons.push("Member access is required and no connection is recorded."); }
      else { if (fit !== "unsuitable") fit = "conditional"; reasons.push("Use the recorded member connection; access is not arranged yet."); }
    }
    if (members === undefined && fit !== "unsuitable") { fit = "conditional"; reasons.push("Access requirements need checking."); }
    if (typeof days === "string" && brief.requestedWeekdays.length && !brief.requestedWeekdays.some(d => days.split(/[,;]\s*/).includes(d))) {
      fit = "unsuitable"; reasons.push("Published visit days do not match the requested days.");
    } else if (brief.requestedWeekdays.length && typeof days !== "string" && fit !== "unsuitable") {
      fit = "conditional"; reasons.push("Visit days need checking.");
    }
    if (n.priority) reasons.push("Organizer priority.");
    const price = typeof rate === "number" && typeof currency === "string" && referenceAmountCents("1", currency) !== null ? { subtotalCents: rate * brief.partySize, perPersonCents: rate,
      currency, completeness: "partial_reference" as const, kind: "reference" as const } : unknownPrice();
    // Missing currency is never inferred from a dollar sign. This is not a live appointment or all-in quote.
    return { id: n.id, label: n.name, kind: "winery" as const, fit, reasons, sources: rows.map(f => f.source).filter((r, i, all) => all.findIndex(x => decisionSourceKey(x) === decisionSourceKey(r)) === i), price, coverage: [] };
  }).sort((a, b) => Number(brief.nominated.find(n => n.id === b.id)!.priority) - Number(brief.nominated.find(n => n.id === a.id)!.priority));
}

function transportCandidates(brief: ResearchDecisionBrief, extraction: DecisionExtraction): DecisionCandidate[] {
  return extraction.packages.map(p => {
    const components = p.componentIds.map(id => extraction.components.find(c => c.id === id)!);
    const reasons: string[] = [], coverage: string[] = [];
    let unsuitable = false, partial = false, known = true, subtotal = 0;
    const currencies = distinct(components.map(c => c.price.currency).filter((x): x is string => !!x));
    const currency = currencies.length === 1 ? currencies[0] : null;
    if (currencies.length !== 1) { known = false; reasons.push("A single known currency is required to compare totals."); }
    for (const leg of brief.legs) {
      if (!leg.origin || !leg.destination) { partial = true; reasons.push(`${leg.label}: route endpoints need confirming.`); }
      const covering = components.filter(c => c.covers.some(x => x.legId === leg.id));
      if (covering.length !== 1) {
        unsuitable = true; partial = true; reasons.push(covering.length ? `${leg.label}: overlapping components need resolving; do not double charge.` : `${leg.label}: missing coverage.`); continue;
      }
      const component = covering[0], check = component.covers.find(x => x.legId === leg.id)!;
      if (check.requirementVersion !== leg.requirementVersion || check.partySize !== leg.partySize) {
        unsuitable = true; partial = true; reasons.push(`${leg.label}: the reference was checked against different trip requirements.`); continue;
      }
      coverage.push(leg.id);
      if (component.seatsPerVehicle === null) reasons.push(`${leg.label}: seats need checking.`);
      else if (component.vehicleCount * component.seatsPerVehicle < leg.partySize) { unsuitable = true; reasons.push(`${leg.label}: not enough seats.`); }
      if (leg.needsLuggage) {
        if (brief.luggagePieces === null || component.luggagePieces === null) reasons.push(`${leg.label}: luggage capacity needs checking.`);
        else if (component.luggagePieces < brief.luggagePieces) { unsuitable = true; reasons.push(`${leg.label}: not enough luggage capacity.`); }
      }
      if (component.mode === "rental") {
        const drivers = leg.willingDrivers === undefined ? brief.willingDrivers : leg.willingDrivers;
        if (drivers === null) reasons.push(`${leg.label}: confirm willing sober drivers.`);
        else if (drivers < component.vehicleCount) { unsuitable = true; reasons.push(`${leg.label}: not enough willing sober drivers.`); }
      }
    }
    const modes = new Set(components.map(c => c.mode));
    if ((p.family === "self_drive" && (modes.size !== 1 || !modes.has("rental"))) ||
      ((p.family === "all_hired" || p.family === "transfers_and_driver") && (modes.size !== 1 || !modes.has("hired"))) ||
      (p.family === "rental_and_driver" && modes.size !== 2)) { unsuitable = true; reasons.push("The components do not match this transport strategy."); }
    for (const c of components) {
      const unit = referenceAmountCents(c.price.amount, c.price.currency);
      let multiplier: number | null = null;
      if (c.price.basis === "total") multiplier = 1;
      else if (c.price.basis === "per_person") {
        const parties = distinct(c.covers.map(x => x.partySize));
        if (parties.length === 1 && c.pricedUnits === parties[0]) multiplier = c.pricedUnits;
      } else if (c.price.basis !== "unknown") multiplier = c.pricedUnits;
      if (unit === null || multiplier === null || c.price.currency !== currency || c.quoteState === "request_only" || !Number.isSafeInteger(unit * multiplier)) {
        known = false; reasons.push(`${c.supplier}: a comparable reference price or explicit pricing units are missing.`);
      } else subtotal += unit * multiplier;
      if (c.price.taxes !== "included" || c.price.fees !== "included" || c.price.coversAllRequestedComponents !== true) partial = true;
    }
    if (!Number.isSafeInteger(subtotal)) known = false;
    if (partial) reasons.push("Taxes, fees or requested components are not all covered by the reference total.");
    reasons.push("Supplier must confirm dates, route, group and luggage; this is not a current offer.");
    return { id: p.id, label: p.label, kind: "transport" as const, fit: unsuitable ? "unsuitable" as const : "conditional" as const,
      reasons: distinct(reasons).slice(0, 30), coverage,
      sources: components.flatMap(c => c.sources).filter((r, i, all) => all.findIndex(x => decisionSourceKey(x) === decisionSourceKey(r)) === i),
      price: { subtotalCents: known ? subtotal : null, perPersonCents: known ? Math.ceil(subtotal / brief.partySize) : null, currency,
        completeness: !known ? "unknown" as const : partial ? "partial_reference" as const : "all_in_reference" as const,
        kind: components.some(c => c.quoteState === "fixture") ? "fixture" as const : "reference" as const } };
  });
}

export function compareResearchDecision(input: { brief: ResearchDecisionBrief; sources: DecisionSource[]; extraction: unknown;
  comparisonId: string; previous?: ResearchDecisionComparison | null; limitations?: string[]; mode?: "fixture" | "public_reference" }): ResearchDecisionComparison {
  const brief = ResearchDecisionBriefSchema.parse(input.brief), previous = input.previous;
  if (previous && (previous.kind !== brief.kind || previous.taskId !== brief.taskId || previous.threadId !== brief.threadId || previous.ownerId !== brief.ownerId)) throw new Error("Comparison belongs to a different job kind, task, thread or organizer.");
  const normalized = normalizeDecisionExtraction(brief, input.sources, input.extraction, { requireWineryExperience: input.mode !== "fixture" });
  const candidates = (brief.kind === "winery" ? wineryCandidates(brief, normalized.extraction) : transportCandidates(brief, normalized.extraction))
    .map(c => input.mode === "fixture" ? { ...c, price: { ...c.price, kind: "fixture" as const } } : c);
  const ids = candidates.map(c => c.id);
  const question = brief.kind === "transport" && brief.legs.some(l => !l.origin || !l.destination) ? "Which arrival airport and lodging should we use to compare transport?"
    : brief.kind === "transport" && brief.legs.some(leg => (leg.willingDrivers === undefined ? brief.willingDrivers : leg.willingDrivers) === null)
      ? "How many willing drivers do you have for each airport journey, and how many sober drivers for winery day? Zero is fine; we can compare hired transport."
    : brief.kind === "transport" && brief.legs.some(leg => leg.needsLuggage) && brief.luggagePieces === null
      ? "How many bags will the group bring, including carry-ons? We’ll still need the supplier to confirm sizes and vehicle capacity."
    : !brief.startsOn || !brief.endsOn ? "What are the trip dates so we can check these options for the right days?"
    : !candidates.some(c => c.sources.length) ? "I couldn’t find enough source evidence for these options. Want to try a different public query?"
    : candidates.some(c => c.fit !== "unsuitable") ? null : "Should we widen the shortlist or change the constraint that rules these options out?";
  return ResearchDecisionComparisonSchema.parse({ schemaVersion: 1, kind: brief.kind, id: previous?.id ?? input.comparisonId, revision: (previous?.revision ?? 0) + 1,
    taskId: brief.taskId, threadId: brief.threadId, ownerId: brief.ownerId, briefRevision: brief.revision, contextRevision: brief.contextRevision, evidenceMode: input.mode ?? "public_reference",
    title: brief.title, candidates, selectedIds: previous?.selectedIds.filter(id => ids.includes(id)) ?? [],
    notes: previous?.notes.filter(n => ids.includes(n.candidateId)) ?? [], question,
    limitations: distinct([...(input.limitations ?? []), ...normalized.limitations, "Captured references inform the comparison; they do not confirm availability or authorize booking."]).slice(0, 20),
    sourceRefs: input.sources.map(({ runId, sourceId }) => ({ runId, sourceId })), factRefs: brief.factRefs,
    approval: "not_requested", booking: "not_booked" });
}

/** Organizer refinement updates the existing artifact, not the itinerary or a booking. */
export function refineResearchComparison(comparison: ResearchDecisionComparison, input: {
  actorId: string; taskId: string; threadId: string; briefRevision: number;
  expectedRevision: number; contextRevision: string; selectedIds: string[]; notes: ResearchDecisionComparison["notes"];
}): ResearchDecisionComparison {
  if (comparison.ownerId !== input.actorId || comparison.taskId !== input.taskId || comparison.threadId !== input.threadId
    || comparison.briefRevision !== input.briefRevision || comparison.revision !== input.expectedRevision
    || comparison.contextRevision !== input.contextRevision) throw new Error("Organizer, job, comparison or context changed; reload before refining.");
  return ResearchDecisionComparisonSchema.parse({ ...comparison, revision: comparison.revision + 1, selectedIds: input.selectedIds, notes: input.notes });
}
