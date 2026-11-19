import type { RecipeId } from "@commons/contracts";

export type RecipeSuggestion = { id: Extract<RecipeId, "dates_location" | "attendance" | "lodging" | "transport">; label: string; path: string };
const suggestions: Record<RecipeSuggestion["id"], RecipeSuggestion> = {
  dates_location: { id: "dates_location", label: "Pick a date and location", path: "recipes?new=dates_location" },
  attendance: { id: "attendance", label: "Confirm who is coming", path: "recipes?new=attendance" },
  lodging: { id: "lodging", label: "Find a place to stay", path: "recipes?new=lodging" },
  transport: { id: "transport", label: "Coordinate transport", path: "recipes/transport" },
};
const patterns: Array<[RecipeSuggestion["id"], RegExp]> = [
  ["dates_location", /\b(?:pick|choose|decide on|settle on|figure out|find|vote on)\b[^.?!]*\b(?:dates?|when to go|location|destination|where to go)\b|\bdates? and (?:a )?(?:location|place|destination)\b/i],
  ["attendance", /\bwho(?:'s|’s| is| are)? (?:coming|going|in|attending)\b|\b(?:confirm|check)\b[^.?!]*\b(?:attendance|who(?:'s|’s| is)? coming)\b|\bheadcount\b|\bhow many (?:people|of us) (?:are )?(?:coming|going)\b/i],
  ["lodging", /\b(?:where (?:to|should we|do we|will we) stay|places? to stay|compare (?:the )?(?:hotels?|stays?|lodging)|choose (?:a |the )?(?:hotel|stay|lodging))\b/i],
  ["transport", /\b(?:flights?|airports?|pick ?-?ups?|shared rides?|shuttles?|carpool|ground transport(?:ation)?)\b/i],
];

/**
 * A quiet, deterministic pointer to a guided recipe, never a router. It grants nothing and starts nothing; it only offers a link.
 * Anything long, unclear or matching more than one recipe returns null, and the conversation carries on as it always has.
 */
export function suggestRecipe(text: string): RecipeSuggestion | null {
  const value = text.trim();
  if (value.length < 8 || value.length > 240) return null;
  const matches = patterns.filter(([, pattern]) => pattern.test(value));
  return matches.length === 1 ? suggestions[matches[0][0]] : null;
}
