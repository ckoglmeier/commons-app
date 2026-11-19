import {
  EventDraftInterpretationSchema,
  type EventDraftInterpretation,
} from "@commons/contracts";

function firstMeaningfulLine(description: string) {
  return description
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean) ?? "New event";
}

function proposedName(description: string) {
  const first = firstMeaningfulLine(description)
    .replace(/\s+[—-]\s+(summer|spring|fall|winter)\s+(20\d{2})$/i, " $2")
    .replace(/\btrip\b\s*[—:-]?/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return (first || "New event").slice(0, 100);
}

function inferredLocation(description: string, name: string) {
  const namedPlace = name.match(/^([A-Z][A-Za-z .'-]{2,40})(?:\s+20\d{2})?$/)?.[1]?.trim();
  if (namedPlace && !/^(New event|Friends|Couples)$/i.test(namedPlace)) return namedPlace;
  const route = description.match(/(?:possible route|route)\s*:\s*([^\n]+)/i)?.[1];
  if (route) return route.split(/→|->/)[0]?.trim().slice(0, 120) || null;
  const direct = description.match(/\b(?:in|to)\s+([A-Z][A-Za-z .'-]{2,50})(?=[,.;\n]|\s+with\b)/)?.[1];
  return direct?.trim().slice(0, 120) ?? null;
}

function budget(description: string) {
  const range = description.match(/\$\s*([\d,.]+)\s*([kK])?\s*(?:–|-|to)\s*\$?\s*([\d,.]+)\s*([kK])?/);
  if (!range) return { minimum: null, maximum: null };
  const cents = (value: string, thousands: string | undefined) =>
    Math.round(Number(value.replace(/,/g, "")) * (thousands ? 100_000 : 100));
  return {
    minimum: cents(range[1], range[2]),
    maximum: cents(range[3], range[4]),
  };
}

function sectionLines(description: string, headings: string[]) {
  const lines = description.split(/\r?\n/);
  const results: string[] = [];
  let active = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^[A-Za-z][A-Za-z /]+:\s*$/.test(line)) {
      active = headings.some((heading) => line.toLowerCase().startsWith(heading));
      continue;
    }
    if (active && /^[-*]\s+/.test(line)) results.push(line.replace(/^[-*]\s+/, "").slice(0, 180));
  }
  return results.slice(0, 12);
}

function namedPeople(description: string) {
  const names = new Map<string, { displayName: string; email: string | null }>();
  for (const line of description.split(/\r?\n/)) {
    const responsibility = line.trim().match(/^[-*]\s+([A-Z][A-Za-z'-]{1,39})\s*:/)?.[1];
    if (responsibility) names.set(responsibility.toLowerCase(), { displayName: responsibility, email: null });
    const contact = line.trim().match(/^[-*]\s+([A-Z][A-Za-z'-]{1,39}(?:\s+[A-Z][A-Za-z'-]{1,39})?)\s*[—-]\s*([^\s@]+@[^\s@]+\.[^\s@]+)$/);
    if (contact) names.set(contact[1]!.toLowerCase(), { displayName: contact[1]!, email: contact[2]!.toLowerCase() });
  }
  return [...names.values()].slice(0, 24);
}

export function interpretEventDescription(description: string): EventDraftInterpretation {
  const name = proposedName(description);
  const travelSignals = /\b(trip|travel|flight|hotel|cottage|itinerary|route|nights?|drive|airport|train)\b/i.test(description);
  const unsupportedSignals = /\b(wedding|birthday party|dinner party|baby shower|conference)\b/i.test(description);
  const context = [
    /\bcouples?\b/i.test(description) ? "couples" : null,
    /\bfriends?\b/i.test(description) ? "friends" : null,
    /\bfamily|kids?|children\b/i.test(description) ? "family" : null,
  ].filter((value): value is string => Boolean(value));
  const parsedBudget = budget(description);
  const goals = sectionLines(description, ["things people want", "maybe", "goals"]);
  const constraints = sectionLines(description, ["preferences", "important", "constraints"]);
  const supported = travelSignals || !unsupportedSignals;

  return EventDraftInterpretationSchema.parse({
    proposedName: name,
    startsOn: null,
    endsOn: null,
    locationName: inferredLocation(description, name),
    eventTypeKey: supported ? "travel" : "unsupported",
    eventContextKeys: context,
    templateKey: "travel-general",
    templateVersion: 1,
    supported,
    brief: {
      summary: firstMeaningfulLine(description).slice(0, 500),
      budgetMinimumCents: parsedBudget.minimum,
      budgetMaximumCents: parsedBudget.maximum,
      currency: parsedBudget.minimum !== null ? "USD" : null,
      goals,
      constraints,
      suggestedFirstMoves: ["Add the people", "Confirm dates and place", "Add what is already known"],
      unresolvedQuestion: null,
    },
    people: namedPeople(description),
    confidence: travelSignals ? 0.82 : 0.56,
  });
}

export function interpretEventTitle(title: string): EventDraftInterpretation {
  const normalizedTitle = title.trim();
  const interpretation = interpretEventDescription(normalizedTitle);
  return EventDraftInterpretationSchema.parse({
    ...interpretation,
    proposedName: normalizedTitle,
    // A title is a label, not a supplied place. Only an explicit destination phrase is evidence.
    locationName: normalizedTitle.match(/\b(?:in|to)\s+([A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'-]*)*)(?=$|[,.;]|\s+(?:with|for|on|this|next)\b|\s+20\d{2}\b)/)?.[1] ?? null,
    brief: { ...interpretation.brief, summary: normalizedTitle },
  });
}
