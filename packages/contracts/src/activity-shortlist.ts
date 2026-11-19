import { z } from "zod";

/*
 * An activity shortlist is part of the private itinerary document, not a second
 * decision store. Options keep stable identities, human selections and organizer
 * notes across edits, refinements and published rounds. Research and model text
 * are advisory: an option is viable only when captured primary evidence answers
 * the decision's required questions. Selecting, keeping or choosing an option
 * never books, assigns or confirms attendance.
 */

const optionId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const ShortlistSourceSchema = z.object({
  runId: z.string().uuid(), sourceId: z.string().max(40),
  /** Code-derived from the source host and the option name; never model-asserted. */
  basis: z.enum(["primary", "secondary"]),
}).strict();
export const ShortlistPriceSchema = z.object({
  amountCents: z.number().int().nonnegative().max(100_000_000).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  /** Per-person, whole-group and per-vehicle amounts are not interchangeable. */
  basis: z.enum(["per_person", "per_group", "per_vehicle", "per_hour", "unknown"]),
  /** Always a public reference, never a quote, hold or current availability. */
  kind: z.literal("reference"),
  retrievedAt: z.string().datetime().nullable(),
}).strict();
export const ShortlistOptionSchema = z.object({
  id: optionId, label: z.string().trim().min(1).max(160),
  fit: z.enum(["candidate", "requires_confirmation", "unsuitable"]),
  reasons: z.array(z.string().trim().min(1).max(300)).max(6),
  unknowns: z.array(z.string().trim().min(1).max(300)).max(8),
  sources: z.array(ShortlistSourceSchema).max(5),
  price: ShortlistPriceSchema.nullable(),
  location: z.string().max(160).nullable(),
  /** Organizer-only. Never enters a participant projection or public query. */
  note: z.string().max(1000),
  /** Human retention for scoped refinement ("keep these two"). */
  keep: z.boolean(),
  /** Human selection of what the group is asked about. */
  inPoll: z.boolean(),
  /** A canonical Plan record this option already is, bound by identity, never by title. */
  planItemId: z.string().uuid().nullable(),
}).strict();
export type ShortlistOption = z.infer<typeof ShortlistOptionSchema>;
export type ShortlistSource = z.infer<typeof ShortlistSourceSchema>;

/** Decision questions an option must answer from primary evidence before it is viable. */
export const DecisionRequirementSchema = z.enum(["group_policy", "eligible_day", "capacity", "price_basis"]);
export type DecisionRequirement = z.infer<typeof DecisionRequirementSchema>;
export type CoverageAnswer = { requirement: DecisionRequirement; status: "primary" | "secondary" | "conditional" | "unknown" | "contradicted"; sourceId: string | null; detail: string | null };
export type EvidenceRow = { runId: string; sourceId: string; title: string; url: string; excerpt: string; retrievedAt: string };
export type DecisionScope = { partySize: number | null; day: string | null; requirements: DecisionRequirement[] };

const GENERIC = new Set(["the", "and", "of", "at", "winery", "wineries", "vineyard", "vineyards", "estate", "estates", "cellars", "cellar", "wine", "wines", "tasting", "room", "restaurant", "cafe", "bar", "tour", "tours", "company", "co", "inc", "llc", "transportation", "transport", "limo", "limousine", "shuttle", "service", "services", "sonoma", "napa", "santa", "fe", "new", "mexico", "valley", "house"]);
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function distinctiveTokens(label: string) {
  return label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 4 && !GENERIC.has(token));
}
/** Primary only when the source's own host names the option. Unknown or generic names stay secondary. */
export function sourceBasis(label: string, url: string): ShortlistSource["basis"] {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return "secondary"; }
  // A brand word in a blog subdomain or a longer, unrelated domain is not
  // supplier evidence. Unknown/multi-part host forms stay secondary. This is a
  // conservative name/host heuristic, not verification of domain ownership.
  const parts = host.split(".");
  if (parts.length !== 2) return "secondary";
  const domain = parts[0], tokens = distinctiveTokens(label);
  if (!tokens.length) return "secondary";
  const compact = label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const names = new Set([compact, tokens.join(""), ...tokens]);
  const suffixes = ["winery", "vineyards", "vineyard", "cellars", "estate", "restaurant", "museum", "tours", "transport", "transportation"];
  for (const token of tokens) for (const suffix of suffixes) names.add(`${token}${suffix}`);
  return names.has(domain) ? "primary" : "secondary";
}
/** Evidence rows that mention this option, in captured order. */
export function optionEvidence(label: string, evidence: EvidenceRow[]) {
  const tokens = distinctiveTokens(label);
  if (!tokens.length) return [];
  return evidence.filter(row => { const text = `${row.title} ${row.url} ${row.excerpt}`.toLowerCase(); return tokens.some(token => text.includes(token)); });
}

const numberWords: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const count = (value: string) => numberWords[value.toLowerCase()] ?? Number(value);
const N = "(\\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";

type Finding = { status: "ok" | "conditional" | "no"; detail: string };
const weekdayName = (day: string) => WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
const title = (day: string) => day.charAt(0).toUpperCase() + day.slice(1);
const dayIndex = (value: string) => WEEKDAYS.findIndex(day => day.startsWith(value.toLowerCase().slice(0, 3)));
const GROUP_CONTEXT = /\b(?:private|group|groups|large part(?:y|ies)|parties of (?:seven|eight|nine|ten|\d{2}|[7-9])|seven or more|(?:\d+|eight|nine|ten)\+)/i;

/**
 * Conservative, line-level reading of a captured excerpt. It answers only what the
 * text states. A maximum for one experience is not a refusal; a weekday range is
 * disqualifying only when stated for the group/private route the party needs.
 */
export function readExcerpt(excerpt: string, scope: DecisionScope) {
  const findings: Partial<Record<DecisionRequirement, Finding>> = {};
  const party = scope.partySize;
  const lines = excerpt.split(/\n+/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const text = lines.join(" ");
  if (party) {
    const maxes = [...text.matchAll(new RegExp(`(?:parties|groups|party|group)(?: sizes?)? (?:of )?(?:up to |no more than |maximum of |limited to )?${N}(?: guests| people)? or fewer\\b|(?:parties|groups|party|group)(?: sizes?)? (?:of )?(?:up to|no more than|maximum of|limited to) ${N}\\b|\\(?maximum of ${N} (?:people|guests)\\)?`, "gi"))].map(match => count(match[1] ?? match[2] ?? match[3]));
    const rule = text.match(new RegExp(`(?:part(?:y|ies)|groups?)(?: is| are)? (?:larger than|over|above|more than|exceeding|of) ${N}(?:\\+| or more| and up| or larger)?[^.]{0,120}?\\b(?:must|required|requires|please see|please contact|contact|inquire)`, "i"))
      ?? text.match(/\blarge(?:r)? (?:parties|groups)[^.]{0,80}?\b(?:must|required|requires|please|contact|inquire)/i);
    const refusal = new RegExp(`(?:unable to|cannot|can't|do not|don't) (?:accommodate|host|accept) (?:groups|parties|large (?:groups|parties))(?: (?:larger than|over|above|of more than|of) ${N})?|no (?:groups|parties) (?:of|over|larger than|above) ${N}`, "i").exec(text);
    const refusalSize = refusal ? refusal[1] ?? refusal[2] : undefined;
    const threshold = rule?.[1] ? count(rule[1]) + (/of \S+ or more|\+/.test(rule[0]) ? 0 : 1) : null;
    const fits = maxes.filter(value => value >= party);
    // A refusal disqualifies only with a stated size; a vague "large parties" refusal needs confirmation.
    if (refusal && refusalSize && count(refusalSize) < party) findings.group_policy = { status: "no", detail: "States it cannot accommodate a group this size." };
    else if (refusal) findings.group_policy = { status: "conditional", detail: "States limits for large groups without a size." };
    else if (rule && (threshold === null || threshold <= party)) findings.group_policy = { status: "conditional", detail: `${threshold ? `Parties of ${threshold} or more` : "Larger groups"} must arrange a separate booking${fits.length ? ` (stated for up to ${Math.max(...fits)})` : ""}.` };
    else if (fits.length) findings.group_policy = { status: "ok", detail: `States parties of up to ${Math.max(...fits)}.` };
    else if (maxes.length) findings.group_policy = { status: "conditional", detail: `Some experiences are limited to ${Math.max(...maxes)}; a group option is not stated.` };
    // A fleet page may list several vehicles: use the largest stated capacity.
    const seatCounts = [...text.matchAll(new RegExp(`${N}[- ](?:passenger|seat|seater)s?\\b|(?:seats|carries|holds|up to) ${N} (?:passengers)`, "gi"))].map(match => count(match[1] ?? match[2]));
    const seats = seatCounts.length ? [String(Math.max(...seatCounts))] as const : null;
    if (seats) { const value = Number(seats[0]); findings.capacity = value >= party ? { status: "ok", detail: `States ${value} passengers.` } : { status: "no", detail: `States ${value} passengers.` }; }
  }
  if (scope.day) {
    const weekday = weekdayName(scope.day);
    const needsGroupRoute = findings.group_policy?.status === "conditional" || lines.some(line => GROUP_CONTEXT.test(line));
    let best = null as Finding | null;
    for (const line of lines) {
      const closed = new RegExp(`closed (?:on )?(?:[a-z]+s?,? )*(?:and )?${weekday}s?\\b|${weekday}s?: closed|not available on ${weekday}s?|no (?:\\w+ )?(?:tastings|visits|tours|bookings) on ${weekday}s?`, "i");
      const ranges = [...line.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*(?:-|–|—|through|to)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/gi)];
      // With several ranges on one line, any range covering the day means it is not excluded.
      const range = ranges.find(match => { const start = dayIndex(match[1]), end = dayIndex(match[2]), target = WEEKDAYS.indexOf(weekday); return start <= end ? target >= start && target <= end : target >= start || target <= end; }) ?? ranges[0];
      const groupLine = GROUP_CONTEXT.test(line);
      const except = new RegExp(`\\b(?:except|excluding)(?: on)?\\s+${weekday}s?\\b`, "i");
      if (closed.test(line) || except.test(line)) return { findings: { ...findings, eligible_day: { status: "no", detail: `States ${title(weekday)} is unavailable.` } }, price: readPrice(text, findings) };
      if (range) {
        const start = dayIndex(range[1]), end = dayIndex(range[2]), target = WEEKDAYS.indexOf(weekday);
        const inside = start <= end ? target >= start && target <= end : target >= start || target <= end;
        const label = `${title(WEEKDAYS[start])}–${title(WEEKDAYS[end])}`;
        if (!inside && groupLine && party && needsGroupRoute) { best = { status: "no", detail: `The group route is offered ${label} only, not ${title(weekday)}.` }; break; }
        if (!inside) best = best?.status === "ok" ? { status: "conditional", detail: `Some experiences are offered ${label} only.` } : { status: "conditional", detail: `Offered ${label}; ${title(weekday)} not stated for this group.` };
        else if (groupLine || !needsGroupRoute) best = { status: "ok", detail: `States ${label}, including ${title(weekday)}.` };
        continue;
      }
      if (new RegExp(`\\b(?:open|available|offered)\\b[^.]{0,60}\\b${weekday}s?\\b|\\b${weekday}s?\\b[^.]{0,40}?\\b(?:open|available)|\\b(?:open daily|daily from|seven days (?:a|per) week|every day)\\b`, "i").test(line)) {
        if (!needsGroupRoute || groupLine) best = best ?? { status: "ok", detail: `States ${title(weekday)} availability.` };
        else best = best ?? { status: "conditional", detail: `Daily availability is stated for standard visits, not this group.` };
      }
    }
    if (best) findings.eligible_day = best;
  }
  return { findings, price: readPrice(text, findings) };
}

function readPrice(text: string, findings: Partial<Record<DecisionRequirement, Finding>>) {
  const quoted = text.match(/\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)\s*(?:\+\s*)?(?:per|\/|a|an)\s*(person|guest|pp|vehicle|van|car|hour|hr|group|party)\b/i);
  if (!quoted) return null;
  const unit = quoted[2].toLowerCase();
  const basis = (/person|guest|pp/.test(unit) ? "per_person" : /vehicle|van|car/.test(unit) ? "per_vehicle" : /hour|hr/.test(unit) ? "per_hour" : "per_group") as NonNullable<ShortlistOption["price"]>["basis"];
  findings.price_basis = { status: findings.group_policy?.status === "ok" ? "ok" : "conditional", detail: findings.group_policy?.status === "ok" ? `$${quoted[1]} ${basis.replace("_", " ")}` : `$${quoted[1]} ${basis.replace("_", " ")} is a published price that may not apply to this group` };
  return { amountCents: Math.round(Number(quoted[1].replace(/,/g, "")) * 100), currency: "USD", basis };
}

/** A secondary page about many places is read only in the section naming this option. */
export function optionSection(label: string, excerpt: string) {
  const tokens = distinctiveTokens(label);
  // Headings when present; otherwise paragraphs, so other places on the page are not attributed.
  const sections = /\n#{1,4} /.test(`\n${excerpt}`) ? excerpt.split(/\n(?=#{1,4} )/) : excerpt.split(/\n\s*\n|\n(?=[-*•] )/);
  const named = sections.filter(section => { const heading = section.split("\n")[0].toLowerCase(); return tokens.some(token => heading.includes(token)); });
  return named.length ? named.join("\n") : sections.filter(section => tokens.some(token => section.toLowerCase().includes(token))).join("\n");
}

/**
 * Required-question coverage for one option. A stated refusal from any source
 * disqualifies; a stated condition needs confirmation; only a primary answer
 * qualifies; a secondary-only answer stays labelled.
 */
export function optionCoverage(option: Pick<ShortlistOption, "label" | "sources">, evidence: EvidenceRow[], scope: DecisionScope): CoverageAnswer[] {
  const rows = option.sources.flatMap(ref => { const row = evidence.find(item => item.runId === ref.runId && item.sourceId === ref.sourceId); return row ? [{ row, basis: sourceBasis(option.label, row.url) }] : []; });
  return scope.requirements.map(requirement => {
    let best: CoverageAnswer = { requirement, status: "unknown", sourceId: null, detail: null };
    for (const { row, basis } of rows) {
      const finding = readExcerpt(basis === "primary" ? row.excerpt : optionSection(option.label, row.excerpt), scope).findings[requirement];
      if (!finding) continue;
      if (finding.status === "no") return { requirement, status: "contradicted", sourceId: row.sourceId, detail: finding.detail };
      // Group rules: a stated booking condition outranks a plain size statement.
      // Day/capacity/price: a primary answer for this group outranks a general caveat.
      const conditionWins = requirement === "group_policy";
      if (finding.status === "conditional") {
        if (conditionWins || best.status === "unknown") best = { requirement, status: "conditional", sourceId: row.sourceId, detail: finding.detail };
        continue;
      }
      if (conditionWins && best.status === "conditional") continue;
      if (best.status === "unknown" || best.status === "conditional" || best.status === "secondary" && basis === "primary") best = { requirement, status: basis, sourceId: row.sourceId, detail: finding.detail };
    }
    return best;
  });
}

const QUESTION: Record<DecisionRequirement, (scope: DecisionScope) => string> = {
  group_policy: scope => `Group rules for ${scope.partySize ?? "the group"}`,
  eligible_day: scope => scope.day ? `${WEEKDAYS[new Date(`${scope.day}T12:00:00Z`).getUTCDay()].replace(/^./, c => c.toUpperCase())} availability` : "Day availability",
  capacity: scope => `Seats for ${scope.partySize ?? "the group"}`,
  price_basis: () => "Price and what it covers",
};
export function requirementQuestion(requirement: DecisionRequirement, scope: DecisionScope) { return QUESTION[requirement](scope); }

/** Code decides fit from coverage. A claimed fit cannot exceed what evidence supports. */
export function qualifyOption(option: ShortlistOption, evidence: EvidenceRow[], scope: DecisionScope): ShortlistOption {
  const sources = option.sources.flatMap(ref => { const row = evidence.find(item => item.runId === ref.runId && item.sourceId === ref.sourceId); return row ? [{ ...ref, basis: sourceBasis(option.label, row.url) }] : []; });
  const coverage = optionCoverage({ ...option, sources }, evidence, scope);
  const blocking = coverage.filter(answer => answer.requirement !== "price_basis");
  const contradicted = blocking.find(answer => answer.status === "contradicted");
  const unknowns = coverage.filter(answer => answer.status !== "primary").map(answer => `${requirementQuestion(answer.requirement, scope)}: ${answer.status === "secondary" ? "secondary source only" : answer.status === "unknown" ? "not confirmed" : answer.detail}`);
  const retained = option.unknowns.filter(text => !scope.requirements.some(requirement => text.startsWith(requirementQuestion(requirement, scope))));
  const fit = contradicted || option.fit === "unsuitable" ? "unsuitable" : blocking.every(answer => answer.status === "primary") && option.fit === "candidate" ? "candidate" : "requires_confirmation";
  const priced = option.price ?? (() => { for (const ref of sources) { const row = evidence.find(item => item.runId === ref.runId && item.sourceId === ref.sourceId); const read = row ? readExcerpt(ref.basis === "primary" ? row.excerpt : optionSection(option.label, row.excerpt), scope).price : null; if (read && row) return { ...read, kind: "reference" as const, retrievedAt: row.retrievedAt }; } return null; })();
  return ShortlistOptionSchema.parse({ ...option, sources, fit, price: priced, unknowns: [...new Set([...unknowns, ...retained])].slice(0, 8),
    reasons: contradicted ? [...new Set([contradicted.detail!, ...option.reasons])].slice(0, 6) : option.reasons });
}

export function shortlistOptionId(itemId: string, label: string, taken: Set<string>) {
  const base = `${itemId.slice(0, 40)}-${label.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 30) || "option"}`;
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}

/** Create a shortlist from plain choice labels and the item's captured sources. Nothing is selected for the group by default except existing poll choices. */
export function shortlistFromChoices(item: { id: string; sources: Array<{ runId: string; sourceId: string }>; location: string }, labels: string[], evidence: EvidenceRow[], scope: DecisionScope, inPoll = true): ShortlistOption[] {
  const taken = new Set<string>();
  const window = evidence.filter(row => item.sources.some(ref => ref.runId === row.runId && ref.sourceId === row.sourceId));
  return labels.map(label => qualifyOption({ id: shortlistOptionId(item.id, label, taken), label, fit: "candidate", reasons: [], unknowns: [],
    sources: optionEvidence(label, window.length ? window : evidence).slice(0, 5).map(row => ({ runId: row.runId, sourceId: row.sourceId, basis: sourceBasis(label, row.url) })),
    price: null, location: null, note: "", keep: false, inPoll, planItemId: null }, evidence, scope));
}

/**
 * Scoped refinement ("keep these two, find a cheaper third"): retained options keep
 * identity, notes, sources, selection and their original reference price. Annotated,
 * excluded, chosen and Plan-linked options are also human-owned; only untouched
 * options may be replaced by newly proposed labels. Keep flags remain unchanged.
 */
export function refineShortlist(previous: ShortlistOption[], proposedLabels: string[], item: { id: string; sources: Array<{ runId: string; sourceId: string }>; location: string }, evidence: EvidenceRow[], scope: DecisionScope, chosenOptionId?: string | null) {
  const retained = (option: ShortlistOption) => option.keep || Boolean(option.note.trim()) || !option.inPoll || Boolean(option.planItemId) || option.id === chosenOptionId;
  const kept = previous.filter(retained);
  const norm = (value: string) => value.trim().toLowerCase();
  const fresh = proposedLabels.filter(label => !kept.some(option => norm(option.label) === norm(label)));
  const reused = fresh.map(label => previous.find(option => !retained(option) && norm(option.label) === norm(label)));
  const taken = new Set(previous.map(option => option.id));
  const added = fresh.map((label, index) => reused[index] ? qualifyOption({ ...reused[index]!, keep: false }, evidence, scope) : shortlistFromChoices(item, [label], evidence, scope, true).map(option => ({ ...option, id: shortlistOptionId(item.id, label, taken) }))[0]);
  return [...kept, ...added].slice(0, 8);
}

export function syncDecisionOptions(shortlist: ShortlistOption[]) { return shortlist.filter(option => option.inPoll && option.fit !== "unsuitable").map(option => option.label); }

/** Validation for a stored shortlist and its relation to the poll choices. */
export function shortlistError(decision: { options: string[]; shortlist?: ShortlistOption[] | null; chosenOptionId?: string | null }) {
  const shortlist = decision.shortlist ?? null;
  if (!shortlist) return decision.chosenOptionId ? "Choose from the saved shortlist." : null;
  const ids = shortlist.map(option => option.id), labels = shortlist.map(option => option.label.toLowerCase());
  if (new Set(ids).size !== ids.length || new Set(labels).size !== labels.length) return "Each shortlist option needs its own identity and name.";
  if (shortlist.some(option => option.inPoll && option.fit === "unsuitable")) return "An unsuitable option cannot be asked about.";
  const asked = syncDecisionOptions(shortlist);
  if (asked.length < 2) return "Ask the group about at least two options.";
  if (JSON.stringify(asked) !== JSON.stringify(decision.options)) return "The group choices must match the options selected for the poll.";
  const chosen = decision.chosenOptionId ? shortlist.find(option => option.id === decision.chosenOptionId) : null;
  if (decision.chosenOptionId && (!chosen || chosen.fit === "unsuitable")) return "Choose a current option that is not unsuitable.";
  return null;
}

/** Participant-safe description: public reference price and a plain unknown flag. No notes, reasons or private context. */
export function participantOptionDetails(option: ShortlistOption) {
  const captured = option.price?.retrievedAt ? ` captured ${option.price.retrievedAt.slice(0,10)}` : "";
  const caveat = `reference${captured}; check current rate${option.fit === "candidate" ? ", not a quote" : "; may not apply to this group"}`;
  const price = option.price?.amountCents != null && option.price.currency ? `About ${new Intl.NumberFormat("en-US", { style: "currency", currency: option.price.currency, maximumFractionDigits: option.price.amountCents % 100 ? 2 : 0 }).format(option.price.amountCents / 100)} ${{ per_person: "per person", per_group: "for the group", per_vehicle: "per vehicle", per_hour: "per hour", unknown: "" }[option.price.basis]}`.trim() + ` (${caveat})` : "Price not confirmed";
  return [price, option.fit === "requires_confirmation" ? "Details still to confirm" : null].filter(Boolean).join(" · ").slice(0, 300);
}

/** Required questions follow the stop's kind; party size and day are saved public facts, never names. */
export function decisionScopeFor(item: { kind: string; day: string | null; partySize?: number | null }): DecisionScope {
  return { partySize: item.partySize ?? null, day: item.day,
    requirements: item.kind === "transport" ? ["capacity", "eligible_day", "price_basis"] : ["group_policy", "eligible_day", "price_basis"] };
}

type DecisionItem = { id: string; kind: string; day: string | null; location: string; partySize?: number | null; sources: Array<{ runId: string; sourceId: string }>;
  decision?: { question: string; options: string[]; shortlist?: ShortlistOption[] | null; chosenOptionId?: string | null } | null };
/**
 * Model output never carries shortlists. After a refinement, each stop that had a
 * human shortlist keeps it: human-owned options verbatim, untouched ones refreshed from
 * the newly proposed choices, the organizer's choice kept while that option exists.
 * A refinement that drops the choices does not silently discard the shortlist.
 */
export function preserveShortlists<T extends DecisionItem>(previous: T[], next: T[], evidence: EvidenceRow[]): T[] {
  return next.map(item => {
    const before = previous.find(row => row.id === item.id);
    const shortlist = before?.decision?.shortlist;
    if (!before?.decision || !shortlist?.length) return item;
    const partySize = item.partySize ?? before.partySize ?? null;
    if (!item.decision) return { ...item, partySize, decision: before.decision };
    const scope = decisionScopeFor({ ...item, partySize });
    // New evidence attaches to existing options (identity, notes and selections kept), then fit is re-derived.
    const window = evidence.filter(row => item.sources.some(ref => ref.runId === row.runId && ref.sourceId === row.sourceId));
    const attached = refineShortlist(shortlist, item.decision.options, item, evidence, scope, before.decision.chosenOptionId).map(option => {
      const found = optionEvidence(option.label, window.length ? window : evidence).map(row => ({ runId: row.runId, sourceId: row.sourceId, basis: sourceBasis(option.label, row.url) }));
      const sources = [...option.sources, ...found.filter(ref => !option.sources.some(old => old.runId === ref.runId && old.sourceId === ref.sourceId))].slice(0, 5);
      return { ...option, sources };
    });
    let refined = requalifyShortlist(attached, evidence, scope, scope);
    if (syncDecisionOptions(refined).length < 2) refined = shortlist;
    const chosenOptionId = before.decision.chosenOptionId && refined.some(option => option.id === before.decision!.chosenOptionId) ? before.decision.chosenOptionId : null;
    return { ...item, partySize, decision: { question: item.decision.question, options: syncDecisionOptions(refined), shortlist: refined, chosenOptionId } };
  });
}

/**
 * Re-derive fit after the stop's scope changed (another day, a different party
 * size). Coverage text produced for the old scope is replaced; organizer notes,
 * selections, identity and any organizer-written unknowns stay. An option that
 * becomes unsuitable leaves the group question.
 */
export function requalifyShortlist(shortlist: ShortlistOption[], evidence: EvidenceRow[], before: DecisionScope, after: DecisionScope) {
  const generated = new Set(shortlist.flatMap(option => optionCoverage(option, evidence, before).flatMap(answer => answer.detail ? [answer.detail] : [])));
  const prefixes = before.requirements.map(requirement => requirementQuestion(requirement, before));
  const next = shortlist.map(option => {
    const reasons = option.reasons.filter(reason => !generated.has(reason));
    const unknowns = option.unknowns.filter(text => !prefixes.some(prefix => text.startsWith(prefix)));
    const fit = option.sources.length ? "candidate" as const : "requires_confirmation" as const;
    const qualified = qualifyOption({ ...option, fit, reasons, unknowns, price: option.price }, evidence, after);
    return qualified.fit === "unsuitable" ? { ...qualified, inPoll: false } : qualified;
  });
  // Keep a valid group question: if too few remain asked, offer every suitable option.
  return syncDecisionOptions(next).length >= 2 ? next : next.map(option => option.fit === "unsuitable" ? option : { ...option, inPoll: true });
}
