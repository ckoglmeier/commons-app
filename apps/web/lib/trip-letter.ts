import { TRIP_LETTER_SECTION_IDS, type CommonsParticipant, type CommonsState, type CommonsSummary, type TripLetterSections } from "@commons/contracts";
import { homeShortcuts } from "./home-dashboard";

/** A personal fact is about the viewer ("You’re not on it yet"), so it stays on their page and out of an update shared with the group. */
export type TripLetterFact = { label: string; value: string; personal?: true };
type SectionId = TripLetterSections[number]["id"];

export const DEFAULT_LETTER_SECTIONS: TripLetterSections = TRIP_LETTER_SECTION_IDS.map(id => ({ id, hidden: false }));

export function tripLetterSectionLabel(id: SectionId) {
  return { welcome: "Welcome", facts: "Trip facts", photo: "Photo", latest: "Latest" }[id];
}

export function moveLetterSection(sections: TripLetterSections, id: SectionId, direction: -1 | 1): TripLetterSections {
  const index = sections.findIndex(section => section.id === id), target = index + direction;
  if (index < 0 || target < 0 || target >= sections.length) return sections;
  const next = [...sections];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function dayLabel(date: string, withYear: boolean) {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

const peopleCount = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

function tripDates(startsOn: string | null, endsOn: string | null) {
  if (!startsOn || !endsOn) {
    if (startsOn) return `Starts ${dayLabel(startsOn, true)}`;
    if (endsOn) return `Ends ${dayLabel(endsOn, true)}`;
    return "Still open";
  }
  if (startsOn === endsOn) return dayLabel(startsOn, true);
  const sameYear = startsOn.slice(0, 4) === endsOn.slice(0, 4);
  if (sameYear && startsOn.slice(0, 7) === endsOn.slice(0, 7)) return `${dayLabel(startsOn, false)}–${Number(endsOn.slice(8))}, ${startsOn.slice(0, 4)}`;
  return `${dayLabel(startsOn, !sameYear)} – ${dayLabel(endsOn, true)}`;
}

/** The letter states only saved facts. Unknown values stay visibly open, never inferred. */
export function tripLetterFacts(state: CommonsState, commons: CommonsSummary, personId: string, participation: CommonsState["participation"], now: number): TripLetterFact[] {
  const shortcuts = homeShortcuts(state, commons, personId, participation, now);
  const stay = shortcuts.stay ?? shortcuts.legacyStay;
  const places = commons.locationNames?.length ? commons.locationNames.join(", ") : commons.locationName;
  const facts: TripLetterFact[] = [
    { label: "When", value: tripDates(commons.startsOn, commons.endsOn) },
    { label: "Where", value: places ?? "Still open" },
    stay || !shortcuts.groupStay ? { label: "Staying", value: stay?.name ?? "Nothing saved yet" }
      : { label: "Staying", value: `${shortcuts.groupStay.name} is booked for ${peopleCount(shortcuts.groupStay.includedPersonIds.length)}. You’re not on it yet.`, personal: true },
  ];
  if (shortcuts.next?.startsAt) {
    const at = new Intl.DateTimeFormat("en-US", { timeZone: commons.timezone, month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(shortcuts.next.startsAt));
    facts.push({ label: "First up", value: `${shortcuts.next.title}, ${at}` });
  }
  return facts;
}

/**
 * A short update built only from what the letter already shows the group: saved facts and shared changes.
 * Nothing private enters it, because nothing private is passed to it. The link carries no access of its own.
 */
export function tripLetterUpdateText(input: { name: string; facts: readonly TripLetterFact[]; updates: readonly { title: string; detail: string }[]; url: string }) {
  const lines = [`${input.name}: where things stand`];
  for (const fact of input.facts) if (!fact.personal && fact.value !== "Still open" && fact.value !== "Nothing saved yet") lines.push(`${fact.label}: ${fact.value}`);
  if (input.updates.length) {
    lines.push("", "New:");
    for (const update of input.updates.slice(0, 3)) lines.push(`${update.title} (${update.detail.toLowerCase()})`);
  }
  lines.push("", input.url);
  return lines.join("\n");
}

/** Only a real saved change can date the letter. A trip with nobody else on it says so instead. */
export function tripLetterDateline(state: CommonsState, commons: CommonsSummary, participants: readonly CommonsParticipant[], currentActorId: string) {
  if (!participants.some(person => person.id !== currentActorId)) return "Only you can see this page";
  const latest = state.auditEvents.reduce<string | null>((newest, event) => !newest || event.occurredAt > newest ? event.occurredAt : newest, null);
  if (!latest) return null;
  return `Updated ${new Intl.DateTimeFormat("en-US", { timeZone: commons.timezone, month: "long", day: "numeric" }).format(new Date(latest))}`;
}
