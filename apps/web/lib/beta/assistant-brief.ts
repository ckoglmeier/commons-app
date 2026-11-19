/**
 * The portable assistant brief (BR-09). A plain-text format an organizer can ask any assistant to produce, then paste into Commons.
 * Documented for people in docs/ASSISTANT-BRIEF-FORMAT.md. Everything in a brief is untrusted proposed content: parsing it creates nothing,
 * grants nothing, and names no authority. A person reviews the proposal and explicitly starts a private draft.
 */
export const BRIEF_HEADER = "Commons trip brief v1";
export const BRIEF_MAX_CHARS = 6_000;
const MAX_IDEAS = 12, MAX_QUESTIONS = 8, MAX_ITEM = 140;

export type BriefProposal = {
  /** Always "proposed". There is no value that means approved, booked, paid or authorized. */
  status: "proposed";
  authority: "none";
  tripName: string | null;
  destination: string | null;
  startsOn: string | null;
  endsOn: string | null;
  groupSize: number | null;
  budget: { amountCents: number; currency: string; per: "person" | "group" } | null;
  ideas: string[];
  questions: string[];
  notes: string | null;
  /** Fields the brief did not supply or marked unknown. They stay unknown; nothing fills them in. */
  unknown: string[];
  warnings: string[];
};

export type BriefParse = { ok: true; proposal: BriefProposal } | { ok: false; error: string };

const KEYS = ["trip", "where", "when", "group", "budget", "ideas", "questions", "notes"] as const;
type Key = (typeof KEYS)[number];
const UNKNOWN = /^(unknown|not sure|tbd|\?|none|n\/a|-)$/i;

/** True for control characters and invisible direction or joiner marks. Built from code points so no invisible character sits in the source. */
function invisible(code: number) {
  return code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f) || code === 0x7f
    || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff;
}

/** Control characters, markup and invisible direction marks are removed. Text stays text: nothing in a brief is rendered as HTML or followed. */
export function cleanBriefText(value: string) {
  return Array.from(value).filter(char => !invisible(char.codePointAt(0)!)).join("")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const item = (value: string) => cleanBriefText(value.replace(/^[-*•]\s*/, "")).slice(0, MAX_ITEM);
const realDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;

export function parseAssistantBrief(raw: string): BriefParse {
  if (raw.length > BRIEF_MAX_CHARS) return { ok: false, error: `That brief is longer than ${BRIEF_MAX_CHARS} characters. Ask the assistant for a shorter one.` };
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const first = lines.findIndex(line => line.trim() !== "");
  if (first === -1 || lines[first]!.trim().replace(/^#+\s*/, "").toLowerCase() !== BRIEF_HEADER.toLowerCase()) {
    return { ok: false, error: `This doesn't start with “${BRIEF_HEADER}”. Ask the assistant to use the Commons brief format.` };
  }
  const sections = new Map<Key, string[]>();
  const warnings: string[] = [];
  let current: Key | null = null;
  for (const line of lines.slice(first + 1)) {
    const heading = /^\s*([A-Za-z ]{3,12}):\s*(.*)$/.exec(line);
    const key = heading ? (heading[1]!.trim().toLowerCase() as Key) : null;
    if (heading && key && (KEYS as readonly string[]).includes(key)) {
      current = key;
      sections.set(key, [...(sections.get(key) ?? []), ...(heading[2]!.trim() ? [heading[2]!] : [])]);
    } else if (heading && !(KEYS as readonly string[]).includes(heading[1]!.trim().toLowerCase()) && !/^\s*[-*•]/.test(line) && heading[1]!.trim().split(" ").length <= 2) {
      warnings.push(`Ignored an unrecognized line: “${cleanBriefText(line).slice(0, 40)}”.`);
      current = null;
    } else if (current && line.trim()) {
      sections.get(current)!.push(line);
    }
  }
  const one = (key: Key) => {
    const value = cleanBriefText((sections.get(key) ?? []).join(" "));
    return !value || UNKNOWN.test(value) ? null : value;
  };
  const unknown: string[] = [];
  const known = <T,>(name: string, value: T | null) => { if (value === null) unknown.push(name); return value; };

  const tripName = known("trip name", one("trip")?.slice(0, 100) ?? null);
  const destination = known("destination", one("where")?.slice(0, 120) ?? null);

  let startsOn: string | null = null, endsOn: string | null = null;
  const when = one("when");
  if (when) {
    const dates = when.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    if (dates.length >= 1 && dates.length <= 2 && dates.every(realDate)) {
      [startsOn, endsOn] = [dates[0]!, dates[1] ?? dates[0]!];
      if (endsOn < startsOn) { warnings.push("The end date is before the start date, so no dates were proposed."); startsOn = endsOn = null; }
    } else warnings.push("Dates must be written as YYYY-MM-DD. No dates were proposed.");
  }
  if (!startsOn) unknown.push("dates");

  const groupText = one("group");
  const groupMatch = groupText ? /\d{1,3}/.exec(groupText) : null;
  const groupSize = groupMatch && Number(groupMatch[0]) >= 1 && Number(groupMatch[0]) <= 60 ? Number(groupMatch[0]) : null;
  if (groupText && groupSize === null) warnings.push("Group size wasn't a number from 1 to 60, so it was left blank.");
  known("group size", groupSize);

  let budget: BriefProposal["budget"] = null;
  const budgetText = one("budget");
  if (budgetText) {
    const match = /(\d[\d,]*(?:\.\d{1,2})?)\s*([A-Za-z]{3})?(?:\s*(?:per|\/)\s*(person|group|traveler|head))?/i.exec(budgetText);
    const cents = match ? Math.round(Number(match[1]!.replace(/,/g, "")) * 100) : NaN;
    if (match && Number.isFinite(cents) && cents > 0 && cents <= 100_000_000_00) {
      budget = { amountCents: cents, currency: (match[2] ?? "USD").toUpperCase(), per: /group/i.test(match[3] ?? "") ? "group" : "person" };
    } else warnings.push("The budget wasn't a clear amount, so it was left blank.");
  }
  known("budget", budget);

  const list = (key: Key, max: number) => {
    const values = (sections.get(key) ?? []).map(item).filter(value => value && !UNKNOWN.test(value));
    if (values.length > max) warnings.push(`Kept the first ${max} ${key}.`);
    return [...new Set(values)].slice(0, max);
  };
  const ideas = list("ideas", MAX_IDEAS), questions = list("questions", MAX_QUESTIONS);
  const notes = one("notes")?.slice(0, 500) ?? null;
  if (/https?:\/\//i.test(raw)) warnings.push("Links in the brief are shown as text and are never opened.");

  if (!tripName && !destination && !startsOn && !ideas.length) return { ok: false, error: "That brief had nothing Commons could use. Ask the assistant to fill in at least a trip name or destination." };
  return { ok: true, proposal: { status: "proposed", authority: "none", tripName, destination, startsOn, endsOn, groupSize, budget, ideas, questions, notes, unknown, warnings } };
}

/**
 * Maps a reviewed proposal onto the existing draft fields. Ideas and questions become the draft's goals and first moves; budget, if present,
 * is a planning range, not a charge. This is a mapping only: the caller must still create the draft through the existing path on an explicit action.
 */
export function proposalToDraftFields(proposal: BriefProposal) {
  return {
    proposedName: proposal.tripName ?? "New trip",
    locationName: proposal.destination,
    startsOn: proposal.startsOn,
    endsOn: proposal.endsOn,
    brief: {
      summary: proposal.notes ? proposal.notes.slice(0, 500) : "Brought from an assistant brief",
      goals: proposal.ideas.map(idea => `Consider: ${idea}`.slice(0, 180)),
      constraints: [],
      suggestedFirstMoves: proposal.questions.slice(0, 6).map(question => question.slice(0, 120)),
      unresolvedQuestion: proposal.questions[0]?.slice(0, 240) ?? null,
      budgetMinimumCents: null as number | null,
      budgetMaximumCents: null as number | null,
      currency: null as string | null,
    },
  };
}
