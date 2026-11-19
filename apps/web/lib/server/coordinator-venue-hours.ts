import { publicActivityWebsite, type TripContextSnapshot } from "@commons/contracts";
import { publicResearchUrl } from "./coordinator-research";

const HOURS_QUESTION = /^(?:please\s+)?(?:when|what time)\s+(?:does|do|is)\s+.+\b(?:open|close|closing|opening)\b|^(?:what(?:'s| are| is)|tell me|check|look up)\s+.+\b(?:opening|closing|business|visiting|visitor|operating)\s+(?:hours|times?)\b|^(?:is|are)\s+.+\bopen\s+(?:today|now|tomorrow)\b/i;
const HOURS_FOLLOW_UP = /^(?:please\s+)?(?:(?:i want|i(?:'d| would) like) you to\s+|can you\s+|could you\s+)?(?:check|look up|look into|verify|research|search for)\s+(?:that|it|those hours|the hours)(?:\s+(?:online|on (?:its|their|the) (?:website|site)))?[.!?]*$/i;

/** Only an immediate human hours question can supply a referent for “check that”. */
export function venueHoursQuestion(text: string, previousUserText?: string): string | null {
  const direct = text.trim().replace(/[’‘]/g, "'");
  if (direct.length > 400 || /[\n"“”]/.test(direct) || /\b(?:our|my)\s+(?:trip|flight|booking|reservation|plan|activity)\b/i.test(direct)) return null;
  if (HOURS_QUESTION.test(direct)) return direct;
  if (previousUserText && HOURS_FOLLOW_UP.test(direct)) return venueHoursQuestion(previousUserText);
  return null;
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(word => word.length > 2 && !["the", "and", "when", "what", "time", "does", "open", "close", "hours", "opening", "closing"].includes(word));

/** Prefer a uniquely matched saved activity website; never leak query tokens or private booking pages. */
export function venueHoursSource(question: string, context: TripContextSnapshot): { url: string; title: string } | null {
  const terms = new Set(words(question));
  const candidates = context.plans.map(({ value }) => {
    const matched = new Set(words(`${value.title} ${value.location ?? ""}`).filter(word => terms.has(word))).size;
    return { value, matched };
  }).filter(row => row.matched >= 2).sort((a, b) => b.matched - a.matched);
  if (!candidates.length || candidates[1]?.matched === candidates[0].matched) return null;
  const plan = candidates[0].value;
  const savedWebsite = publicActivityWebsite(plan.sourceUrl);
  const safe = savedWebsite ? publicResearchUrl(savedWebsite) : null;
  if (!safe) return null;
  return { url: safe, title: plan.title };
}
