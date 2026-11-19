import type { TripContextSnapshot } from "@commons/contracts";

/*
 * Public research queries (design §7.1, §7.4). Only the query built here leaves Commons for a public
 * search provider. Raw conversation text, traveler names, addresses, contact details, confirmation
 * codes, amounts, and dates never do. The same filter runs for text and voice input, and again as a
 * second check on a query the organizer typed.
 */

export const MAX_PUBLIC_QUERY_CHARS = 120;

// Common public vocabulary is not a person's dietary detail. Medical terms,
// restrictions, distinctive answer tokens and full private phrases stay filtered.
const PUBLIC_FOOD_QUERY_WORDS = new Set(("a an the and or but if in on at to for of from by with without near around about as into is are am was were be been being i me my we us our you your he she they them their it its this that these those no not do does did can could would should will have has had any all some more very also just please " +
  "like love enjoy prefer want good great best food foods meal meals eat eating breakfast brunch lunch dinner supper snack snacks morning afternoon evening early late night day time restaurant restaurants cafe cafes coffee wine wines tasting tastings tour tours hotel hotels lodge lodges inn inns resort resorts pool pools airport airports travel trip place places local nearby group family friendly options option service services availability available open hours menu menus cost costs price prices vineyard vineyards winery wineries beer drink drinks bar bars grill table room stay get go need looking find search check").split(/\s+/));
const privateFoodWord = (word: string) => !PUBLIC_FOOD_QUERY_WORDS.has(word.toLocaleLowerCase())
  && (word.length >= 2 || /[^\p{Script=Latin}\p{N}_]/u.test(word));

// Narrow opt-in for an explicitly reviewed human query, never inferred from
// saved answers. Medical conditions, medications and arbitrary prose are not
// search predicates. All other privacy checks must pass without a removal.
const REVIEWED_FOOD_QUERY_WORDS = new Set("vegetarian vegan pescatarian gluten free dairy nut peanut soy egg wheat lactose low sodium halal kosher italian thai mexican indian chinese japanese korean vietnamese mediterranean french greek spanish american spicy mild cuisine cuisines".split(" "));
const FOOD_SEARCH_TARGET = /\b(?:restaurants?|baker(?:y|ies)|cafes?|cafés?|dining|menus?|food)\b/i;
type QueryOptions = { reviewedFoodSearch?: boolean };

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** Names and places that must never appear in a public query: everything private the snapshot knows. */
function privateTerms(context: TripContextSnapshot, options: QueryOptions = {}) {
  const phrases = new Set<string>(), words = new Set<string>(), foodWords = new Set<string>(), foodPhrases = new Set<string>();
  const add = (value: string | null | undefined, options: { splitWords: boolean }) => {
    const trimmed = value?.trim();
    if (!trimmed || trimmed.length < 3) return;
    phrases.add(trimmed);
    if (options.splitWords) for (const part of trimmed.split(/[\s,]+/)) if (part.length >= 3) words.add(part);
  };
  for (const traveler of context.travelers) add(traveler.value.name, { splitWords: true });
  for (const stay of context.stays) { add(stay.value.name, { splitWords: false }); add(stay.value.address, { splitWords: false }); }
  add(context.trip.value.name, { splitWords: false });
  for (const food of context.foodPreferences ?? []) for (const entry of food.value.entries) {
    add(entry.name, { splitWords: true });
    for (const text of [entry.requirements, entry.preferences, entry.notes]) {
      const sensitive = (text?.match(/[\p{L}\p{N}_]+/gu) ?? []).filter(word => privateFoodWord(word)
        && !(options.reviewedFoodSearch && REVIEWED_FOOD_QUERY_WORDS.has(word.toLocaleLowerCase())));
      if (sensitive.length && text?.trim()) foodPhrases.add(text.trim());
      for (const word of sensitive) foodWords.add(word);
    }
  }
  return { phrases: [...phrases].sort((a, b) => b.length - a.length), words: [...words], foodWords: [...foodWords], foodPhrases: [...foodPhrases].sort((a, b) => b.length - a.length) };
}

/** Marks where private text was removed, so a query can be cut at the first removal instead of stitched together around it. */
const CUT = "\uE000";

/** Recognize a saved place only where its whole name occurs in this query.
 * Never globally exempt its component words (MS in Jackson, MS is not a
 * license to search a reported medical condition). Comma-separated locality
 * fields can stand alone; names/addresses still pass the legacy guards below.
 */
function placeRanges(text: string, context: TripContextSnapshot) {
  const places = [context.trip.value.destination, ...context.stays.flatMap(stay => [stay.value.name, stay.value.address]), ...context.plans.map(plan => plan.value.location)]
    .flatMap(place => place?.split(",").map(part => part.trim().replace(/[’‘]/g, "'")) ?? [])
    .filter(place => place.length >= 3 && /\p{Ll}/u.test(place) && /^[\p{L}\p{M} .'()-]+$/u.test(place));
  return places.flatMap(place => [...text.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}_])${escapeRegExp(place)}(?![\p{L}\p{N}_])`, "giu"))]
    .map(match => ({ start: match.index, end: match.index + match[0].length })));
}
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:https?:\/\/|www\.)\S+/gi, CUT],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, CUT],
  [/\+?\d[\d\s().-]{7,}\d/g, CUT],
  // Amounts, with or without a currency sign ("budget 200", "under $80 a head").
  [/\b(?:budget|cost|price|total|under|below|around|about|max(?:imum)?|up to|at most)\s+(?:of\s+|is\s+|at\s+|to\s+)?(?:US)?\$?\s?\d[\d,]*(?:\.\d+)?\s?k?\b/gi, CUT],
  [/(?:US)?\$\s?\d[\d,]*(?:\.\d+)?\s?k?\b/gi, CUT],
  [/\b\d[\d,]*(?:\.\d+)?\s*(?:USD|dollars?|bucks)\b/gi, CUT],
  // Confirmation and booking references, flight numbers, ticket and account identifiers.
  [/\b(?:confirmation|booking|reservation|reference|conf|pnr|record locator|itinerary|ticket|e-?ticket|order|invoice|receipt|account|member(?:ship)?|loyalty|rewards|frequent flyer)\s*(?:code|number|no\.?|#|id)?\s*[:#]?\s*[A-Za-z0-9-]{4,}\b/gi, CUT],
  [/\b(?=[A-Z0-9-]*\d)[A-Z][A-Z0-9-]{5,23}\b/g, CUT],
  // "UA 1234", "AA100", "flight ua1234": a carrier code and a flight number identify a traveler's itinerary.
  [/\bflights?\s*(?:number\s*|no\.?\s*|#\s*)?[A-Za-z][A-Za-z0-9]\s?\d{1,4}\b/gi, CUT],
  [/\b[A-Z][A-Z0-9]\s?\d{1,4}[A-Z]?\b/g, CUT],
  [/\b\d{5,}\b/g, CUT],
  // Street addresses and exact dates.
  [/\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){1,4}(?:st|street|rd|road|ave|avenue|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|trl|trail|hwy|highway|pkwy|parkway|cir|circle)\b\.?/gi, CUT],
  [/\b\d{4}-\d{2}-\d{2}\b/g, CUT],
  [/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, CUT],
];

// People who are not on the roster still must not reach a public query: a name that follows a role ("our host Jamie Rivera", "a friend named Sam") or
// carries a possessive ("Jamie Rivera's place"). Case-sensitive on purpose; only applied to spoken or loosely typed requests.
const NAME = String.raw`[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}`;
const ROLE_WORDS = ["host", "hosts", "landlord", "owner", "driver", "guide", "friend", "cousin", "neighbor", "neighbour", "aunt", "uncle", "mom", "dad", "mother", "father", "sister", "brother", "wife", "husband", "partner", "colleague", "coworker", "boss", "manager", "contact", "agent", "nanny", "sitter", "instructor", "teacher", "doctor", "pilot", "guest"];
const anyCase = (word: string) => `[${word[0]}${word[0].toUpperCase()}]${word.slice(1)}`;
const ROLES = `(?:${ROLE_WORDS.map(anyCase).join("|")})`;
// Case-sensitive names, case-insensitive roles (the name pattern must not match ordinary lowercase words).
const PERSON_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b${ROLES}\s+(?:(?:named|called)\s+)?${NAME}\b`, "g"),
  new RegExp(String.raw`\b(?:named|called)\s+${NAME}\b`, "g"),
  new RegExp(String.raw`\b${NAME}'s\b`, "g"),
];

function redact(text: string, context: TripContextSnapshot, options: { firstNames: boolean }) {
  const result = redactWithFlags(text, context, options);
  return result.value;
}

function redactWithFlags(text: string, context: TripContextSnapshot, options: { firstNames: boolean } & QueryOptions) {
  let personCut = false;
  let value = text.replace(/[’‘]/g, "'");
  const terms = privateTerms(context, options);
  for (const phrase of terms.phrases) value = value.replace(new RegExp(escapeRegExp(phrase), "gi"), CUT);
  const redactFood = (term: string) => {
    const places = placeRanges(value, context);
    value = value.replace(new RegExp(String.raw`(?<![\p{L}\p{N}_])${escapeRegExp(term)}(?![\p{L}\p{N}_])`, "giu"), (match, offset: number) =>
      places.some(place => offset >= place.start && offset + match.length <= place.end) ? match : CUT);
  };
  for (const phrase of terms.foodPhrases) redactFood(phrase);
  // Outside the narrow reviewed generic-predicate opt-in, food details are
  // private even in a typed query. Raw medical details are never exempted.
  for (const word of terms.foodWords) redactFood(word);
  for (const [pattern, replacement] of PATTERNS) value = value.replace(pattern, replacement);
  // A request said aloud or typed loosely also loses first names and surnames on their own ("Robin's kids"); a query the
  // organizer typed and reviewed keeps their wording apart from full names, addresses, and the other private terms.
  if (options.firstNames) {
    for (const word of terms.words) value = value.replace(new RegExp(String.raw`\b${escapeRegExp(word)}(?:'s)?\b`, "gi"), () => { personCut = true; return CUT; });
    for (const pattern of PERSON_PATTERNS) value = value.replace(pattern, () => { personCut = true; return CUT; });
  }
  return { value: value.replace(/[ \t]+/g, " ").trim(), personCut };
}

const SCAFFOLD = /^(?:(?:please|hey|ok(?:ay)?|so|and|now)[,\s]+)*(?:(?:can|could|would) you\s+|i(?:'d| would) like you to\s+|i want you to\s+|go ahead and\s+|help me\s+)*(?:(?:please)\s+)?(?:look\s*up|research|search(?:\s+the web)?(?:\s+for)?|find(?:\s+me)?(?:\s+some)?|google|check(?:\s+online)?(?:\s+for)?|dig up)(?:\s+|$)/i;
const DANGLING = new Set(["near", "at", "by", "in", "for", "with", "from", "to", "and", "or", "of", "the", "a", "an", "our", "my", "us", "we", "i", "me", "around", "about", "under", "over", "on", "that", "which", "who", "is", "are", "was", "were", "has", "have", "had", "it", "its", "their", "there", "here", "also", "then", "but", "so", "because", "since", "if", "when", "while", "online", "call", "arriving", "budget", "total"]);

function trimDangling(value: string) {
  const words = value.replace(/[^\w\s,'&/-]/g, " ").split(/\s+/).filter(Boolean);
  while (words.length && DANGLING.has(words[0].toLowerCase())) words.shift();
  while (words.length && DANGLING.has(words[words.length - 1].toLowerCase().replace(/,/g, ""))) words.pop();
  return words.join(" ").replace(/\s*,\s*$/, "");
}

const substantiveWords = (value: string) => value.split(/\s+/).filter(word => word.replace(/[^A-Za-z]/g, "").length >= 3);

function clip(value: string, max: number) {
  if (value.length <= max) return value;
  const cut = value.slice(0, max + 1), space = cut.lastIndexOf(" ");
  return (space > 20 ? cut.slice(0, space) : cut.slice(0, max)).trim();
}

/**
 * Build a public query from a spoken or typed research request. Uses only the first sentence and only the text
 * before the first private term or number (so nothing private can survive around a removal), appends the (public)
 * destination when the request does not name a place, and returns null when nothing substantive is left, so the
 * caller can say so instead of searching.
 */
export function buildPublicResearchQuery(text: string, context: TripContextSnapshot): string | null {
  const firstSentence = text.trim().split(/(?<=[.!?])\s+|\n+/)[0] ?? "";
  const redacted = redactWithFlags(firstSentence, context, { firstNames: true });
  const scaffolded = redacted.value.replace(SCAFFOLD, "");
  const fragments = scaffolded.split(CUT).map(fragment => trimDangling(fragment.trim()));
  // The first fragment with any content: "look up dinner spots near <lodge> for <name>'s family" keeps "dinner spots". When the request opened with something
  // private ("<name>'s flight <code> arrival time"), what follows is a leftover of that request, not a question about the public world: it needs two real
  // words to stand on its own, and a lone word ("flight") means Commons does not know what to search, so it does not search.
  const index = fragments.findIndex(fragment => fragment.length > 0);
  const lead = index >= 0 ? fragments[index] : "";
  const openedPrivate = index > 0, cuts = fragments.length - 1;
  const core = substantiveWords(lead).length >= (openedPrivate || redacted.personCut ? 2 : 1) && lead.length >= 6 && !(openedPrivate && cuts >= 2) ? lead : "";
  if (!core) return null;
  const rawDestination = context.trip.value.destination?.trim();
  // A freeform saved location is not trusted public text. Apply the same private-term
  // filter before appending it, and omit ambiguous numeric/address-like locations.
  const filteredDestination = rawDestination ? redact(rawDestination, context, { firstNames: true }) : null;
  const destination = rawDestination && filteredDestination === rawDestination
    && rawDestination.length <= 120 && /^[\p{L}\p{M} ,.'’()-]+$/u.test(rawDestination) ? rawDestination : null;
  const named = destination ? destination.split(",")[0].trim().toLowerCase() : null;
  const withPlace = destination && named && !core.toLowerCase().includes(named) ? `${core} in ${destination}` : core;
  const query = clip(withPlace, MAX_PUBLIC_QUERY_CHARS);
  return query.length >= 6 ? query : null;
}

/** Second check for an organizer-typed, reviewed query: private terms are removed, but the organizer's own wording is kept. */
export function sanitizeTypedResearchQuery(query: string, context: TripContextSnapshot, options: QueryOptions = {}): { query: string; changed: boolean } | null {
  const reviewed = options.reviewedFoodSearch && FOOD_SEARCH_TARGET.test(query)
    ? redactWithFlags(query, context, { firstNames: true, reviewedFoodSearch: true }) : null;
  // Mixed private input gets the original strict filter, not an anonymous
  // rewrite that retains newly permitted dietary words after stripping a name.
  const redacted = reviewed && !reviewed.personCut && !reviewed.value.includes(CUT) ? reviewed.value
    : options.reviewedFoodSearch ? redactWithFlags(query, context, { firstNames: true }).value : redact(query, context, { firstNames: false });
  const cleaned = redacted.split(CUT).map(part => part.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!substantiveWords(cleaned).length) return null;
  const clipped = clip(cleaned, 500);
  return { query: clipped, changed: clipped !== query.replace(/\s+/g, " ").trim() };
}

// ---------------------------------------------------------------------------
// Requests that must not become a public search at all
// ---------------------------------------------------------------------------

const CONTACT_WORDS = /\b(?:phone(?:\s+number)?|telephone|cell(?:\s*phone)?(?:\s+number)?|mobile(?:\s+number)?|e-?mail(?:\s+address)?|home\s+address|mailing\s+address|contact\s+(?:info|information|details)|address(?:es)?)\b/i;
const PERSON_ROLE = new RegExp(String.raw`\b${ROLES}\b`);
const BUSINESS_NOUNS = /\b(?:restaurant|grill|cafe|caf\u00e9|bar|pub|brewery|bakery|shop|store|market|kitchen|table|hotel|lodge|inn|resort|hostel|motel|rental|rentals|shuttle|taxi|airline|airport|clinic|hospital|pharmacy|office|bank|museum|park|gallery|theater|theatre|studio|gym|spa|company|co\.|llc|inc)\b/;

/**
 * A request to look up how to reach a person (phone number, email, home address). Commons never sends that to a public search: it names a person
 * (a roster name, a role such as "our host", a possessive name, or a capitalized full name that is not plainly a business), so nothing is searched.
 * A business can still be looked up by name without asking for a person's details.
 */
export function isPersonContactLookup(text: string, context: TripContextSnapshot): boolean {
  const value = text.replace(/[’‘]/g, "'");
  if (!CONTACT_WORDS.test(value)) return false;
  if (PERSON_PATTERNS.some(pattern => { pattern.lastIndex = 0; return pattern.test(value); })) return true;
  if (PERSON_ROLE.test(value) && /\b(?:our|my|his|her|their)\b/i.test(value)) return true;
  if (rosterNames(context).some(name => new RegExp(String.raw`\b${escapeRegExp(name)}\b`, "i").test(value))) return true;
  // A capitalized full name that is not plainly a business ("Jamie Rivera"), when a person's details are asked for.
  const names = value.match(new RegExp(String.raw`\b${NAME}\b`, "g")) ?? [];
  return names.some(name => name.includes(" ") && !BUSINESS_NOUNS.test(name.toLowerCase()) && !BUSINESS_NOUNS.test(value.toLowerCase()));
}

/** Full names and name parts of the trip's travelers. */
function rosterNames(context: TripContextSnapshot) {
  return [...new Set(context.travelers.flatMap(traveler => [traveler.value.name.trim(), ...traveler.value.name.split(/[\s,]+/)]).filter(word => word.length >= 3))];
}

/**
 * A lookup that is about the organizers' own conversation, plans or records rather than the public world: "look up what we discussed in the lodging
 * thread", "look up our notes", or something about a traveler's own itinerary ("Taylor's flight"). Answered from Commons, never searched.
 */
export function isInternalLookup(text: string, context: TripContextSnapshot): boolean {
  const value = text.replace(/[’‘]/g, "'");
  if (/\b(?:we|you and i|we've|we had|us)\s+(?:discussed|talked about|said|decided|agreed|mentioned|settled on|chose|picked|planned|listed|saved|noted|looked at|went over|covered|came up with|considered|liked|shortlisted)\b/i.test(value)) return true;
  if (/\b(?:the|our|this|that|my)\s+(?:\w+\s+){0,3}(?:thread|conversation|topic|chat)\b/i.test(value)) return true;
  if (/^(?:(?:ok(?:ay)?|hey|so|and|now|please|then|alright)[,\s]+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|go ahead and\s+|i need you to\s+|i want you to\s+|let's\s+|please\s+)?(?:look\s*up|research|search(?:\s+(?:the\s+web|online))?(?:\s+for)?|google|dig up|check online|find(?:\s+me)?)\s+(?:up\s+)?(?:for\s+|on\s+|about\s+)?(?:our|my)\b/i.test(value)) return true;
  return rosterNames(context).some(word => new RegExp(String.raw`\b${escapeRegExp(word)}(?:'s)?\b`, "i").test(value)) && /\b(?:flights?|arriv\w*|depart\w*|itinerary|booking|reservation|room|check-?in|check-?out|dietary|allerg\w*|diet|schedule|plans?)\b/i.test(value);
}

/** Narrow opt-in for an explicit /search lodging price ceiling supplied in this request.
 * Mixed private context falls back to the existing redaction. Never extracts saved costs.
 */
export function sanitizePublicLodgingQuery(query: string, context: TripContextSnapshot, options: QueryOptions = {}) {
  if (!/\b(?:hotel|hotels|motel|motels|hostel|hostels|lodging)\b/i.test(query) || /\b(?:our|my|saved|paid|booking|reservation|confirmation|cost)\b/i.test(query)) return sanitizeTypedResearchQuery(query, context, options);
  const amounts: string[] = [];
  const protectedQuery = query.replace(/\b(?:under|below|at most|up to|maximum|max)\s+(?:\$\s*\d{1,5}(?:\.\d{1,2})?|\d{1,5}(?:\.\d{1,2})?\s*(?:\$|USD\b|dollars?\b))/gi, value => {
    const key = `PUBLICPRICE${String.fromCharCode(65 + amounts.length)}`;
    amounts.push(value); return key;
  });
  if (!amounts.length || amounts.length > 1) return sanitizeTypedResearchQuery(query, context, options);
  const redacted = redact(protectedQuery, context, { firstNames: true });
  if (redacted !== protectedQuery || redacted.includes(CUT)) return sanitizeTypedResearchQuery(query, context, options);
  const restored = protectedQuery.replace("PUBLICPRICEA", amounts[0]);
  return { query: clip(restored, 500), changed: restored !== query };
}
