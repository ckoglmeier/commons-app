import type { ItineraryContent } from "@commons/contracts";
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export type ItineraryTextTarget = { id: string; text: string; maxLength: number };
/** Explicit prose edits cannot silently reschedule, replace stops or overwrite other paragraphs. */
export function itineraryTextTargets(content: ItineraryContent, request: string): ItineraryTextTarget[] {
  const clauses = request.toLowerCase().replace(/[’‘]/g, "'").split(/[.!\n]+/).map(value => value.trim()).filter(value => value && !/^(?:do not|don't|never|keep|preserve)\b/.test(value));
  const text = clauses.join(". ");
  if (/\b(?:add|remove|drop|skip|move|replace|schedule|reorder|whole|entire)\b/.test(text)) return [];
  const fields = (["opening", "closing", "title"] as const).filter(field => new RegExp(`\\b${field}\\b`).test(text));
  if (fields.length && !/\b(?:day|stop|thursday|friday|saturday|sunday|monday|tuesday|wednesday|questions?)\b/.test(text)) return fields.map(id => ({ id, text: content[id] ?? "", maxLength: id === "title" ? 120 : id === "opening" ? 1500 : 1000 }));
  if (!/\b(?:description|narrative|day notes)\b/.test(text)) return [];
  const named = weekdays.filter(day => new RegExp(`\\b${day}\\b`).test(text));
  return (content.days ?? []).filter(day => named.includes(weekdays[new Date(`${day.day}T12:00:00Z`).getUTCDay()])).map(day => ({ id: `day:${day.day}`, text: day.description, maxLength: 1000 }));
}
export function applyItineraryTextEdits(content: ItineraryContent, targets: ItineraryTextTarget[], edits: Array<{id:string;text:string}>): ItineraryContent {
  if (edits.length !== targets.length || new Set(edits.map(edit => edit.id)).size !== edits.length) throw new Error("The wording edit did not cover the requested text.");
  const next = structuredClone(content);
  for (const edit of edits) {
    const target = targets.find(target => target.id === edit.id);
    if (!target || edit.text.length > target.maxLength) throw new Error("The wording edit exceeded its scope.");
    // Exact clocks and explicitly qualified provider-policy sentences are constraints,
    // not prose the provider may silently discard while shortening a narrative.
    const normalize = (text:string) => text.toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g," ").trim();
    const clocks = target.text.match(/\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/gi) ?? [];
    const qualifiers = target.text.split(/(?<=[.!?])\s+/).filter(sentence => /\b(?:tour|tours|policy|policies|restriction|restrictions)\b/i.test(sentence) && /\b(?:not|no|unavailable|check|verify|confirm|conditional|unverified)\b/i.test(sentence));
    if ([...clocks,...qualifiers].some(text=>!normalize(edit.text).includes(normalize(text)))) throw new Error("The wording edit omitted a supplied time or restriction. The saved draft is unchanged.");
    if (edit.id.startsWith("day:")) { const day = next.days?.find(day => `day:${day.day}` === edit.id); if (!day) throw new Error("The requested day is missing."); day.description = edit.text; }
    else if (edit.id === "opening" || edit.id === "closing" || edit.id === "title") next[edit.id] = edit.text;
    else throw new Error("Unknown text target.");
  }
  return next;
}
