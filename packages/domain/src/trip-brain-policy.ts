import { BrainFindingSchema, type BrainFinding, type BrainSnapshot } from "@commons/contracts";
/** Grounding is code-enforced, and no review has action/tool authority. */
export function validateBrainFindings(snapshot: BrainSnapshot, raw: unknown): BrainFinding[] {
  if (!Array.isArray(raw) || raw.length > 3) throw new Error("Review exceeds its finding limit");
  const seen = new Set<string>();
  const candidates = new Map(candidateFamilies(snapshot).flat().map(candidate => [candidate.key, candidate]));
  return raw.map(value => {
    const finding = BrainFindingSchema.parse(value);
    if (seen.has(finding.key)) throw new Error("Duplicate finding"); seen.add(finding.key);
    if (finding.evidence.some(ref => !snapshot.facts.some(fact => fact.id === ref.id && fact.version === ref.version))) throw new Error("Unsupported evidence");
    const grounded=candidates.get(finding.key);
    if(!grounded || JSON.stringify(grounded.evidence) !== JSON.stringify(finding.evidence))throw new Error("Unsupported finding");
    // Models may select evidence, never manufacture claims or action authority. Present code-grounded wording.
    return grounded;
  });
}
/** Synthetic/free baseline: conservative saved-state checks, never inferred capacity. */
function candidateFamilies(snapshot: BrainSnapshot): BrainFinding[][] {
  // Canonical ordering keeps selection, wording and evidence stable under row permutations.
  // Earlier saved dates come first within each family; dates do not establish urgency.
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const facts = [...snapshot.facts].sort((a, b) => compare(a.start ?? "9999", b.start ?? "9999") || compare(a.id, b.id));
  const missingTimes: BrainFinding[] = [], overlaps: BrainFinding[] = [], transport: BrainFinding[] = [], capacity: BrainFinding[] = [], stale: BrainFinding[] = [];
  const events = facts.filter(f => f.kind === "plan" && f.start && f.end && ["planned", "confirmed"].includes(f.status));
  for (let i = 0; i < events.length; i++) for (let j = i + 1; j < events.length; j++) {
    const a = events[i], b = events[j];
    const label = (value: string) => value.length > 120 ? `${value.slice(0,119)}…` : value;
    if (Date.parse(a.start!) < Date.parse(b.end!) && Date.parse(b.start!) < Date.parse(a.end!)) overlaps.push({ key: `overlap:${[a.id, b.id].sort().join(":")}`, title: "Review overlapping plans", detail: `“${label(a.label)}” and “${label(b.label)}” overlap in the saved schedule. Check who is attending before changing either.`, evidence: [{ id: a.id, version: a.version }, { id: b.id, version: b.version }], goal: "Review the overlapping saved plans and prepare an exact proposed correction if needed.", query: "", kind: "plan_action" });
  }
  for (const fact of facts.filter(f => f.kind === "plan" && f.status === "idea" && /transport|transfer|van|shuttle/i.test(f.label))) {
    transport.push({ key: `transport:${fact.id}`, title: "Resolve transportation", detail: `“${fact.label}” is still an idea. Saved state does not establish capacity, timing or a reservation.`, evidence: [{ id: fact.id, version: fact.version }], goal: `Compare public transportation references for ${fact.label}, including capacity and unknowns.`, query: fact.label, kind: "research" });
  }
  for(const fact of facts.filter(f=>f.capacity && f.groupPeople && f.groupPeople>f.capacity)) {
    capacity.push({key:`capacity:${fact.id}`,title:"Review transfer capacity",detail:`“${fact.label}” explicitly records ${fact.capacity} seats. ${fact.groupPeople} people have shared arrivals on that day. Check who uses this vehicle; attendance and additional vehicles are unknown.`,evidence:[{id:fact.id,version:fact.version},...facts.filter(f=>f.kind === "arrival" && fact.start && f.start?.startsWith(brainLocalDay(new Date(fact.start),snapshot.timezone))).slice(0,7).map(f=>({id:f.id,version:f.version}))],goal:"Compare transport capacity for the shared arrivals and list unresolved timing and attendance.",query:"Group airport transfer vehicle capacity options",kind:"research"});
  }
  for(const fact of facts.filter(f=>f.kind === "research" && f.status === "stale")){
    stale.push({key:`stale:${fact.id}`,title:"Recheck older research",detail:`“${fact.label}” was retrieved more than seven days ago. Availability and prices remain unverified. Recheck explicitly if this decision still matters.`,evidence:[{id:fact.id,version:fact.version}],goal:`Recheck public references for ${fact.label}, with retrieval dates and unknowns.`,query:fact.publicQuery??fact.label,kind:"research"});
  }
  const today = brainLocalDay(new Date(snapshot.capturedAt),snapshot.timezone);
  for (const fact of facts.filter(f => ["arrival","transport"].includes(f.kind) && f.start && /^\d{4}-\d{2}-\d{2}$/.test(f.start) && f.start >= today)) {
    const time = fact.kind === "transport" ? "pickup" : "arrival";
    missingTimes.push({key:`missing-time:${fact.id}`,title:`Check ${time} time: ${fact.label}`.slice(0,160),detail:`“${fact.label}” has a saved day but no ${time} time. Check the details when ready; a missing time does not mean it is unbooked.`,evidence:[{id:fact.id,version:fact.version}],goal:`Check the ${time} time for ${fact.label}.`,query:"",kind:"plan_action"});
  }
  return [capacity, overlaps, missingTimes, stale, transport];
}
export function brainLocalDay(at: Date, timezone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
export function brainPhase(today: string, startsOn: string | null, endsOn: string | null): BrainSnapshot["phase"] {
  if (endsOn && today > endsOn) return "ended";
  if (startsOn && today >= startsOn) return "during";
  return startsOn && Date.parse(`${startsOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`) <= 30 * 86400_000 ? "approaching" : "planning";
}

export const BRAIN_CANDIDATE_LIMIT = 12;
/**
 * Enumerate every supported saved-fact check before bounding the ranking pool.
 * Round-robin families prevent dense overlap graphs from monopolizing selection.
 * Explicit capacity discrepancies, saved overlaps, stale references, then transport
 * ideas are the tie order. This is a conservative breadth policy, not inferred urgency.
 */
export function brainCandidatePool(snapshot: BrainSnapshot) {
  const families = candidateFamilies(snapshot), candidates: BrainFinding[] = [];
  const totalCandidates = families.reduce((total, family) => total + family.length, 0);
  for (let row = 0; candidates.length < Math.min(totalCandidates, BRAIN_CANDIDATE_LIMIT); row++) {
    for (const family of families) {
      if (family[row] && candidates.length < BRAIN_CANDIDATE_LIMIT) candidates.push(family[row]);
    }
  }
  return { candidates, totalCandidates, omittedCandidates: totalCandidates - candidates.length };
}
export function brainSelectionCoverage(snapshot: BrainSnapshot): string[] {
  const pool = brainCandidatePool(snapshot);
  return [
    "Saved-fact review balances capacity discrepancies, overlaps, missing travel times, older research and transport ideas; saved dates order each category, without establishing urgency.",
    ...(pool.totalCandidates > 3 ? [`${pool.totalCandidates} supported findings; a review shows at most three. Additional findings may be omitted.`] : []),
    ...(pool.omittedCandidates ? [`Bounded model ranking includes ${pool.candidates.length} candidates; ${pool.omittedCandidates} other supported findings are excluded from that pool.`] : []),
  ];
}
export function deterministicBrainReview(snapshot: BrainSnapshot): BrainFinding[] {
  return validateBrainFindings(snapshot, brainCandidatePool(snapshot).candidates.slice(0, 3));
}
