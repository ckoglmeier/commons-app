/*
 * Reporting money by text. Pure: this reads a message into a proposal and writes the summary a person approves. It decides nothing about balances and
 * moves nothing. The sender's own words are data, and a saved record comes only from the existing Money commands after they approve an exact version.
 */
import { normalizeReply } from "./messaging";

export type MoneyPerson = { id: string; name: string };
export type ParsedMoney =
  | { kind: "payment"; amountCents: number | null; currency: string | null; dollarSign: boolean; toName: string | null }
  /** "unclear": the message seems to name someone, in a way that can't be read safely, so it's asked rather than offered to the whole group. */
  | { kind: "expense"; description: string | null; amountCents: number | null; currency: string | null; dollarSign: boolean; included: "everyone" | "unstated" | "unclear" | { names: string[]; includesSender: boolean }; dateWord: string | null; perPerson?: boolean }
  /** Someone else paid, or paid for something Commons can't attribute from a text. It belongs on the Money page. */
  | { kind: "someone_else" };

const SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP" };
const DOLLAR_CURRENCIES = ["USD", "CAD", "AUD", "NZD", "MXN", "SGD", "HKD"];

/** "$" is several currencies. On a trip in one of them it means the trip's, and says so unless that's USD. Elsewhere it means USD. */
export function resolveCurrency(parsed: { currency: string | null; dollarSign: boolean }, tripCurrency: string) {
  if (parsed.currency) return { currency: parsed.currency, currencyAssumed: false };
  if (parsed.dollarSign) return DOLLAR_CURRENCIES.includes(tripCurrency) ? { currency: tripCurrency, currencyAssumed: tripCurrency !== "USD" } : { currency: "USD", currencyAssumed: false };
  return { currency: tripCurrency, currencyAssumed: true };
}
const WORDS: Record<string, string> = { dollar: "USD", dollars: "USD", buck: "USD", bucks: "USD", usd: "USD", euro: "EUR", euros: "EUR", eur: "EUR", pound: "GBP", pounds: "GBP", gbp: "GBP", cad: "CAD", aud: "AUD", pesos: "MXN", mxn: "MXN" };

/** "$120", "120.50 dollars", "€40", "1,200". A bare number counts only where the caller says one is expected. */
export function parseAmount(text: string, options: { allowBare?: boolean } = {}): { amountCents: number; currency: string | null; dollarSign: boolean; match: string } | null {
  const cents = (value: string, thousands = false) => { const amount = Math.round(Number(value.replace(/,/g, "")) * (thousands ? 100_000 : 100)); return amount > 0 && amount <= 10_000_000 ? amount : null; };
  // A number that keeps going ("1.200,50", "$40.123") is a format this can't read. It's asked about rather than read short.
  const marked = text.match(/([$€£])\s?(\d[\d,]*(?:\.\d{1,2})?)(k\b)?(?![\d.,]*\d)/i);
  if (marked) { const amountCents = cents(marked[2]!, Boolean(marked[3])); return amountCents ? { amountCents, currency: SYMBOLS[marked[1]!] ?? null, dollarSign: marked[1] === "$", match: marked[0] } : null; }
  if (/[$€£]\s?\d/.test(text)) return null;
  const named = text.match(new RegExp(`\\b(\\d[\\d,]*(?:\\.\\d{1,2})?)\\s?(${Object.keys(WORDS).join("|")})\\b`, "i"));
  if (named) { const amountCents = cents(named[1]!); return amountCents ? { amountCents, currency: WORDS[named[2]!.toLowerCase()]!, dollarSign: false, match: named[0] } : null; }
  if (options.allowBare) {
    // Only when the number is the whole reply: "dinner at 7" isn't $7.
    const bare = text.match(/^\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:back|total|for\b.*)?[.!]?\s*$/i);
    if (bare) { const amountCents = cents(bare[1]!); return amountCents ? { amountCents, currency: null, dollarSign: false, match: bare[1]! } : null; }
  }
  return null;
}

const namesFrom = (value: string) => value.split(/\s*(?:,|&|\band\b)\s*/i).map(name => name.trim()).filter(Boolean);
const tidy = (value: string) => value.replace(/\s+/g, " ").replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "");
const NOT_NAMES = /\b(dinner|lunch|breakfast|brunch|drinks|gas|groceries|the|tickets?|parking|uber|lyft|taxi|tip|coffee|snacks|food)\b/i;

/** Read a message as a money report, or return null so ordinary chat stays ordinary chat. A question is never a report. */
export function parseMoneyMessage(body: string): ParsedMoney | null {
  const raw = body.trim();
  if (!raw || raw.length > 400 || raw.endsWith("?")) return null;
  if (/^(how much|what|when|where|who|did|do|does|is|are|can|should)\b/i.test(raw)) return null;

  // Money coming in isn't a cost the sender paid.
  if (/^(?:i\s+)?(?:got|received)\s+[$€£]?\d[\d,.]*\s*\w*\s+(?:back\s+)?from\b/i.test(raw)) return null;

  // "I paid $40 to Sam": the same payment, said the other way round.
  const amountFirst = raw.match(/^(?:i\s+|just\s+|i just\s+)?(?:paid|venmoed|venmo'd|zelled|sent|repaid)\s+(.+?)\s+to\s+([a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+)?)[.!]?$/i);
  if (amountFirst) {
    const amount = parseAmount(amountFirst[1]!, { allowBare: true });
    if (amount) return { kind: "payment", amountCents: amount.amountCents, currency: amount.currency, dollarSign: amount.dollarSign, toName: tidy(amountFirst[2]!) };
  }

  // A payment to a person: "I paid Sam $40", "venmoed Sam 40", "sent Alex $12.50". "Paid for ..." is never a payment to someone called For.
  const payment = raw.match(/^(?:i\s+|just\s+|i just\s+)?(paid|venmoed|venmo'd|zelled|sent|repaid|paid back)\s+(?:back\s+)?([a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+)?)\b(.*)$/i);
  if (payment && !/^(for|the|a|an|my|our|off|it|that|this|him|her|them)\b/i.test(payment[2]!) && !NOT_NAMES.test(payment[2]!)) {
    const rest = payment[3]!, amount = parseAmount(rest, { allowBare: true });
    const toName = tidy(payment[2]!.replace(/\s+(back|for)$/i, ""));
    // "Sent Sam 3 photos" and "sent Sam the link" aren't money: after the name there has to be an amount, or nothing at all.
    if (!amount && !/^\s*(?:back)?[.!]?\s*$/i.test(rest)) return null;
    return { kind: "payment", amountCents: amount?.amountCents ?? null, currency: amount?.currency ?? null, dollarSign: amount?.dollarSign ?? false, toName };
  }
  const pronoun = raw.match(/^(?:i\s+)?(?:paid|venmoed|zelled|repaid)\s+(?:him|her|them)\b(.*)$/i);
  if (pronoun) { const amount = parseAmount(pronoun[1]!, { allowBare: true }); return { kind: "payment", amountCents: amount?.amountCents ?? null, currency: amount?.currency ?? null, dollarSign: amount?.dollarSign ?? false, toName: null }; }

  // Someone else paid: Commons won't record a cost against a person on another person's word.
  if (/^[a-z][a-z'’-]+\s+(paid|covered|bought|got)\b/i.test(raw) && !/^(i|we|just)\s/i.test(raw)) return parseAmount(raw) ? { kind: "someone_else" } : null;
  if (/^we\s+(paid|covered|bought|spent)\b/i.test(raw)) return parseAmount(raw) ? { kind: "someone_else" } : null;

  const amount = parseAmount(raw);
  const led = /^(?:i\s+|just\s+|i just\s+)?(?:paid|covered|spent|bought|got|put|picked up|grabbed)\b/i.test(raw) || /^(?:expense|receipt|add expense|add)\s*[:-]/i.test(raw);
  const stated = /\b(was|were|came to|cost)\b/i.test(raw);
  if (!led && !(stated && amount)) return null;
  // "I got here at 5" and "I bought it" aren't costs. Without an amount, only wording that can't mean anything else starts a report.
  if (!amount && !/^(?:i\s+|just\s+|i just\s+)?(?:paid for|covered|picked up the)\b|^(?:expense|receipt|add expense|add)\s*[:-]/i.test(raw)) return null;
  if (!led && /\b(i think|maybe|probably|about how)\b/i.test(raw)) return null;

  let rest = amount ? raw.replace(amount.match, " ") : raw;
  rest = rest.replace(/^(?:i\s+|just\s+|i just\s+)?(?:paid|covered|spent|bought|got|put|picked up|grabbed)\b/i, " ").replace(/^(?:add expense|expense|receipt|add)\s*[:-]/i, " ");

  const dateWord = rest.match(/\b(yesterday|today|tonight|last night|this morning)\b/i)?.[1]?.toLowerCase() ?? rest.match(/\bon\s+((?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?)\b/i)?.[1]?.toLowerCase() ?? null;
  rest = rest.replace(/\b(yesterday|today|tonight|last night|this morning)\b/i, " ").replace(/\bon\s+(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b/i, " ");

  let included: Extract<ParsedMoney, { kind: "expense" }>["included"] = "unstated";
  if (/\b(for|with|split (?:with|between|among)|between)\s+(everyone|everybody|all of us|the group|the whole group|us all)\b|\bsplit (?:it )?(?:evenly|equally)\b/i.test(rest)) {
    included = "everyone";
    rest = rest.replace(/\b(?:for|with|split (?:with|between|among)|between)\s+(?:everyone|everybody|all of us|the group|the whole group|us all)\b|\bsplit (?:it )?(?:evenly|equally)\b/i, " ");
  } else {
    const split = rest.match(/\b(split (?:with|between|among)|with|between)\s+([^.;]+)$/i);
    const meAnd = rest.match(/(?:\bfor\s+|,\s*|^\s*)(me and [^.;]+|[a-z'’-]+(?:,\s*[a-z'’-]+)* and me)\s*$/i);
    const forOnly = rest.match(/\bfor\s+([a-z][a-z'’-]+(?:\s*(?:,|&|and)\s*[a-z][a-z'’-]+)*)\s*$/i);
    if (meAnd) {
      included = { names: namesFrom(meAnd[1]!).filter(name => !/^me$/i.test(name)), includesSender: true };
      rest = rest.replace(meAnd[0], " ");
    } else if (split && !NOT_NAMES.test(split[2]!)) {
      included = { names: namesFrom(split[2]!).filter(name => !/^me$/i.test(name)), includesSender: true };
      rest = rest.replace(split[0], " ");
    } else if (forOnly && !NOT_NAMES.test(forOnly[1]!) && /^(?:\s*)$|./.test(rest) && rest.trim().toLowerCase() !== forOnly[0].trim().toLowerCase()) {
      included = { names: namesFrom(forOnly[1]!), includesSender: false };
      rest = rest.replace(forOnly[0], " ");
    }
  }

  // A capitalized name left in the middle ("dinner with Sam at the Lodge", "Sam's ticket") wasn't read as who it's for, so it's asked, not assumed.
  if (included === "unstated" && /\b(?:with|for)\s+[A-Z][a-z]+\b|\b[A-Z][a-z]+['’]s\b/.test(rest.replace(/^\s*[A-Z]/, " "))) included = "unclear";
  // "$25 each" isn't the total, and multiplying it would be a guess about how many.
  const perPerson = /\b(each|apiece|per person|a head|pp)\b/i.test(rest);
  rest = rest.replace(/\b(each|apiece|per person|a head|pp)\b/i, " ");
  const description = tidy(rest.replace(/^\s*(?:for|on)\s+/i, " ").replace(/\b(was|were|came to|cost)\s*$/i, " ").replace(/^\s*(?:the)\s+/i, " ").replace(/\s+(?:was|were|came to|cost)\b\s*/i, " "));
  return { kind: "expense", description: description ? description[0]!.toUpperCase() + description.slice(1, 120) : null, amountCents: perPerson ? null : amount?.amountCents ?? null, currency: amount?.currency ?? null, dollarSign: amount?.dollarSign ?? false, included, dateWord, perPerson };
}

export type NameMatch = { kind: "one"; person: MoneyPerson } | { kind: "none"; name: string } | { kind: "ambiguous"; name: string; people: MoneyPerson[] };
/** Match a name to the people on the trip: a full name, or a first name only one person has. Never the closest guess. */
export function matchPerson(name: string, people: readonly MoneyPerson[]): NameMatch {
  const wanted = normalizeReply(name);
  const full = people.filter(person => normalizeReply(person.name) === wanted);
  if (full.length === 1) return { kind: "one", person: full[0]! };
  const first = people.filter(person => normalizeReply(person.name).split(" ")[0] === wanted);
  if (first.length === 1) return { kind: "one", person: first[0]! };
  return first.length > 1 || full.length > 1 ? { kind: "ambiguous", name, people: first.length ? first : full } : { kind: "none", name };
}

/** Equal shares that add up to the total exactly. Any leftover cents go one at a time to the first people listed. */
export function equalShares(amountCents: number, personIds: readonly string[]) {
  const base = Math.floor(amountCents / personIds.length), extra = amountCents - base * personIds.length;
  return personIds.map((personId, index) => ({ personId, amountCents: base + (index < extra ? 1 : 0) }));
}
