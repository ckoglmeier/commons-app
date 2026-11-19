import {
  PlanImportPreviewSchema,
  type PlanImportPreview,
  type PlanImportSourceKind,
} from "@commons/contracts";

const months = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const planWords = /\b(arriv|depart|flight|train|check.?in|breakfast|brunch|lunch|dinner|reservation|golf|beach|boat|whale|tour|ride|rental|cookout|sail|museum|aquarium|hike|activity|hotel|house|concert|festival|meet|pickup|drop.?off)\b/i;
const noise = /^(from|to|subject|sent|cc|bcc):\s|^https?:\/\/\S+$|^[-_=]{3,}$/i;

function isoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month ||
    date.getUTCDate() !== day
  ) return null;
  return date.toISOString().slice(0, 10);
}

function yearForMonth(month: number, startsOn: string) {
  const start = new Date(`${startsOn}T12:00:00.000Z`);
  const startMonth = start.getUTCMonth();
  return month < startMonth - 6
    ? start.getUTCFullYear() + 1
    : start.getUTCFullYear();
}

function dateInLine(line: string, startsOn: string) {
  const iso = line.match(/\b(20\d{2})-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

  const named = line.match(new RegExp(`\\b(${months.join("|")})\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?\\b`, "i"));
  if (named) {
    const month = months.indexOf(named[1].toLowerCase());
    return isoDate(Number(named[3] ?? yearForMonth(month, startsOn)), month, Number(named[2]));
  }

  const numeric = line.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/);
  if (numeric) {
    const month = Number(numeric[1]) - 1;
    const suppliedYear = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : yearForMonth(month, startsOn);
    return isoDate(suppliedYear, month, Number(numeric[2]));
  }
  return null;
}

function timeInLine(line: string) {
  const twelveHour = line.match(/\b(1[0-2]|0?\d)(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i);
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toLowerCase() === "p") hour += 12;
    return `${String(hour).padStart(2, "0")}:${twelveHour[2] ?? "00"}`;
  }
  const twentyFourHour = line.match(/(?:^|\s)([01]\d|2[0-3]):([0-5]\d)(?:\s|$)/);
  return twentyFourHour ? `${twentyFourHour[1]}:${twentyFourHour[2]}` : null;
}

function looksLikeDateHeading(line: string, startsOn: string) {
  if (!dateInLine(line, startsOn)) return false;
  const withoutDate = line
    .replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s*/i, "")
    .replace(new RegExp(`\\b(?:${months.join("|")})\\s+\\d{1,2}(?:,?\\s+20\\d{2})?\\b`, "i"), "")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/, "")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/(?:20)?\d{2})?\b/, "")
    .replace(/[^a-z]/gi, "")
    .trim();
  return withoutDate.length < 4;
}

function cleanTitle(line: string, startsOn: string) {
  let title = line
    .replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s*/, "")
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, "")
    .replace(new RegExp(`\\b(?:${months.join("|")})\\s+\\d{1,2}(?:,?\\s+20\\d{2})?\\b`, "ig"), "")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/(?:20)?\d{2})?\b/g, "")
    .replace(/\b(?:1[0-2]|0?\d)(?::[0-5]\d)?\s*[ap]\.?m\.?\b/ig, "")
    .replace(/(?:^|\s)(?:[01]\d|2[0-3]):[0-5]\d(?:\s|$)/g, " ")
    .replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+(?:at|on)$/i, "")
    .trim();
  if (!title) title = `Plan from ${dateInLine(line, startsOn) ?? "import"}`;
  return title.slice(0, 160);
}

function sourceLocation(line: string) {
  const segments = line.split(/\s+[·|]\s+/).map((part) => part.trim()).filter(Boolean);
  if (segments.length < 2) return undefined;
  const last = segments.at(-1)!;
  if (timeInLine(last) || dateInLine(last, "2026-01-01") || last.length > 100) return undefined;
  return last;
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function routeStayDrafts(
  lines: string[],
  startsOn: string,
  endsOn: string,
  sourceLabel: string,
): PlanImportPreview["items"] {
  const stays: PlanImportPreview["items"] = [];
  let dayOffset = 0;

  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*(?:[-*•]|\d+[.)])\s*(\d{1,2})\s+nights?\s+(.+)$/i);
    if (!match) continue;
    const nights = Number(match[1]);
    const place = match[2]
      .replace(/[?.]+$/g, "")
      .replace(/^near\s+/i, "")
      .trim();
    if (!place || nights < 1 || nights > 14) continue;
    const date = addDays(startsOn, dayOffset);
    if (date > endsOn) break;
    stays.push({
      id: `import-route-${index + 1}`,
      title: `${place} · ${nights} ${nights === 1 ? "night" : "nights"}`.slice(0, 160),
      date,
      time: "15:00",
      location: place.slice(0, 160),
      participantScope: "everyone",
      sourceLabel: `${sourceLabel} · line ${index + 1}`.slice(0, 240),
      sourceExcerpt: line.slice(0, 500),
      needsReview: true,
    });
    dayOffset += nights;
  }

  return stays;
}

export function parsePlanImportText(input: {
  text: string;
  startsOn: string;
  endsOn: string;
  sourceKind: PlanImportSourceKind;
  sourceLabel: string;
}): PlanImportPreview {
  const normalized = input.text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const items: PlanImportPreview["items"] = [];
  const warnings: string[] = [];
  let currentDate: string | null = null;

  for (const [index, line] of lines.entries()) {
    if (line.length > 500 || noise.test(line)) continue;
    const cells = line.split(line.includes("\t") ? "\t" : ",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
    if (cells.length >= 3) {
      const spreadsheetDate = dateInLine(cells[0], input.startsOn);
      const spreadsheetTime = timeInLine(cells[2] ?? "");
      const spreadsheetTitle = cells[1]?.trim();
      if (
        spreadsheetDate &&
        spreadsheetDate >= input.startsOn &&
        spreadsheetDate <= input.endsOn &&
        spreadsheetTitle &&
        !/^title|activity|plan$/i.test(spreadsheetTitle)
      ) {
        items.push({
          id: `import-${index + 1}`,
          title: spreadsheetTitle.slice(0, 160),
          date: spreadsheetDate,
          time: spreadsheetTime ?? "09:00",
          location: cells[3]?.slice(0, 160) || undefined,
          participantScope: "everyone",
          sourceLabel: `${input.sourceLabel} · row ${index + 1}`.slice(0, 240),
          sourceExcerpt: line.slice(0, 500),
          needsReview: !spreadsheetTime,
        });
        if (items.length === 60) break;
        continue;
      }
    }
    const detectedDate = dateInLine(line, input.startsOn);
    if (looksLikeDateHeading(line, input.startsOn)) {
      currentDate = detectedDate;
      continue;
    }

    const date = detectedDate ?? currentDate;
    const isBullet = /^\s*(?:[-*•]|\d+[.)]|\[[ xX]\])\s+/.test(line);
    if (!date || (!isBullet && !detectedDate && !planWords.test(line))) continue;
    if (!planWords.test(line) && !isBullet) continue;
    if (date < input.startsOn || date > input.endsOn) continue;

    const detectedTime = timeInLine(line);
    const location = sourceLocation(line);
    const titleSource = location ? line.replace(new RegExp(`\\s+[·|]\\s+${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`), "") : line;
    const title = cleanTitle(titleSource, input.startsOn);
    if (title.length < 2 || items.some((item) => item.date === date && item.title.toLowerCase() === title.toLowerCase())) continue;

    items.push({
      id: `import-${index + 1}`,
      title,
      date,
      time: detectedTime ?? "09:00",
      location,
      participantScope: "everyone",
      sourceLabel: `${input.sourceLabel} · line ${index + 1}`.slice(0, 240),
      sourceExcerpt: line.slice(0, 500),
      needsReview: !detectedTime,
    });
    if (items.length === 60) break;
  }

  if (!items.length) {
    const routeItems = routeStayDrafts(lines, input.startsOn, input.endsOn, input.sourceLabel);
    items.push(...routeItems);
    if (routeItems.length) {
      warnings.push("Drafted the route from the nights in your notes. Check each date before adding it.");
    }
  }

  if (!items.length) {
    warnings.push("No dated plans were found. Add date headings or paste a simpler itinerary and try again.");
  } else if (items.some((item) => item.needsReview)) {
    if (!warnings.length) warnings.push("Some plans did not include a time. Commons set those to 9:00 AM for review.");
  }
  if (items.length === 60) warnings.push("Only the first 60 plans are shown.");

  return PlanImportPreviewSchema.parse({
    sourceKind: input.sourceKind,
    sourceLabel: input.sourceLabel,
    items,
    warnings,
  });
}
