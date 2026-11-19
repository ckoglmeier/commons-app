/*
 * What a typed message asks of the native lodging journey, read by code. Only an actual present request counts: an imperative ("Find us somewhere to
 * stay", "Go with option 2") or a polite request ("Can you find lodging?"). Questions about a choice ("Why did you choose option 2?", "Should we go with
 * option 2?"), negations ("Don't choose option 2"), hedges, reports of what someone else said, quoted suggestions and mixed requests are not claimed here;
 * they go to the ordinary coordinator (or, where enabled, to the bounded resolver when they are about lodging).
 */

export type LodgingRequest =
  | { kind: "research" }
  /** `ordinal` is a 1-based position in the shortlist the person saw; `phrase` is the rest of the choice, matched against option names. */
  | { kind: "choose"; ordinal: number | null; phrase: string };

const LODGING_NOUN = /\b(?:lodging|stays?|place to stay|places to stay|somewhere to stay|where to stay|accommodations?|rentals?|cabins?|houses?|hotels?|lodges?|cottages?|villas?|condos?|airbnbs?|vrbos?)\b/i;
const POLITE = String.raw`(?:(?:can|could|would|will) you\s+(?:please\s+)?|go ahead and\s+|i need you to\s+|i want you to\s+|i(?:'d| would) like you to\s+|please\s+)`;
const FILLER = String.raw`(?:(?:ok(?:ay)?|hey|so|and|now|please|then|alright|great|thanks|yes|yeah|yep|sure|cool)[,\s]+)*`;
const WE = String.raw`(?:let's\s+|let us\s+|we(?:'ll| will)\s+|i(?:'ll| will)\s+|we(?:'d| would) like to\s+|i(?:'d| would) like to\s+|we want to\s+|i want to\s+)`;
const RESEARCH = new RegExp(String.raw`^${FILLER}${POLITE}?(?:find|search(?:\s+for)?|look\s+(?:for|into|up)|show(?:\s+(?:me|us))?|compare|suggest|recommend|research|pull\s+up|get)\b`, "i");
const CHOOSE = new RegExp(String.raw`^${FILLER}(?:${POLITE}|${WE})?(?:go\s+(?:with|for)|choose|pick|select|take|do)\b\s*(.*)$`, "i");
const QUESTION_START = /^(?:why|what|how|did|does|do|is|are|was|were|should|shall|which|who|when|where|whose|has|have|had)\b/i;
const NEGATION = /\b(?:don't|dont|do not|doesn't|not|never|no|nothing|instead of|rather than|hold off|wait (?:on|before)|skip|cancel|undo)\b/i;
const HEDGE = /\b(?:maybe|might|perhaps|probably|later|eventually|someday|if\s+\w+|whether|thinking about|considering)\b/i;
const REPORT = /\b(?:said|says|suggested|suggests|wants|wanted|thinks|thought|asked|mentioned|prefers|preferred|told)\b/i;
const ORDINALS: Record<string, number> = { first: 1, "1st": 1, one: 1, second: 2, "2nd": 2, two: 2, third: 3, "3rd": 3, three: 3, fourth: 4, "4th": 4, four: 4, fifth: 5, "5th": 5, five: 5 };

function normalize(text: string) {
  return text.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^\S\n]+/g, " ").trim();
}
/** Quoted words are someone's suggestion being discussed, not this person's instruction. */
const withoutQuotes = (text: string) => text.replace(/"[^"]*"/g, " ").replace(/(^|\s)'[^']{3,}'(?=\s|[.,!?]|$)/g, " ");
const clausesOf = (text: string) => text.split(/(?<=[.!?;])\s+|\n+|,\s*(?:and\s+|but\s+|then\s+|also\s+)|\s+(?:and|but|also|plus)\s+(?=(?:find|search|look|show|compare|suggest|recommend|research|get|book|reserve|send|create|make|add|choose|pick|select|take|go|tell|let|check|who|what|when|how|remind|invite|can|could|please)\b)/i).map(clause => clause.trim()).filter(Boolean);

function ordinalIn(phrase: string): number | null {
  const option = /\b(?:option|number|no\.?|#)\s*(\d)\b/i.exec(phrase) ?? /#(\d)\b/.exec(phrase);
  if (option) return Number(option[1]);
  const word = /\bthe\s+(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b(?:\s+(?:one|option|place|stay))?/i.exec(phrase) ?? /\b(?:option|number)\s+(one|two|three|four|five)\b/i.exec(phrase);
  return word ? ORDINALS[word[1].toLowerCase()] ?? null : null;
}

/**
 * A claimable lodging request; "conversation" when the message talks about lodging or a choice without asking for one (a question, negation, hedge,
 * report, quotation, or a request mixed with something else), which the ordinary coordinator answers and the resolver never sees; null otherwise.
 */
export function lodgingRequest(rawText: string): LodgingRequest | "conversation" | null {
  const text = normalize(rawText);
  if (!text || text.length > 600) return null;
  const clauses = clausesOf(text);
  let found: LodgingRequest | null = null;
  let other = false, statement = false;
  for (const raw of clauses) {
    const clause = withoutQuotes(raw).trim();
    const polite = new RegExp(`^${FILLER}${POLITE}`, "i").test(clause);
    const question = (raw.trim().endsWith("?") && !polite) || (QUESTION_START.test(clause) && !polite);
    const choose = CHOOSE.exec(clause);
    const research = RESEARCH.test(clause) && LODGING_NOUN.test(clause);
    const lodging = Boolean(research || choose && (ordinalIn(choose[1]) !== null || LODGING_NOUN.test(choose[1]) || /\b(?:one|it|that|this|place)\b/i.test(choose[1])));
    const related = lodging || LODGING_NOUN.test(raw) || ordinalIn(raw) !== null;
    // A single choice must not silently resolve alternatives or combined choices.
    const ambiguousChoice = Boolean(choose && /\b(?:or|and)\b/i.test(choose[1]));
    const disqualified = ambiguousChoice || question || NEGATION.test(clause) || HEDGE.test(clause) || REPORT.test(clause) || clause !== raw.trim();
    if (lodging && !disqualified) {
      if (found) return "conversation"; // two lodging instructions in one message are not guessed between
      found = research ? { kind: "research" } : { kind: "choose", ordinal: ordinalIn(choose![1]), phrase: choose![1].replace(/[.!]+$/, "").trim() };
    } else if (related && (lodging || disqualified)) {
      // A lodging request or reference that is a question, negation, hedge, report or quotation makes the whole message ordinary conversation.
      return "conversation";
    } else if (related) statement = true; // about lodging but not a recognized request: only the resolver may read it
    else if (clause) other = true; // Do not drop a second request or unrelated clause.
  }
  if (found) return other ? "conversation" : found;
  return statement && other ? "conversation" : null;
}

/**
 * Whether a message the phrase rules did not claim is about lodging closely enough to spend one bounded resolver call on it: it mentions lodging, or it
 * refers to an option in the shortlist this conversation shows. Unrelated conversation never reaches the resolver.
 */
export function lodgingPlausible(rawText: string, optionNames: string[]): boolean {
  const text = normalize(rawText).toLowerCase();
  if (LODGING_NOUN.test(text)) return true;
  if (!optionNames.length) return false;
  if (/\b(?:option|number)\s*\d\b|\bthe\s+(?:first|second|third|1st|2nd|3rd)\b|\bthe\s+(?:(?:cheap|cheaper|cheapest|pricier|priciest|most expensive|bigger|biggest|smaller|smallest|roomier)\s+)?(?:one|option)\b/.test(text)) return true;
  return optionNames.some(name => { const key = name.toLowerCase().replace(/^synthetic\s+/, ""); return text.includes(key); });
}

/** The option a deterministic choice names in a shortlist: its position, or a unique name match. */
export function optionFromChoice<T extends { name: string }>(choice: Extract<LodgingRequest, { kind: "choose" }>, options: T[]): T | undefined {
  if (choice.ordinal !== null) return options[choice.ordinal - 1];
  const phrase = choice.phrase.toLowerCase();
  const matches = options.filter(option => { const key = option.name.toLowerCase().replace(/^synthetic\s+/, ""); return phrase.includes(key) || phrase.includes(option.name.toLowerCase()); });
  return matches.length === 1 ? matches[0] : undefined;
}
