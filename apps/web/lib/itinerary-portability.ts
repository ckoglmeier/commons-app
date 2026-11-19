import { ITINERARY_EXPORT_FORMAT, ITINERARY_IMPORT_TEXT_LIMIT, ItineraryContentSchema, itineraryContentEqual, type ItineraryContent, type ItineraryImportChange } from "@commons/contracts";
import { parseItineraryText } from "./itinerary-workshop";

/*
 * Readable Markdown export and deterministic re-import for the private itinerary document.
 *
 * The export carries only participant-visible fields (title, opening, closing, day labels and notes, stop
 * titles/times/notes/venues, optional questions). Organizer notes, locations, sources, driver brief, Tasks,
 * receipts and costs never leave. Re-import compares the returned file with the exported version and the
 * current saved version. Tags such as {#s3} are positions in the exported version; the server rebuilds them
 * from its own saved copy, so a file can never name an arbitrary record. No model is involved.
 */

type Item = ItineraryContent["items"][number];
export type ItineraryExportMeta = { tripId: string; threadId: string; documentId: string; version: number; exportedAt: string };
export type ItineraryImportMeta = { tripId: string; threadId: string; documentId: string; baseVersion: number };
export class ItineraryImportError extends Error {}

const clock = (time: string) => { const hour = Number(time.slice(0, 2)); return `${hour % 12 || 12}:${time.slice(3)} ${hour >= 12 ? "PM" : "AM"}`; };
const dateLabel = (day: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const timeText = (item: Pick<Item, "time" | "endTime">) => item.time ? `${clock(item.time)}${item.endTime ? `–${clock(item.endTime)}` : ""}` : "";
const optionalSuffix = /\s*\(optional\)\s*$/i;
const displayTitle = (item: Pick<Item, "title" | "participation">) => `${item.title}${item.participation === "optional" && !optionalSuffix.test(item.title) ? " (optional)" : ""}`;

/** Deterministic tags for one saved version: days, then stops in reading order, then ideas, then questions. */
export function itineraryLayout(content: ItineraryContent) {
  const dates = [...new Set([...(content.days ?? []).map(day => day.day), ...content.items.flatMap(item => item.day ? [item.day] : [])])].sort();
  const itemRefs = new Map<string, string>(), dayRefs = new Map<string, string>(), questionRefs = new Map<string, string>();
  let stop = 0;
  const days = dates.map((date, index) => {
    const section = content.days?.find(day => day.day === date), ref = `d${index + 1}`;
    dayRefs.set(ref, date);
    const items = content.items.filter(item => item.day === date).map(item => { const tag = `s${++stop}`; itemRefs.set(tag, item.id); return { ref: tag, item }; });
    return { ref, date, label: section?.label?.trim() || dateLabel(date), description: section?.description ?? "", items };
  });
  const ideas = content.items.filter(item => !item.day).map(item => { const tag = `s${++stop}`; itemRefs.set(tag, item.id); return { ref: tag, item }; });
  const questions = (content.questions ?? []).map((question, index) => { const ref = `q${index + 1}`; questionRefs.set(ref, question.id); return { ref, question }; });
  return { days, ideas, questions, itemRefs, dayRefs, questionRefs };
}

// Lines that would otherwise read as structure on the way back in are escaped with one backslash.
const structural = /^(?:#|[-*•+]\s|\d+[.)]\s|\||~~|>|\\|```|venue:|choice:|---\s*$|\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*(?:[-–—:]|$))/i;
const inline = (value: string) => value.replace(/\s*\n\s*/g, " ").trim();
/** Prose keeps its paragraph breaks; indented stop notes stay compact. Blank-line differences never count as edits. */
const block = (value: string, indent = "") => value.replace(/\t/g, " ").split(/\r?\n/).map(line => line.trim()).filter((line, index, all) => indent ? Boolean(line) : Boolean(line) || Boolean(all[index - 1]))
  .map(line => line ? `${indent}${structural.test(line) || /\{#[sdq]\d{1,3}\}\s*$/i.test(line) ? "\\" : ""}${line}` : "");
const norm = (value: string | null | undefined) => (value ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).join("\n");

export function itineraryMarkdown(content: ItineraryContent, meta: ItineraryExportMeta) {
  const layout = itineraryLayout(content), lines = [`# ${inline(content.title)}`, ""];
  const opening = content.opening?.trim();
  if (opening) lines.push(...block(opening), "");
  const stopLines = (ref: string, item: Item, bullet: boolean) => [
    `${!bullet && item.time ? `${timeText(item)} — ` : "- "}${inline(displayTitle(item))} {#${ref}}`,
    ...block(item.participantNote ?? "", "  "),
    ...(item.venue?.trim() ? [`  Venue: ${inline(item.venue)}`] : []),
    ...(item.decision ? [`  Choice: ${inline(item.decision.question)}: ${item.decision.options.map(inline).join(" / ")}`] : []),
  ];
  for (const day of layout.days) {
    lines.push(`## ${inline(day.label)} {#${day.ref}}`, "");
    if (day.description.trim()) lines.push(...block(day.description), "");
    for (const { ref, item } of day.items) lines.push(...stopLines(ref, item, false));
    lines.push("");
  }
  if (layout.ideas.length) { lines.push("## Ideas if they fit", ""); for (const { ref, item } of layout.ideas) lines.push(...stopLines(ref, item, true)); lines.push(""); }
  if (layout.questions.length) { lines.push("## Questions for the group", ""); for (const { ref, question } of layout.questions) lines.push(`- ${inline(question.prompt)} {#${ref}}`); lines.push(""); }
  if (content.closing?.trim()) lines.push("## Closing note", "", ...block(content.closing), "");
  lines.push("---", "", "To bring changes back to Commons, keep the {#…} tags and the block below. Strike a stop through (~~like this~~) to remove it; stops you delete from this file stay in Commons. Choices are edited in Commons. Private notes, sources, tasks and costs are not included.", "",
    "```commons-itinerary", `format: ${ITINERARY_EXPORT_FORMAT}`, `trip: ${meta.tripId}`, `thread: ${meta.threadId}`, `document: ${meta.documentId}`, `base-version: ${meta.version}`, `exported: ${meta.exportedAt}`, "```", "");
  return lines.join("\n");
}

export function itineraryExportFilename(title: string, version: number) {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 60) || "itinerary";
  return `${base}-v${version}.md`;
}

// ---------------------------------------------------------------------------------------------- import

type ImportedStop = { ref: string | null; remove: boolean; title: string; optional: boolean; timeText: string; note: string; venue: string; line: string };
type ImportedSection = { ref: string | null; label: string; description: string; stops: ImportedStop[] };
export type ParsedItineraryImport = {
  meta: ItineraryImportMeta | null; metaError: string | null;
  title: string | null; opening: string | null; closing: string | null;
  days: ImportedSection[]; ideas: ImportedStop[] | null;
  questions: Array<{ ref: string | null; prompt: string; remove: boolean }> | null;
  problems: string[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tag = /\s*\{#([sdq]\d{1,3})\}\s*$/i, removeMark = "{!remove}";
const unescape = (line: string) => line.replace(/^\\/, "");
const strike = (line: string) => {
  const match = line.match(/^(\s*(?:[-*•+]|\d+[.)])\s+)?~~(.+?)~~\s*(\{#[sdq]\d{1,3}\})?\s*$/i);
  return match ? `${match[1] ?? ""}${match[2].trim()}${match[3] ? ` ${match[3]}` : ""} ${removeMark}` : line;
};
const ideasHeading = /^(?:other ideas(?: if they fit)?|optional (?:ideas|activities)|ideas if they fit):?$/i;

function readMeta(body: string): { meta: ItineraryImportMeta | null; metaError: string | null } {
  const values = new Map(body.split(/\r?\n/).map(line => line.match(/^\s*([a-z-]+)\s*:\s*(.+?)\s*$/i)).filter((match): match is RegExpMatchArray => Boolean(match)).map(match => [match[1].toLowerCase(), match[2]]));
  const version = Number(values.get("base-version"));
  if (values.get("format") !== ITINERARY_EXPORT_FORMAT) return { meta: null, metaError: "This file’s Commons details use a format this version can’t read." };
  if (![values.get("trip"), values.get("thread"), values.get("document")].every(value => value && uuid.test(value)) || !Number.isInteger(version) || version < 1) return { meta: null, metaError: "This file’s Commons details are damaged, so it can’t be matched to an itinerary." };
  return { meta: { tripId: values.get("trip")!.toLowerCase(), threadId: values.get("thread")!.toLowerCase(), documentId: values.get("document")!.toLowerCase(), baseVersion: version }, metaError: null };
}

/** Deterministic: section splitting here, stop and day parsing through the existing pasted-itinerary parser. */
export function parseItineraryImport(raw: string): ParsedItineraryImport {
  if (raw.length > ITINERARY_IMPORT_TEXT_LIMIT) throw new ItineraryImportError("Use up to 30,000 characters. Nothing was truncated.");
  let text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const blocks = [...text.matchAll(/^```commons-itinerary[^\n]*\n([\s\S]*?)^```[ \t]*$/gm)];
  let meta: ItineraryImportMeta | null = null, metaError: string | null = null;
  if (blocks.length > 1) metaError = "This file has more than one block of Commons details, so it can’t be matched safely.";
  else if (blocks.length === 1) ({ meta, metaError } = readMeta(blocks[0][1]));
  else if (/commons-itinerary/i.test(text)) metaError = "This file’s Commons details are incomplete, so it can’t be matched to an itinerary.";
  if (blocks.length) {
    const following = text.slice(blocks[0].index! + blocks[0][0].length);
    text = text.slice(0, blocks[0].index);
    // Drop the export's own trailer: the rule and its instruction line.
    const tail = text.split("\n");
    while (tail.length && (!tail.at(-1)!.trim() || /^---\s*$/.test(tail.at(-1)!.trim()) || /^To bring changes back to Commons/.test(tail.at(-1)!.trim()))) tail.pop();
    text = `${tail.join("\n")}\n${following}`;
  }
  const lines = text.split("\n"), problems: string[] = [];
  let index = lines.findIndex(line => line.trim());
  let title: string | null = null;
  if (index >= 0 && /^#\s+\S/.test(lines[index].trim())) { title = lines[index].trim().replace(/^#\s+/, "").trim(); index++; } else index = Math.max(index, 0);
  type Section = { heading: string | null; body: string[] };
  const sections: Section[] = [{ heading: null, body: [] }];
  for (const line of lines.slice(index)) {
    if (/^##\s+\S/.test(line.trim()) && !/^###/.test(line.trim())) sections.push({ heading: line.trim().replace(/^##\s+/, ""), body: [] });
    else sections.at(-1)!.body.push(line);
  }
  const prose = (body: string[]) => body.map(line => unescape(line.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const classify = (heading: string) => { const plain = heading.replace(tag, "").trim(); return ideasHeading.test(plain) ? "ideas" : /^questions(?: for the group)?:?$/i.test(plain) ? "questions" : /^closing(?: note)?:?$/i.test(plain) ? "closing" : "day"; };
  const structured = sections.slice(1).some(section => ["day", "ideas"].includes(classify(section.heading!)));
  let opening: string | null = null, closing: string | null = null;
  let questions: ParsedItineraryImport["questions"] = null;
  const parserInput: string[] = [];
  if (structured || meta || metaError) opening = prose(sections[0].body) || null;
  else parserInput.push(...sections[0].body.map(strike));
  for (const section of sections.slice(1)) {
    const kind = classify(section.heading!);
    if (kind === "closing") closing = prose(section.body) || null;
    else if (kind === "questions") questions = section.body.map(line => strike(line.trim())).filter(Boolean).map(line => {
      const remove = line.includes(removeMark), plain = line.replace(removeMark, "").replace(/^(?:[-*•+]|\d+[.)])\s+/, "").trim(), ref = plain.match(tag)?.[1]?.toLowerCase() ?? null;
      return { ref, prompt: unescape(plain.replace(tag, "").trim()), remove };
    }).filter(question => question.prompt);
    else parserInput.push(kind === "ideas" ? "Ideas if they fit" : `## ${section.heading}`, ...section.body.map(strike));
  }
  let days: ImportedSection[] = [], ideas: ImportedStop[] | null = null;
  if (parserInput.some(line => line.trim())) {
    try {
      // The shared parser needs one scheduled day; a placeholder lets a file with only ideas still parse.
      const sentinel = structured ? ["## Commons import placeholder", "- Commons import placeholder"] : [];
      const snapshot = parseItineraryText([...sentinel, ...parserInput].join("\n"), title ?? "Imported itinerary");
      snapshot.days = snapshot.days.filter(day => day.label !== "Commons import placeholder");
      // A tagged line always stays its own stop, even when the shared parser read it as a note of the stop above.
      const stops = (line: string, time: string, details: string): ImportedStop[] => {
        const rows: Array<{ line: string; time: string; details: string[] }> = [{ line, time, details: [] }];
        for (const detail of details.split("\n").map(value => value.trim()).filter(Boolean)) {
          if (tag.test(detail.replace(removeMark, "")) && !detail.startsWith("\\")) {
            const split = detail.match(/^(.+?)\s+[—–-]\s+(.+)$/);
            rows.push({ line: split ? split[2] : detail, time: split ? split[1] : "", details: [] });
          } else rows.at(-1)!.details.push(detail);
        }
        return rows.map(row => {
          const remove = row.line.includes(removeMark), cleaned = row.line.replace(removeMark, "").trim(), ref = cleaned.match(tag)?.[1]?.toLowerCase() ?? null;
          let titled = unescape(cleaned.replace(tag, "").trim()), timeValue = row.time.trim();
          // "- 6:00 PM Dinner": a bulleted line that starts with a clock time keeps that time.
          const lead = !timeValue ? titled.match(/^(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?(?:\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)?)\s*(?:[—–:·-]\s*|\s+)(\S.*)$/i) : null;
          if (lead && /:|[ap]\.?m/i.test(lead[1]) && parseTimeRange(lead[1])) { timeValue = lead[1].trim(); titled = lead[2].trim(); }
          const notes: string[] = [];
          let venue = "";
          for (const detail of row.details) {
            if (/^venue:/i.test(detail)) venue = detail.replace(/^venue:\s*/i, "").trim();
            else if (!/^choice:/i.test(detail)) notes.push(unescape(detail));
          }
          return { ref, remove, title: titled.replace(optionalSuffix, "").trim(), optional: optionalSuffix.test(titled), timeText: timeValue, note: notes.join("\n"), venue, line: `${timeValue ? `${timeValue} — ` : ""}${titled}` };
        });
      };
      days = snapshot.days.filter(day => !(day.label === "Itinerary" && !day.items.length)).map(day => {
        const ref = day.label.match(tag)?.[1]?.toLowerCase() ?? null;
        return { ref, label: unescape(day.label.replace(tag, "").trim()), description: prose(day.description.split("\n")), stops: day.items.flatMap(item => stops(item.title, item.time, item.details)) };
      });
      ideas = snapshot.otherIdeas.length || parserInput.includes("Ideas if they fit") ? snapshot.otherIdeas.flatMap(idea => stops(idea.title, "", idea.details)) : null;
    } catch (error) {
      problems.push(`${error instanceof Error ? error.message : "The schedule couldn’t be read."} The schedule text was not applied.`);
    }
  }
  return { meta, metaError, title, opening, closing, days, ideas, questions, problems };
}

/** "9 AM", "9:30 pm", "14:00", "9–11 AM", "7:30 PM–9 PM". Anything else stays unrecognized rather than guessed. */
export function parseTimeRange(value: string): { time: string; endTime: string | null } | null {
  const part = String.raw`(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?`;
  const match = value.trim().match(new RegExp(String.raw`^${part}(?:\s*(?:[-–—]|to)\s*${part})?$`, "i"));
  if (!match) return null;
  const at = (hour: string, minute: string | undefined, period: string | undefined) => {
    let h = Number(hour); const m = Number(minute ?? "0");
    if (m > 59 || h > 23 || period && (h < 1 || h > 12)) return null;
    if (period) h = h % 12 + (period.toLowerCase() === "p" ? 12 : 0);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const endPeriod = match[6], startPeriod = match[3] ?? (match[4] && endPeriod && Number(match[1]) <= Number(match[4]) ? endPeriod : undefined);
  const time = at(match[1], match[2], startPeriod), end = match[4] ? at(match[4], match[5], endPeriod) : null;
  if (!time || match[4] && (!end || end <= time)) return null;
  return { time, endTime: end };
}

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** A heading's date: explicit ISO, month and day, a weekday that occurs once in the trip, or Day N. Never a guess outside the trip. */
export function dayFromHeading(label: string, facts: { startsOn: string | null; endsOn: string | null }) {
  const inTrip = (date: string) => (!facts.startsOn || date >= facts.startsOn) && (!facts.endsOn || date <= facts.endsOn);
  const valid = (date: string) => !Number.isNaN(new Date(`${date}T12:00:00Z`).getTime()) && new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date;
  const iso = label.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return valid(iso[0]) && inTrip(iso[0]) ? iso[0] : null;
  const named = label.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i) ?? label.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/i);
  if (named) {
    const [monthName, dayNumber] = /^\d/.test(named[1]) ? [named[2], named[1]] : [named[1], named[2]];
    const month = months.indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
    const years = named[3] ? [Number(named[3])] : [...new Set([facts.startsOn, facts.endsOn].flatMap(date => date ? [Number(date.slice(0, 4))] : []))];
    const found = years.map(year => `${year}-${String(month).padStart(2, "0")}-${String(Number(dayNumber)).padStart(2, "0")}`).filter(date => valid(date) && inTrip(date));
    return found.length === 1 ? found[0] : null;
  }
  if (!facts.startsOn || !facts.endsOn) return null;
  const span: string[] = [];
  for (let date = new Date(`${facts.startsOn}T12:00:00Z`); date.toISOString().slice(0, 10) <= facts.endsOn && span.length < 60; date.setUTCDate(date.getUTCDate() + 1)) span.push(date.toISOString().slice(0, 10));
  const numbered = label.match(/^day\s+(\d{1,2})\b/i);
  if (numbered) return span[Number(numbered[1]) - 1] ?? null;
  const weekday = weekdays.findIndex(name => new RegExp(`^${name}\\b`, "i").test(label.trim()));
  if (weekday < 0) return null;
  const matches = span.filter(date => new Date(`${date}T12:00:00Z`).getUTCDay() === weekday);
  return matches.length === 1 ? matches[0] : null;
}

// ---------------------------------------------------------------------------------------------- compare

type Projected = { title: string; day: string | null; time: string | null; endTime: string | null; note: string; venue: string };
const project = (item: Item): Projected => ({ title: displayTitle(item), day: item.day, time: item.time, endTime: item.endTime ?? null, note: norm(item.participantNote), venue: item.venue?.trim() ?? "" });
const fieldNames: Array<keyof Projected> = ["title", "day", "time", "endTime", "note", "venue"];
type Operation =
  | { op: "text"; field: "title" | "opening" | "closing"; value: string | null }
  | { op: "day"; date: string; label: string | null; description: string }
  | { op: "item_edit"; id: string; fields: Partial<Projected> }
  | { op: "item_add"; item: Item; afterId: string | null }
  | { op: "item_remove"; id: string }
  | { op: "question_edit"; id: string; prompt: string }
  | { op: "question_add"; id: string; prompt: string }
  | { op: "question_remove"; id: string };
export type PlannedImportChange = ItineraryImportChange & { operation: Operation };
export type ItineraryImportPlan = { changes: PlannedImportChange[]; kept: string[]; unrecognized: string[] };

const summary = (value: Pick<Projected, "title" | "time" | "endTime" | "venue" | "note">) => [`${value.time ? `${timeText(value)} — ` : ""}${value.title}${value.venue ? ` · ${value.venue}` : ""}`, value.note].filter(Boolean).join("\n").slice(0, 5000);
const normalized = (value: string) => value.toLowerCase().replace(/\s*\(optional\)\s*$/, "").replace(/[^a-z0-9]+/g, " ").trim();
const kindFor = (title: string): Item["kind"] => /\b(?:breakfast|brunch|lunch|dinner|tasting menu|picnic)\b/i.test(title) ? "meal" : /\b(?:drive|shuttle|flight|depart|arriv|train|ferry|transfer)\w*/i.test(title) ? "transport" : "activity";

/**
 * Compare a parsed file with the version it came from (`base`) and the version saved now (`current`).
 * A field changes only where the file differs from base; if Commons also changed that field since the
 * export, the change is a conflict and cannot be selected. `mode: add` treats every stop as an addition.
 */
export function planItineraryImport(input: { parsed: ParsedItineraryImport; mode: "update" | "add" | "create"; base: ItineraryContent; current: ItineraryContent;
  facts: { startsOn: string | null; endsOn: string | null }; newId: (key: string) => string }): ItineraryImportPlan {
  const { parsed, mode, base, current, facts } = input;
  const layout = itineraryLayout(base), currentLayout = itineraryLayout(current);
  const changes: PlannedImportChange[] = [], unrecognized = [...parsed.problems];
  const push = (change: Omit<PlannedImportChange, "selected"> & { selected?: boolean }) => changes.push({ ...change, selected: change.selected ?? change.selectable });
  const matched = mode === "update";
  // Text fields: title, opening and closing.
  for (const field of ["title", "opening", "closing"] as const) {
    const incoming = parsed[field];
    // A missing title, opening or closing is kept, like a missing stop.
    if (incoming === null) continue;
    const before = field === "title" ? base.title : norm(base[field]) || null, now = field === "title" ? current.title : norm(current[field]) || null;
    const after = (field === "title" ? incoming.trim() : norm(incoming)) || null;
    if (mode === "add") { if (after && after !== now) unrecognized.push(`The file’s ${field} wasn’t used. Your itinerary keeps its own.`); continue; }
    if (after === before || after === now) continue;
    const limit = field === "title" ? 160 : field === "opening" ? 1500 : 1000;
    if (after && after.length > limit) { unrecognized.push(`The ${field} is longer than ${limit} characters, so it wasn’t applied.`); continue; }
    if (field === "title" && !after) continue;
    const conflict = matched && now !== before;
    push({ id: `${field}:edit`, kind: before || field === "title" ? "edit" : "add", target: field, label: field === "title" ? "Title" : field === "opening" ? "Opening" : "Closing note", before: now, after,
      selectable: !conflict, note: conflict ? "Changed in Commons since this file was exported. Edit it in Commons." : null, operation: { op: "text", field, value: after } });
  }
  // Days: resolve each section to a trip date.
  const seenItems = new Map<string, number>(), seenDays = new Set<string>(), itemsAdded: string[] = [];
  const allStops = [...parsed.days.flatMap(day => day.stops), ...(parsed.ideas ?? [])];
  for (const stop of allStops) if (matched && stop.ref) seenItems.set(stop.ref, (seenItems.get(stop.ref) ?? 0) + 1);
  let addIndex = 0;
  const sections: Array<{ date: string | null; label: string; stops: ImportedStop[]; ideas: boolean }> = [];
  for (const section of parsed.days) {
    let date = matched && section.ref ? layout.dayRefs.get(section.ref) ?? null : null;
    if (matched && section.ref && !date) unrecognized.push(`“${section.label}” has a tag this itinerary doesn’t have, so its heading wasn’t applied.`);
    date ??= dayFromHeading(section.label, facts) ?? currentLayout.days.find(day => day.label.toLowerCase() === section.label.toLowerCase())?.date ?? null;
    if (date && seenDays.has(date)) { /* A repeated heading adds to the same day. */ }
    else if (date) {
      seenDays.add(date);
      const baseDay = layout.days.find(day => day.date === date), currentDay = currentLayout.days.find(day => day.date === date);
      const label = section.label.slice(0, 100), description = norm(section.description);
      if (section.label.length > 100 || description.length > 1000) unrecognized.push(`The heading or note for “${section.label.slice(0, 80)}” is too long, so it wasn’t applied.`);
      else if (!currentDay && mode !== "add" || !currentDay && mode === "add" && section.stops.length) {
        push({ id: `day:${date}:add`, kind: "add", target: "day", label: label === dateLabel(date) ? label : `${label} (${dateLabel(date).replace(/^\w+, /, "")})`, before: null, after: [label, description].filter(Boolean).join("\n"), selectable: true, note: null, operation: { op: "day", date, label, description } });
      } else if (matched && baseDay && currentDay && (baseDay.label !== label || norm(baseDay.description) !== description)) {
        const conflict = currentDay.label !== baseDay.label || norm(currentDay.description) !== norm(baseDay.description);
        push({ id: `day:${date}:edit`, kind: "edit", target: "day", label: currentDay.label, before: [currentDay.label, currentDay.description].filter(Boolean).join("\n"), after: [label, description].filter(Boolean).join("\n"),
          selectable: !conflict, note: conflict ? "Changed in Commons since this file was exported." : null, operation: { op: "day", date, label: label === dateLabel(date) ? null : label, description } });
      }
    } else if (section.stops.length) unrecognized.push(`“${section.label}” isn’t a date in this trip, so its ${section.stops.length === 1 ? "stop was" : `${section.stops.length} stops were`} offered as ideas without a day.`);
    // Text under a heading that won't be used is shown rather than silently dropped.
    const unusedNote = norm(section.description), existingDay = date ? currentLayout.days.find(day => day.date === date) : undefined;
    if (unusedNote && (!date || mode === "add" && existingDay && norm(existingDay.description) !== unusedNote)) unrecognized.push(`The note under “${section.label}” wasn’t applied: “${unusedNote.slice(0, 300)}”`);
    sections.push({ date, label: date ? currentLayout.days.find(day => day.date === date)?.label ?? section.label : section.label, stops: section.stops, ideas: false });
  }
  if (parsed.ideas) sections.push({ date: null, label: "Ideas", stops: parsed.ideas, ideas: true });
  // Stops.
  for (const section of sections) {
    let previous: string | null = null;
    for (const stop of section.stops) {
      const range = stop.timeText ? parseTimeRange(stop.timeText) : null;
      if (stop.timeText && !range) unrecognized.push(`“${stop.line}”: the time “${stop.timeText}” wasn’t recognized, so the time wasn’t changed.`);
      if (range && !section.date) unrecognized.push(`“${stop.line}”: a time needs a trip date, so the time wasn’t used.`);
      if (matched && stop.ref) {
        const id = layout.itemRefs.get(stop.ref);
        if (!id || stop.ref[0] !== "s") { unrecognized.push(`“${stop.line}” has a tag this itinerary doesn’t have, so it wasn’t applied.`); continue; }
        if ((seenItems.get(stop.ref) ?? 0) > 1) { unrecognized.push(`“${stop.line}” uses a tag that appears more than once, so it wasn’t applied.`); continue; }
        previous = id;
        const was = base.items.find(item => item.id === id)!, now = current.items.find(item => item.id === id);
        const before = project(was), label = `${section.ideas ? "Ideas" : section.label} · ${now?.title ?? was.title}`;
        if (stop.remove) {
          if (!now) continue;
          const conflict = !itineraryContentEqual(project(now), before), linked = current.tasks.some(task => task.itemId === id);
          push({ id: `item:${id}:remove`, kind: "remove", target: "item", label, before: summary(project(now)), after: null, selectable: !conflict && !linked,
            note: linked ? "This stop has a linked planning task. Remove its link in Commons first." : conflict ? "Changed in Commons since this file was exported. Review it in Commons before removing." : null, operation: { op: "item_remove", id } });
          continue;
        }
        const keepTime = !range && Boolean(stop.timeText);
        const incoming: Projected = { title: `${stop.title}${stop.optional ? " (optional)" : ""}`, day: section.date ?? (section.ideas ? null : before.day), time: section.date ? range?.time ?? (keepTime ? before.time : null) : null,
          endTime: section.date ? range ? range.endTime : keepTime ? before.endTime : null : null, note: stop.note, venue: stop.venue };
        if (!section.date && !section.ideas) { incoming.day = before.day; incoming.time = before.time; incoming.endTime = before.endTime; }
        const changed = fieldNames.filter(field => incoming[field] !== before[field]);
        if (!changed.length) continue;
        if (!now) { push({ id: `item:${id}:edit`, kind: "edit", target: "item", label, before: summary(before), after: summary(incoming), selectable: false, note: "Removed in Commons since this file was exported.", operation: { op: "item_edit", id, fields: {} } }); continue; }
        const latest = project(now), pending = changed.filter(field => latest[field] !== incoming[field]);
        if (!pending.length) continue;
        const conflicts = pending.filter(field => latest[field] !== before[field]);
        if (incoming.title.replace(optionalSuffix, "").length > 120 || incoming.note.length > 1000 || incoming.venue.length > 160) { unrecognized.push(`“${stop.line}” has text longer than Commons allows for a stop, so it wasn’t applied.`); continue; }
        push({ id: `item:${id}:edit`, kind: "edit", target: "item", label, before: summary(latest), after: summary({ ...latest, ...Object.fromEntries(pending.map(field => [field, incoming[field]])) }),
          selectable: !conflicts.length, note: conflicts.length ? `Changed in Commons since this file was exported (${conflicts.map(field => field === "endTime" ? "end time" : field).join(", ")}).` : incoming.day !== latest.day ? `Moves to ${incoming.day ? sections.find(row => row.date === incoming.day)?.label ?? incoming.day : "Ideas"}.` : null,
          operation: { op: "item_edit", id, fields: Object.fromEntries(pending.map(field => [field, incoming[field]])) } });
        continue;
      }
      if (stop.remove) { unrecognized.push(`“${stop.line}” is struck through but isn’t in this itinerary, so nothing was removed.`); continue; }
      if (stop.title.length > 120 || stop.note.length > 1000 || stop.venue.length > 160) { unrecognized.push(`“${stop.line.slice(0, 200)}” is longer than Commons allows for a stop, so it wasn’t added.`); continue; }
      const id = input.newId(`item:${addIndex++}:${section.date ?? "idea"}:${normalized(stop.title)}`);
      if (current.items.some(item => item.id === id)) { previous = id; continue; }
      const day = section.date, item: Item = ItineraryContentSchema.shape.items.element.parse({ id, kind: kindFor(stop.title), title: stop.title, day, time: day ? range?.time ?? null : null, endTime: day ? range?.endTime ?? null : null,
        travelAnchor: null, decision: null, location: "", note: "", participantNote: stop.note || null, venue: stop.venue || null, participation: stop.optional ? "optional" : "group", alternative: false,
        evidence: "organizer_preference", sources: [], unresolved: [] });
      const duplicate = current.items.find(existing => existing.day === day && normalized(existing.title) === normalized(stop.title));
      push({ id: `item:${id}:add`, kind: "add", target: "item", label: `${section.ideas || !day ? "Ideas" : section.label} · ${stop.title}`, before: null, after: summary(project(item)),
        selectable: true, selected: !duplicate, note: duplicate ? `Looks like “${duplicate.title}” is already there.` : null, operation: { op: "item_add", item, afterId: previous } });
      itemsAdded.push(id); previous = id;
    }
  }
  // Questions (up to three optional prompts).
  if (parsed.questions) {
    const questionTags = new Map<string, number>();
    for (const question of parsed.questions) if (matched && question.ref) questionTags.set(question.ref, (questionTags.get(question.ref) ?? 0) + 1);
    const addedPrompts = new Set<string>();
    for (const question of parsed.questions) {
      if (matched && question.ref && (questionTags.get(question.ref) ?? 0) > 1) {
        unrecognized.push(`The question “${question.prompt}” uses a tag that appears more than once, so it wasn’t applied.`);
        continue;
      }
      const id = matched && question.ref ? layout.questionRefs.get(question.ref) : undefined;
      if (matched && question.ref && !id) { unrecognized.push(`The question “${question.prompt}” has a tag this itinerary doesn’t have, so it wasn’t applied.`); continue; }
      if (question.prompt.length > 240) { unrecognized.push(`The question “${question.prompt.slice(0, 80)}…” is longer than 240 characters, so it wasn’t applied.`); continue; }
      const was = id ? base.questions?.find(row => row.id === id) : undefined, now = id ? current.questions?.find(row => row.id === id) : undefined;
      if (id && was) {
        if (question.remove) { if (now) push({ id: `question:${id}:remove`, kind: "remove", target: "question", label: "Question", before: now.prompt, after: null, selectable: now.prompt === was.prompt, note: now.prompt === was.prompt ? null : "Changed in Commons since this file was exported.", operation: { op: "question_remove", id } }); continue; }
        if (question.prompt === was.prompt || !now || question.prompt === now.prompt) continue;
        push({ id: `question:${id}:edit`, kind: "edit", target: "question", label: "Question", before: now.prompt, after: question.prompt, selectable: now.prompt === was.prompt, note: now.prompt === was.prompt ? null : "Changed in Commons since this file was exported.", operation: { op: "question_edit", id, prompt: question.prompt } });
      } else if (!question.remove && !(current.questions ?? []).some(row => normalized(row.prompt) === normalized(question.prompt))) {
        if (addedPrompts.has(normalized(question.prompt))) continue;
        addedPrompts.add(normalized(question.prompt));
        const questionId = input.newId(`question:${normalized(question.prompt)}`);
        push({ id: `question:${questionId}:add`, kind: "add", target: "question", label: "Question", before: null, after: question.prompt, selectable: true, note: null, operation: { op: "question_add", id: questionId, prompt: question.prompt } });
      }
    }
  }
  const kept = matched ? [...layout.itemRefs.entries()].filter(([ref, id]) => !seenItems.has(ref) && current.items.some(item => item.id === id)).map(([, id]) => current.items.find(item => item.id === id)!.title) : [];
  return { changes: changes.slice(0, 200), kept: kept.slice(0, 100), unrecognized: unrecognized.map(line => line.slice(0, 600)).slice(0, 100) };
}

/** Apply the chosen changes to the current saved content. The result still passes the existing document validation on save. */
export function applyItineraryImportPlan(current: ItineraryContent, plan: ItineraryImportPlan, selected: ReadonlySet<string>) {
  if (new Set(plan.changes.map(change => change.id)).size !== plan.changes.length) throw new ItineraryImportError("The import contains ambiguous changes. Review the file and try again.");
  const next = structuredClone(current);
  const chosen = plan.changes.filter(change => selected.has(change.id));
  if (chosen.some(change => !change.selectable)) throw new ItineraryImportError("A conflicting change can’t be applied. Review the current itinerary in Commons.");
  for (const { operation } of chosen) {
    switch (operation.op) {
      case "text": if (operation.field === "title") next.title = operation.value ?? next.title; else next[operation.field] = operation.value; break;
      case "day": {
        const days = next.days ?? [], existing = days.find(day => day.day === operation.date);
        if (existing) Object.assign(existing, { description: operation.description, label: operation.label });
        else days.push({ day: operation.date, description: operation.description, label: operation.label });
        next.days = days.sort((a, b) => a.day.localeCompare(b.day)); break;
      }
      case "item_edit": {
        const item = next.items.find(row => row.id === operation.id);
        if (!item) throw new ItineraryImportError("A stop changed while you were reviewing. Review the import again.");
        const fields = operation.fields;
        if (fields.title !== undefined) { item.title = fields.title.replace(optionalSuffix, "").trim() || item.title; item.participation = optionalSuffix.test(fields.title) ? "optional" : "group"; }
        if (fields.day !== undefined) item.day = fields.day;
        if (fields.time !== undefined) item.time = fields.time;
        if (fields.endTime !== undefined) item.endTime = fields.endTime;
        if (!item.day) { item.time = null; item.endTime = null; }
        if (fields.note !== undefined) item.participantNote = fields.note || null;
        if (fields.venue !== undefined) item.venue = fields.venue || null;
        break;
      }
      case "item_add": {
        if (next.items.some(row => row.id === operation.item.id)) break;
        const after = operation.afterId ? next.items.findIndex(row => row.id === operation.afterId) : -1;
        if (after >= 0) next.items.splice(after + 1, 0, structuredClone(operation.item)); else next.items.push(structuredClone(operation.item));
        break;
      }
      case "item_remove": next.items = next.items.filter(row => row.id !== operation.id); break;
      case "question_edit": next.questions = (next.questions ?? []).map(row => row.id === operation.id ? { ...row, prompt: operation.prompt } : row); break;
      case "question_add": next.questions = [...(next.questions ?? []), { id: operation.id, prompt: operation.prompt }]; break;
      case "question_remove": next.questions = (next.questions ?? []).filter(row => row.id !== operation.id); break;
    }
  }
  if (next.items.length > 30) throw new ItineraryImportError("This would make more than 30 stops. Choose fewer additions, or remove stops in Commons first.");
  if ((next.questions ?? []).length > 3) throw new ItineraryImportError("Keep up to three questions for the group. Choose fewer.");
  if ((next.days ?? []).length > 30) throw new ItineraryImportError("Keep this itinerary to 30 days.");
  return ItineraryContentSchema.parse(next);
}
