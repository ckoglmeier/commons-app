import { itineraryTextTargets, applyItineraryTextEdits } from "./itinerary-text-edit";
import type { ItineraryContent } from "@commons/contracts";
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** A named-day edit cannot rewrite the opening or another day's human edits. */
export function scopeItineraryRefinement(previous: ItineraryContent, proposed: ItineraryContent, request: string): ItineraryContent {
  const targets = itineraryTextTargets(previous,request);
  if (targets.length) return applyItineraryTextEdits(previous,targets,targets.map(target=>({id:target.id,text: target.id.startsWith("day:") ? proposed.days?.find(day=>`day:${day.day}`===target.id)?.description ?? target.text : proposed[target.id as "opening"|"closing"|"title"] ?? ""})));
  if (/^(?:(?:please|now|ok|okay|let's|lets)[,\s]+)*(?:(?:can|could|would) you\s+)?(?:update|change|shorten|simplify|replace|rework)\b/i.test(request.trim()) && !/\b(?:whole|entire|overall|and|also|day|stop|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(request)) {
    if (/\bopening\b/i.test(request)) return { ...previous, opening: proposed.opening };
    if (/\bclosing\b/i.test(request)) return { ...previous, closing: proposed.closing };
    if (/\btitle\b/i.test(request)) return { ...previous, title: proposed.title };
    if (/\bquestions?\b/i.test(request)) return { ...previous, questions: proposed.questions };
  }
  const names = weekdays.filter(day => new RegExp(`\\b${day}\\b`, "i").test(request));
  if (!names.length || !/^(?:(?:please|now|ok|okay|let's|lets)[,\s]+)*(?:(?:can|could|would) you\s+)?(?:simplify|shorten|rework|remove|drop|skip|move|replace|add|change|update|adjust|make)\b/i.test(request.trim())) return proposed;
  // Requests explicitly covering the whole document are not day-local operations.
  if (/\b(?:whole|entire|overall|every day|all days|opening|title|question)\b/i.test(request)) return proposed;
  const scoped = (day: string | null) => Boolean(day && names.includes(weekdays[new Date(`${day}T12:00:00Z`).getUTCDay()]));
  const retained = previous.items.filter(item => !scoped(item.day));
  const replacements = proposed.items.filter(item => scoped(item.day));
  // Never reuse another day's stable row identity in a local edit.
  if (replacements.some(item => retained.some(old => old.id === item.id))) throw new Error("A day edit cannot move another day's stop without naming that day.");
  return { ...previous, items: [...retained, ...replacements],
    days: [...(previous.days ?? []).map(day => scoped(day.day) ? proposed.days?.find(row => row.day === day.day) ?? day : day), ...(proposed.days ?? []).filter(day => scoped(day.day) && !previous.days?.some(row => row.day === day.day))] };
}


/** Research refreshes evidence/advice; it cannot silently remove or reschedule existing stops. */
export function preserveResearchSchedule(previous: ItineraryContent, proposed: ItineraryContent): ItineraryContent {
  return { ...proposed, items: [
    ...previous.items.map(old => {
      const next = proposed.items.find(item => item.id === old.id);
      return next ? { ...old, note: next.note, participantNote: next.participantNote, evidence: next.evidence, sources: next.sources,
        unresolved: next.unresolved, decision: next.decision ?? old.decision } : old;
    }),
    ...proposed.items.filter(item => !previous.items.some(old => old.id === item.id)),
  ] };
}
