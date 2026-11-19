import type { ItineraryDraft } from "@commons/contracts";

export type ItineraryInstruction = { key: string; text: string; turnId: string | null; actorId: string | null; at: string | null };
export const ITINERARY_DISCOVERY_SOURCES = 30;
export function itinerarySourceKey(source: { runId: string; sourceId: string }) { return `${source.runId}:${source.sourceId}`; }

/** Exact deduplication only; code must not guess that a later request rescinds an
 * earlier constraint. Conflicts remain attributed for the model to explain.
 */
export function itineraryInstructions(previous: ItineraryDraft | null, history: ItineraryInstruction[], current: ItineraryInstruction) {
  const seen = new Set<string>(), result: ItineraryInstruction[] = [];
  const known = new Set(history.map(row => row.text));
  for (const row of [...(previous?.corrections ?? []).filter(text => !known.has(text)).map((text, index) => ({ key: `legacy:${index}`, text, turnId: null, actorId: null, at: null })), ...history, current]) {
    if (seen.has(row.text)) continue;
    seen.add(row.text); result.push(row);
  }
  return result;
}

/** Pin all sources supporting current candidates; discovery is a rolling window,
 * not cumulative storage. Missing pinned evidence fails closed, never demotes a claim.
 */
export function itineraryEvidenceWindow(content: ItineraryDraft["content"], archive: ItineraryDraft["evidence"], previous: ItineraryDraft["evidence"] = []) {
  const archived = new Set(archive.map(itinerarySourceKey));
  // Previous is only a legacy/pinned fallback. Updating a Map value does not
  // move its insertion order; seeding discovery with the previous window would
  // otherwise rotate the next projection backwards into older evidence.
  const all = new Map([...previous.filter(source => !archived.has(itinerarySourceKey(source))), ...archive].map(source => [itinerarySourceKey(source), source]));
  // Shortlist option sources are claims too: keep them while the shortlist cites them.
  const pinned = new Set(content.items.flatMap(item => [...item.sources, ...(item.decision?.shortlist ?? []).flatMap(option => option.sources)].map(itinerarySourceKey)));
  for (const key of pinned) if (!all.has(key)) throw new Error("Current itinerary evidence is unavailable.");
  const discovery = [...all.values()].filter(source => !pinned.has(itinerarySourceKey(source))).slice(-ITINERARY_DISCOVERY_SOURCES);
  return [...[...pinned].map(key => all.get(key)!), ...discovery];
}
